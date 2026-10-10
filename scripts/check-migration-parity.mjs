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
 * Unquoted-bracket defaults that already shipped and cannot be repaired without a table
 * rebuild on live data. Each entry is a tracked finding, not a silent exemption: adding a
 * *new* one fails the check, and this list only shrinks.
 */
const KNOWN_UNQUOTED_DEFAULTS = [
  {
    file: path.join("prisma", "migrations", "20260327201323_add_job_hierarchy", "migration.sql"),
    line: 21,
    finding: "PAR-03",
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

function unquotedDefaults(files) {
  const hits = [];
  for (const file of files) {
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
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
    `(${[...seeded.sqlite].sort().join(", ") || "nothing"}), and no unquoted JSON default outside the tracked list.`,
);
