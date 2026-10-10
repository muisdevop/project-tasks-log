/**
 * RA-20 / PAR-02 guard — the migration sets, not just the schemas.
 *
 * `npm run db:parity` (AR-02) compares `prisma/schema.sqlite.prisma` with
 * `prisma/postgres/schema.prisma` line by line, and it is a good check. It cannot see the
 * two things that actually went wrong in this campaign:
 *
 *   1. The SQLite set seeds a default `Job` row and the Postgres set seeded nothing, so a
 *      fresh Postgres deployment booted with an empty board (PAR-02). Identical schema
 *      files, different data.
 *   2. `DEFAULT [1, 2, 3, 4, 5]` in a SQLite migration is not a JSON array: bracket
 *      quoting is SQLite's *identifier* quote, so the column default became the bare
 *      string `1, 2, 3, 4, 5`. Measured — an insert that omits the column stores that
 *      string, which is not valid JSON. Nothing in the toolchain noticed (PAR-03).
 *
 * Both are static facts about files in the repository, so this script needs no database
 * and runs in CI. Usage: `npm run db:parity:migrations`.
 */
import fs from "node:fs";
import path from "node:path";

const SETS = {
  sqlite: path.join("prisma", "migrations"),
  postgres: path.join("prisma", "postgres", "migrations"),
};

/**
 * Unquoted-bracket defaults that already shipped and cannot be repaired by editing the
 * applied file. Each entry is a tracked finding, not a silent exemption: adding a *new*
 * one fails the check, this list only shrinks, and `repairedBy` is mandatory — the named
 * later migration has to exist and quote the default, so an allowlisted defect can never
 * also be an unrepaired one.
 */
const KNOWN_UNQUOTED_DEFAULTS = [
  {
    file: path.join("prisma", "migrations", "20260327201323_add_job_hierarchy", "migration.sql"),
    line: 21,
    finding: "PAR-03",
    repairedBy: path.join("prisma", "migrations", "20261010182000_fix_job_workdays_default", "migration.sql"),
  },
];

function migrationsIn(dir) {
  if (!fs.existsSync(dir)) {
    throw new Error(`Migration directory not found: ${dir}`);
  }
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(dir, entry.name, "migration.sql"))
    .filter((file) => fs.existsSync(file))
    .sort();
}

function insertedTables(files) {
  const tables = new Set();
  for (const file of files) {
    const sql = fs.readFileSync(file, "utf8");
    // Prisma's SQLite migrations rebuild a table by copying it: `CREATE TABLE "new_Job"`,
    // `INSERT INTO "new_Job" SELECT * FROM "Job"`, `DROP TABLE "Job"`, `RENAME`. That
    // copies existing rows, it does not seed data, and the Postgres set — which needs no
    // such dance — would never contain it. Detect the copy by the RENAME that completes it.
    const rebuilds = new Set(
      [...sql.matchAll(/ALTER\s+TABLE\s+"?new_([A-Za-z0-9_]+)"?\s+RENAME\s+TO\s+"?([A-Za-z0-9_]+)"?/gi)]
        .map((match) => match[2]),
    );
    for (const match of sql.matchAll(/INSERT\s+INTO\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\s/gi)) {
      const table = match[1];
      if (table.startsWith("new_") && rebuilds.has(table.slice(4))) continue;
      if (table === "_prisma_migrations") continue;
      tables.add(table);
    }
  }
  return tables;
}

/**
 * PAR-04 guard — schema objects a Prisma schema cannot express.
 *
 * A partial unique index (`CREATE UNIQUE INDEX … WHERE …`) is valid on both shipped
 * engines and is the only way to make "at most one open check-in per job" a rule the
 * database enforces, but `npm run db:parity` cannot see it: the object is absent from
 * both schema files by construction, so the two migration sets are its only home. This
 * rule requires every index named in REQUIRED_PARTIAL_INDEXES to exist in both sets with
 * the same table, columns and predicate, and requires the SQLite copy to be the one the
 * integration harness applies — otherwise `db push`-built test databases quietly lack the
 * constraint the deployments have, and the tests that depend on it would be proving
 * nothing.
 */
const REQUIRED_PARTIAL_INDEXES = ["JobAttendance_one_open_check_in"];

const INTEGRATION_HARNESS = path.join("tests", "integration", "helpers", "harness.ts");

function normalizeSqlFragment(text) {
  return text.replace(/\s+/g, " ").replace(/"/g, "").trim();
}

function partialUniqueIndexes(files) {
  const byName = new Map();
  for (const file of files) {
    const sql = codeLines(fs.readFileSync(file, "utf8")).join("\n");
    for (const match of sql.matchAll(
      /CREATE\s+UNIQUE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([A-Za-z0-9_]+)"?\s+ON\s+"?([A-Za-z0-9_]+)"?\s*\(([^)]*)\)\s*(WHERE\b[^;]*)/gis,
    )) {
      const predicate = normalizeSqlFragment(match[4] ?? "");
      // Only partial ones: a plain unique index has no predicate and Prisma's schema
      // already covers it through `@@unique`.
      if (!/^WHERE\b/i.test(predicate)) continue;
      byName.set(match[1], {
        file,
        table: match[2],
        columns: normalizeSqlFragment(match[3]),
        predicate,
      });
    }
  }
  return byName;
}

/**
 * Rule E's test: the file that creates `indexName` must resolve the rows that already
 * violate it (an `UPDATE` or a `DELETE`) somewhere above the `CREATE UNIQUE INDEX`. Without
 * that, `migrate deploy` on a database produced by the old race aborts and the app never
 * boots — the shape PAR-09 was filed for.
 */
function backfillPrecedesIndex(file, indexName) {
  const sql = codeLines(fs.readFileSync(file, "utf8")).join("\n");
  const at = sql.search(
    new RegExp(`CREATE\\s+UNIQUE\\s+INDEX\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?"?${indexName}"?`, "i"),
  );
  if (at < 0) return false;
  return /\b(UPDATE|DELETE\s+FROM)\b/i.test(sql.slice(0, at));
}

function unquotedDefaults(files) {
  const hits = [];
  for (const file of files) {
    const lines = codeLines(fs.readFileSync(file, "utf8"));
    lines.forEach((text, index) => {
      // `DEFAULT [` — SQLite reads the bracketed run as an identifier, not an array.
      // `DEFAULT (SELECT` / function defaults are not constant defaults either, but the
      // engines reject those at DDL time, so they cannot reach a shipped migration.
      if (/DEFAULT\s+\[/i.test(text)) {
        hits.push({ file, line: index + 1, text: text.trim() });
      }
    });
  }
  return hits;
}

const problems = [];
const report = [];

for (const [provider, dir] of Object.entries(SETS)) {
  const files = migrationsIn(dir);
  report.push(`${provider}: ${files.length} migrations in ${dir}`);
}

const seeded = {
  sqlite: insertedTables(migrationsIn(SETS.sqlite)),
  postgres: insertedTables(migrationsIn(SETS.postgres)),
};
for (const [provider, other] of [
  ["sqlite", "postgres"],
  ["postgres", "sqlite"],
]) {
  for (const table of seeded[provider]) {
    if (!seeded[other].has(table)) {
      problems.push(
        `${table} is seeded by the ${provider} migration set but not by ${other} — a fresh ${other} deployment starts without those rows (PAR-02's shape).`,
      );
    }
  }
}

const known = new Set(KNOWN_UNQUOTED_DEFAULTS.map((k) => `${k.file}:${k.line}`));
for (const dir of Object.values(SETS)) {
  for (const hit of unquotedDefaults(migrationsIn(dir))) {
    const at = `${hit.file}:${hit.line}`;
    if (known.has(at)) continue;
    problems.push(
      `${at} declares a constant default with a bracketed token (${hit.text}) — SQLite parses that as an identifier and stores a non-JSON string. Quote the JSON: DEFAULT '[...]'.`,
    );
  }
}

if (known.size > 0) {
  const stillThere = [...known].filter((at) => {
    const [file, line] = at.split(":");
    const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/)[Number(line) - 1] : "";
    return /DEFAULT\s+\[/i.test(text ?? "");
  });
  if (stillThere.length < known.size) {
    problems.push(
      `The known-unquoted-defaults list is stale: ${known.size - stillThere.length} entr(ies) no longer match a real defect. Delete them from scripts/check-migration-parity.mjs.`,
    );
  }
}

// Every allowlisted defect must be repaired by a later migration in the same set, so the
// list can only ever be a record of shipped files that cannot be edited — never a place to
// park a live defect (PAR-03).
for (const entry of KNOWN_UNQUOTED_DEFAULTS) {
  const repair = entry.repairedBy;
  if (!repair) {
    problems.push(`${entry.file}:${entry.line} (${entry.finding}) has no "repairedBy" entry — an unquoted default must be superseded, not just recorded.`);
    continue;
  }
  if (!fs.existsSync(repair)) {
    problems.push(`${entry.finding} is allowlisted as repaired by ${repair}, which does not exist.`);
    continue;
  }
  const repairSql = fs.readFileSync(repair, "utf8");
  if (!/DEFAULT\s+'\[/.test(repairSql)) {
    problems.push(`${repair} is named as the ${entry.finding} repair but contains no quoted JSON default.`);
  }
  const defectiveVersion = path.basename(path.dirname(entry.file));
  const repairVersion = path.basename(path.dirname(repair));
  if (repairVersion <= defectiveVersion) {
    problems.push(`${repair} repairs ${entry.file} but sorts before it (${repairVersion} <= ${defectiveVersion}) — the repair has to be a later migration, or the set applies the wrong default last.`);
  }
}

/**
 * The executable text of each line, with `--` tails and `/* … *\/` blocks removed but the
 * line numbering intact, so a hit can still be reported as `file:line`. Both scanners need
 * this: a rationale comment that quotes the defect it is fixing is not a second defect —
 * which is exactly what the 20261010182000 repair migration does (PAR-03).
 */
function codeLines(source) {
  let inBlock = false;
  return source.split(/\r?\n/).map((line) => {
    let text = line;
    if (inBlock) {
      const close = text.indexOf("*/");
      if (close === -1) return "";
      inBlock = false;
      text = text.slice(close + 2);
    }
    const open = text.indexOf("/*");
    if (open !== -1) {
      const rest = text.slice(open + 2);
      const close = rest.indexOf("*/");
      if (close === -1) {
        inBlock = true;
        text = text.slice(0, open);
      } else {
        text = text.slice(0, open) + rest.slice(close + 2);
      }
    }
    return text.split("--")[0];
  });
}

const partials = {
  sqlite: partialUniqueIndexes(migrationsIn(SETS.sqlite)),
  postgres: partialUniqueIndexes(migrationsIn(SETS.postgres)),
};

for (const name of REQUIRED_PARTIAL_INDEXES) {
  const sqlite = partials.sqlite.get(name);
  const postgres = partials.postgres.get(name);
  if (!sqlite || !postgres) {
    problems.push(
      `${name} is ${sqlite ? "only in the SQLite" : postgres ? "only in the Postgres" : "in neither"} migration set — PAR-04's constraint has to exist on both providers, because the race exists on both.`,
    );
    continue;
  }
  if (
    sqlite.table !== postgres.table ||
    sqlite.columns !== postgres.columns ||
    sqlite.predicate !== postgres.predicate
  ) {
    problems.push(
      `${name} differs between the sets: SQLite ${sqlite.table}(${sqlite.columns}) ${sqlite.predicate} vs Postgres ${postgres.table}(${postgres.columns}) ${postgres.predicate}. The two databases would be enforcing different rules.`,
    );
  }
  const relative = path.relative(process.cwd(), sqlite.file).replace(/\\/g, "/");
  const harness = fs.readFileSync(INTEGRATION_HARNESS, "utf8").replace(/\\/g, "/");
  if (!harness.includes(relative)) {
    problems.push(
      `${relative} creates ${name}, but tests/integration/helpers/harness.ts does not apply it. \`db push\` builds the test databases from the schema file alone, and a partial index is not in it — without that step the integration suite is testing a constraint no test database has.`,
    );
  }
  // Rule E: the index must not be the first thing the file does. A live database can
  // already contain the rows the race produced, and `CREATE UNIQUE INDEX` over those
  // aborts `migrate deploy` — the deployment never boots. So the same file has to
  // resolve the existing violations (an UPDATE or DELETE) before creating the index.
  // PAR-09; the behaviour itself is proven by tests/unit/migration-attendance-backfill.test.ts.
  for (const [provider, entry] of [
    ["SQLite", sqlite],
    ["Postgres", postgres],
  ]) {
    if (!backfillPrecedesIndex(entry.file, name)) {
      problems.push(
        `${entry.file} (${provider}) creates the partial index ${name} without resolving existing violations first in the same file: a deployment that already holds duplicate rows fails \`migrate deploy\` and never boots. Put the backfill above the CREATE.`,
      );
    }
  }
}

for (const line of report) console.log(line);

if (problems.length > 0) {
  console.error(`\nMigration-set drift between SQLite and Postgres (${problems.length} problem(s)):\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    "\nAdd the equivalent migration to the other set (never edit an applied migration),\n" +
      "or correct the default. `npm run db:parity` checks the schemas; this checks the data.",
  );
  process.exit(1);
}

console.log(
  `Migration parity OK: both sets seed the same tables ` +
    `(${[...seeded.sqlite].sort().join(", ") || "nothing"}), ` +
    `both define the same partial unique index ` +
    `(${[...partials.sqlite.keys()].sort().join(", ") || "none"}) and backfill it before creating it, ` +
    `and no unquoted JSON default outside the tracked list.`,
);
