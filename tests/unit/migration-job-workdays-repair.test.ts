/**
 * PAR-03 (re-audit pass 4): the repair for `Job.workDays` rewrites the `Job` table, and
 * four other tables have foreign keys pointing at it with `ON DELETE CASCADE`. SQLite has
 * no way to change a column default, so every plausible repair is some combination of
 * "make a new Job" and "get rid of the old Job" — and getting rid of the old Job is exactly
 * the statement that can delete Project, Task, JobAttendance and BreakType while the
 * migration still reports success.
 *
 * Whether it does depends on two things the migration file cannot see: whether the
 * connection has `PRAGMA foreign_keys = ON`, and whether the runner wraps the file in a
 * transaction. The pragma is a no-op *inside* a transaction, so a runner that enables it
 * before opening the transaction leaves the cascade armed with no way to disarm it. That is
 * the worst condition, and it is why this test drives the matrix instead of the happy path.
 *
 * `better-sqlite3` (a declared dependency) builds each database from the shipped SQLite
 * migration set, plants a parent row with a child in every dependent table, applies the
 * repair under one of the three (pragma, transaction) combinations, and asserts nothing was
 * lost. The control at the end applies the copy-and-swap form — what Prisma's own generator
 * emits for a default change — to the same fixture, so the suite proves it can tell the two
 * forms apart rather than passing because the fixture is empty.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../prisma/migrations",
);
const REPAIR_MIGRATION = "20261010182000_fix_job_workdays_default";

const CHILD_TABLES = ["Project", "Task", "JobAttendance", "BreakType"] as const;

function migrationFile(name: string) {
  return path.join(MIGRATIONS_DIR, name, "migration.sql");
}

const allMigrationNames = fs
  .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && fs.existsSync(migrationFile(entry.name)))
  .map((entry) => entry.name)
  .sort();

/** The set as a pre-repair deployment has it: everything except the file under test. */
const PRE_REPAIR_SET = allMigrationNames.filter((name) => name !== REPAIR_MIGRATION);

const repairSql = fs.readFileSync(migrationFile(REPAIR_MIGRATION), "utf8");

/**
 * What Prisma's generator emits for a `@default` change on SQLite: build `new_Job`, copy
 * the rows, drop the real table, rename. Used only by the control — on a temp database,
 * never on a deployment.
 */
const COPY_AND_SWAP_CONTROL = `
CREATE TABLE "new_Job" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "description" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "workStart" TEXT NOT NULL DEFAULT '09:00',
    "workEnd" TEXT NOT NULL DEFAULT '17:00',
    "workDays" JSONB NOT NULL DEFAULT '[1, 2, 3, 4, 5]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Job" ("id","name","nameKey","description","isArchived","workStart","workEnd","workDays","createdAt","updatedAt")
SELECT "id","name","nameKey","description","isArchived","workStart","workEnd","workDays","createdAt","updatedAt" FROM "Job";
DROP TABLE "Job";
ALTER TABLE "new_Job" RENAME TO "Job";
CREATE UNIQUE INDEX "Job_nameKey_key" ON "Job"("nameKey");
`;

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "par03-repair-"));

/** A database carrying the defect, with one Job and a child row in every dependent table. */
function openPopulatedDb(file: string) {
  const db = new Database(path.join(tempDir, file));
  for (const name of PRE_REPAIR_SET) db.exec(fs.readFileSync(migrationFile(name), "utf8"));

  db.exec(`INSERT INTO "Job" ("name","nameKey","updatedAt") VALUES ('fix','fix','2026-01-01 09:00:00')`);
  const { id: jobId } = db.prepare(`SELECT "id" FROM "Job" WHERE "nameKey" = 'fix'`).get() as { id: number };
  db.exec(
    `INSERT INTO "Project" ("name","nameKey","jobId","updatedAt") VALUES ('p','p',${jobId},'2026-01-01 09:00:00')`,
  );
  const { id: projectId } = db.prepare(`SELECT "id" FROM "Project" WHERE "nameKey" = 'p'`).get() as { id: number };
  db.prepare(
    `INSERT INTO "Task" ("projectId","title","status","startedAt","updatedAt") VALUES (?, 't','in_progress','2026-01-01 09:00:00','2026-01-01 09:00:00')`,
  ).run(projectId);
  db.prepare(
    `INSERT INTO "JobAttendance" ("jobId","checkInTime","totalWorkSeconds","updatedAt") VALUES (?, '2026-01-01 09:00:00',120,'2026-01-01 09:00:00')`,
  ).run(jobId);
  db.exec(
    `INSERT INTO "BreakType" ("name","type","jobId","updatedAt") VALUES ('b','rest',${jobId},'2026-01-01 09:00:00')`,
  );
  return db;
}

type Counts = Record<"Job" | (typeof CHILD_TABLES)[number], number>;

function counts(db: Database.Database): Counts {
  const out = {} as Counts;
  for (const table of ["Job", ...CHILD_TABLES] as const) {
    out[table] = (db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n;
  }
  return out;
}

/** Apply `sql` the way the matrix says: pragma first, transaction if asked. */
function apply(db: Database.Database, sql: string, cell: MatrixCell) {
  if (cell.foreignKeys) db.pragma("foreign_keys = ON");
  if (cell.transaction) db.transaction(() => db.exec(sql))();
  else db.exec(sql);
}

interface MatrixCell {
  label: string;
  foreignKeys: boolean;
  transaction: boolean;
}

const MATRIX: MatrixCell[] = [
  { label: "foreign_keys=OFF transaction=OFF", foreignKeys: false, transaction: false },
  { label: "foreign_keys=ON  transaction=OFF", foreignKeys: true, transaction: false },
  { label: "foreign_keys=ON  transaction=ON", foreignKeys: true, transaction: true },
];

interface CellResult {
  before: Counts;
  after: Counts;
  db: Database.Database;
}

const results = new Map<string, CellResult>();const openDbs: Database.Database[] = [];

beforeAll(() => {
  for (const cell of MATRIX) {
    const db = openPopulatedDb(`repair-${cell.foreignKeys}-${cell.transaction}.db`);
    openDbs.push(db);
    const before = counts(db);
    // The fixture has to have teeth before the repair is judged. `Job` is more than 1
    // because the shipped set seeds a default job; the child tables are what a cascade
    // would empty, so each one must hold a row.
    for (const table of CHILD_TABLES) expect(before[table]).toBeGreaterThan(0);
    apply(db, repairSql, cell);
    results.set(cell.label, { before, after: counts(db), db });
  }
});

afterAll(() => {
  for (const db of openDbs) db.close();
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 3 });
});

describe.each(MATRIX)("the shipped Job.workDays repair, $label", (cell) => {
  function result() {
    return results.get(cell.label)!;
  }

  it("keeps every child row of Job", () => {
    const { before, after } = result();
    // The assertion that matters: the repair must not delete through the cascade. Comparing
    // to `before` rather than to literals keeps this honest if the fixture grows.
    expect(after).toEqual(before);
  });

  it("leaves the default a valid JSON array", () => {
    const { db } = result();
    const { dflt_value } = db
      .prepare(`SELECT "dflt_value" FROM pragma_table_info('Job') WHERE "name" = 'workDays'`)
      .get() as { dflt_value: string };
    expect(dflt_value).toBe("'[1, 2, 3, 4, 5]'");
    // And prove it by inserting, the way the PAR-03 finding was measured. `workDays` is a
    // TEXT column to the driver, so the default arrives as the string "[1, 2, 3, 4, 5]" —
    // which parses. Before this repair the same insert stored the bare text `1, 2, 3, 4, 5`
    // and the parse threw; that contrast is asserted in the control below.
    db.exec(`INSERT INTO "Job" ("name","nameKey","updatedAt") VALUES ('d','d','2026-01-01 09:00:00')`);
    const stored = db.prepare(`SELECT "workDays" AS v FROM "Job" WHERE "nameKey" = 'd'`).get() as { v: string };
    expect(JSON.parse(stored.v)).toEqual([1, 2, 3, 4, 5]);
  });

  it("keeps the Job table's identity: index, and no broken references", () => {
    const { db } = result();
    const index = db
      .prepare(`SELECT "sql" FROM sqlite_master WHERE type = 'index' AND "name" = 'Job_nameKey_key'`)
      .get() as { sql: string } | undefined;
    expect(index?.sql).toMatch(/"Job"\("nameKey"\)/);
    expect(db.prepare(`PRAGMA foreign_key_check`).all()).toEqual([]);
    const orphans = db
      .prepare(
        `SELECT COUNT(*) AS n FROM "Project" p LEFT JOIN "Job" j ON p."jobId" = j."id" WHERE j."id" IS NULL`,
      )
      .get() as { n: number };
    expect(orphans.n).toBe(0);
  });
});

describe("control: why the additive form and not Prisma's copy-and-swap", () => {
  it("the copy-and-swap form loses all four child tables when the cascade is armed", () => {
    const db = openPopulatedDb("control-copy-and-swap.db");
    openDbs.push(db);
    const before = counts(db);
    apply(db, COPY_AND_SWAP_CONTROL, MATRIX[2]);
    const after = counts(db);
    expect(after.Job).toBe(before.Job);
    // Not a style preference: under the worst condition this form deletes real user data
    // and the migration still exits 0. If SQLite's cascade behaviour ever changes this
    // control will fail, and the answer is to look at it, not to delete it.
    expect(after).toMatchObject({ Project: 0, Task: 0, JobAttendance: 0, BreakType: 0 });
  });

  it("without the repair a defaulted insert is not valid JSON — the defect itself", () => {
    const db = openPopulatedDb("control-unrepaired.db");
    openDbs.push(db);
    db.exec(`INSERT INTO "Job" ("name","nameKey","updatedAt") VALUES ('u','u','2026-01-01 09:00:00')`);
    const stored = db.prepare(`SELECT "workDays" AS v FROM "Job" WHERE "nameKey" = 'u'`).get() as { v: string };
    expect(stored.v).toBe("1, 2, 3, 4, 5");
    expect(() => JSON.parse(stored.v)).toThrow();
  });
});
