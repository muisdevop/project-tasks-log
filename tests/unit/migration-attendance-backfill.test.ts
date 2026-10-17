/**
 * PAR-09 (re-audit pass 4): the PAR-04 index is shipped as raw SQL, and `db push` never
 * runs it, so nothing in the suite could see the half of that migration that decides
 * whether an existing deployment boots: the backfill.
 *
 * A live database that already contains two simultaneously open check-ins for one job —
 * which is exactly what the pre-fix race produced — makes `CREATE UNIQUE INDEX` fail: on
 * SQLite `UNIQUE constraint failed: JobAttendance.jobId`, on Postgres 16 the same statement
 * refuses to build. The migration therefore closes the losers first. That behaviour is
 * invisible to every other layer here: the
 * integration tests run against a schema pushed from a clean file, and
 * `db:parity:migrations` compares text.
 *
 * So this test drives the real thing: `better-sqlite3` (a declared dependency) replays the
 * shipped SQLite migration set in directory order onto a temp file, stops before the
 * index, plants the duplicates, then applies the migration and asserts the outcome row by
 * row. The same fixture and the same assertions were run against Postgres 16 with the
 * shipped files by hand; the CHANGELOG entry for PAR-09 records both outcomes.
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
const INDEX_MIGRATION = "20261010180500_attendance_one_open_check_in";
const REPAIR_MIGRATION = "20261010182000_fix_job_workdays_default";

function migrationFile(name: string) {
  return path.join(MIGRATIONS_DIR, name, "migration.sql");
}

const allMigrationNames = fs
  .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(MIGRATIONS_DIR, entry.name, "migration.sql")))
  .map((entry) => entry.name)
  .sort();

function readSql(name: string) {
  return fs.readFileSync(migrationFile(name), "utf8");
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "par09-backfill-"));
let db: Database.Database;

/** JobAttendance rows, ordered so the assertion reads like the fixture. */
function attendance() {
  return db
    .prepare(
      'SELECT a."id", j."nameKey", a."checkInTime", a."checkOutTime", a."totalWorkSeconds" ' +
        'FROM "JobAttendance" a JOIN "Job" j ON j."id" = a."jobId" ORDER BY a."id"',
    )
    .all() as Array<{
    id: number;
    nameKey: string;
    checkInTime: string;
    checkOutTime: string | null;
    totalWorkSeconds: number;
  }>;
}

function insertAttendance(jobNameKey: string, checkIn: string, checkOut: string | null, seconds: number) {
  const jobId = db.prepare('SELECT "id" FROM "Job" WHERE "nameKey" = ?').get(jobNameKey) as { id: number };
  db.prepare(
    'INSERT INTO "JobAttendance" ("jobId", "checkInTime", "checkOutTime", "totalWorkSeconds", "updatedAt") ' +
      "VALUES (?, ?, ?, ?, ?)",
  ).run(jobId.id, checkIn, checkOut, seconds, checkOut ?? checkIn);
  return db.prepare("SELECT last_insert_rowid() AS id").get() as { id: number };
}

beforeAll(() => {
  db = new Database(path.join(tempDir, "dirty.db"));
  // Everything up to the index migration: this is a database as the pre-fix release left it.
  for (const name of allMigrationNames) {
    if (name >= INDEX_MIGRATION) break;
    db.exec(readSql(name));
  }

  db.exec('INSERT INTO "Job" ("name", "nameKey", "updatedAt") VALUES (\'bf-a\', \'bf-a\', CURRENT_TIMESTAMP), (\'bf-b\', \'bf-b\', CURRENT_TIMESTAMP)');
  // The artefact: three open rows for one job.
  insertAttendance("bf-a", "2026-10-08 09:00:00", null, 12345);
  insertAttendance("bf-a", "2026-10-08 09:00:01", null, 9999);
  insertAttendance("bf-a", "2026-10-08 09:00:02", null, 8888);
  // Controls that must not move: an open row on another job, and closed history.
  insertAttendance("bf-b", "2026-10-09 08:00:00", null, 7777);
  insertAttendance("bf-b", "2026-10-07 08:00:00", "2026-10-07 16:00:00", 28800);
  insertAttendance("bf-a", "2026-10-05 09:00:00", "2026-10-05 17:00:00", 28800);
});

afterAll(() => {
  db?.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("the PAR-04 index migration over a database that already violates it", () => {
  it("refuses to create the index before the backfill runs (the defect this migration must not regress into)", () => {
    // Taking the statement on its own proves the ordering matters: on this same dirty
    // data the CREATE UNIQUE INDEX line is the boot failure. Sliced from the file rather
    // than split on ";" because the migration's own comments contain semicolons.
    const sql = readSql(INDEX_MIGRATION);
    const start = sql.search(/CREATE\s+UNIQUE\s+INDEX/i);
    expect(start).toBeGreaterThanOrEqual(0);
    const createOnly = sql.slice(start, sql.indexOf(";", start) + 1);
    expect(createOnly).toMatch(/JobAttendance_one_open_check_in/);
    insertAttendance("bf-b", "2026-10-09 08:00:01", null, 1);
    expect(() => db.exec(createOnly)).toThrow(/UNIQUE constraint failed/);
    db.prepare("DELETE FROM \"JobAttendance\" WHERE \"checkOutTime\" IS NULL AND \"checkInTime\" = ?").run("2026-10-09 08:00:01");
  });

  it("applies the shipped migration cleanly and leaves exactly one open row per job", () => {
    expect(() => db.exec(readSql(INDEX_MIGRATION))).not.toThrow();

    const rows = attendance();
    const open = rows.filter((row) => row.checkOutTime === null);
    expect(open).toHaveLength(2);
    expect(new Set(open.map((row) => row.nameKey))).toEqual(new Set(["bf-a", "bf-b"]));

    // The highest id keeps the open interval and its seconds; the losers are closed at
    // their own check-in time with zero seconds, so no work time is invented or lost.
    const bfA = rows.filter((row) => row.nameKey === "bf-a");
    expect(bfA.filter((row) => row.checkOutTime === null)).toHaveLength(1);
    const survivors = bfA.filter((row) => row.checkOutTime === null);
    expect(survivors[0].totalWorkSeconds).toBe(8888);
    for (const row of bfA.filter((row) => row.checkOutTime !== null && row.totalWorkSeconds === 0)) {
      expect(row.checkOutTime).toBe(row.checkInTime);
    }
    // Closed history is untouched.
    const closedHistory = rows.filter((row) => row.totalWorkSeconds === 28800);
    expect(closedHistory).toHaveLength(2);
  });

  it("keeps the constraint afterwards, and still only for open rows", () => {
    expect(() => insertAttendance("bf-a", "2026-10-10 09:00:00", null, 0)).toThrow(
      /UNIQUE constraint failed/,
    );
    expect(() => insertAttendance("bf-a", "2026-10-04 09:00:00", "2026-10-04 17:00:00", 0)).not.toThrow();
  });

  it("survives the later Job rebuild, which is the other new migration in this set", () => {
    expect(allMigrationNames).toContain(REPAIR_MIGRATION);
    expect(() => db.exec(readSql(REPAIR_MIGRATION))).not.toThrow();

    const index = db
      .prepare("SELECT \"sql\" FROM sqlite_master WHERE type = 'index' AND \"name\" = ?")
      .get("JobAttendance_one_open_check_in") as { sql: string } | undefined;
    expect(index?.sql).toMatch(/WHERE "checkOutTime" IS NULL/i);
    expect(() => insertAttendance("bf-b", "2026-10-11 09:00:00", null, 0)).toThrow(
      /UNIQUE constraint failed/,
    );
    // PAR-03's repair lands in the same deployment: the default is now a JSON string.
    const workDays = db
      .prepare("SELECT \"dflt_value\" AS d FROM pragma_table_info('Job') WHERE \"name\" = 'workDays'")
      .get() as { d: string };
    expect(workDays.d).toBe("'[1, 2, 3, 4, 5]'");
    expect(JSON.parse(workDays.d.slice(1, -1))).toEqual([1, 2, 3, 4, 5]);
  });
});
