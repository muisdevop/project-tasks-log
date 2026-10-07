/**
 * AR-02 — Prisma dual-schema parity check.
 *
 * SQLite and Postgres need two schema files (Prisma cannot emit one client for
 * two providers), and nothing in the toolchain notices when someone edits only
 * one of them. This script normalises both files — the datasource `provider`
 * line and formatting/alignment are ignored, everything else must match — and
 * fails with a unified diff when they diverge.
 *
 * Usage: `npm run db:parity` (also wired into CI).
 */
import fs from "node:fs";
import path from "node:path";

const SQLITE_SCHEMA = path.join("prisma", "schema.sqlite.prisma");
const POSTGRES_SCHEMA = path.join("prisma", "postgres", "schema.prisma");

function normalize(file) {
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, " "))
    // Whole-line comments and blank lines carry no schema meaning.
    .filter((line) => line !== "" && !line.startsWith("//"))
    // The only intentional difference between the two files.
    .filter((line) => !/^provider\s*=\s*"(sqlite|postgresql)"$/.test(line));
}

const a = normalize(SQLITE_SCHEMA);
const b = normalize(POSTGRES_SCHEMA);

const differences = [];
const max = Math.max(a.length, b.length);
for (let i = 0; i < max; i += 1) {
  if (a[i] !== b[i]) {
    differences.push({ line: i + 1, sqlite: a[i], postgres: b[i] });
  }
}

if (differences.length === 0) {
  console.log(
    `Schema parity OK: ${a.length} normalized lines match across\n  ${SQLITE_SCHEMA}\n  ${POSTGRES_SCHEMA}`,
  );
  process.exit(0);
}

console.error(
  `Schema drift detected between ${SQLITE_SCHEMA} and ${POSTGRES_SCHEMA} (${differences.length} differing line(s)):\n`,
);
for (const diff of differences.slice(0, 40)) {
  console.error(`  line ${diff.line}`);
  console.error(`    sqlite:   ${diff.sqlite ?? "<file ends>"}`);
  console.error(`    postgres: ${diff.postgres ?? "<file ends>"}`);
}
if (differences.length > 40) {
  console.error(`  ... and ${differences.length - 40} more`);
}
console.error(
  "\nApply the same change to both files, then run `npx prisma format` on each.",
);
process.exit(1);
