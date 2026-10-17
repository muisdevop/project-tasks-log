// RA-22 / RA-25 / RA-26: check the generated Prisma client before trusting it.
//
// The client is one shared directory (`node_modules/.prisma/client`), so the last
// `db:generate*` command wins — and `npm run db:generate:postgres` silently replaces the
// SQLite client the test suite needs. The failure it leaves behind does not name itself:
// every integration file dies with
// "The Driver Adapter @prisma/adapter-better-sqlite3 … is not compatible with the provider
// postgres", which reads like a broken adapter rather than like a stale artefact. This
// measured a full run in the real way during the 2026-10-11 pass (16 files red, one green
// afterwards), so `npm test` now checks the artefact it is about to depend on.
//
// The suite is SQLite-bound: tests/integration/helpers/harness.ts pushes
// prisma/schema.sqlite.prisma and sets DB_PROVIDER=sqlite, so "sqlite" is the only provider
// a green run can be built from.
//
// RA-25: provider alone was not enough. The datasource block can say `sqlite` while the
// models behind it are older than `prisma/schema.sqlite.prisma`, and a table added after the
// last generate then fails at query time — 500 from the API routes, not a test failure. So the
// generated schema text is compared with the source it should have come from. Prisma reformats
// alignment (and strips comments), which is why the comparison normalises whitespace rather than
// hashing bytes; measured on the current tree the two are identical after normalisation.
//
// RA-26: `--notice=<provider>` never blocks. It states what the command about to run will
// throw away, because the Postgres generate is a legitimate thing to do — it is only
// legitimate when you know it clobbers the client the suite is built on.
import fs from "node:fs";
import path from "node:path";

const SOURCE_SCHEMA = path.resolve("prisma", "schema.sqlite.prisma");
const CLIENT_SCHEMA = path.resolve("node_modules/.prisma/client/schema.prisma");

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const noticeFor = flag("notice");
const expected = flag("expect") ?? "sqlite";
if (args.some((a) => a.startsWith("--") && !/^--(notice|expect)=/.test(a))) {
  console.error("usage: node scripts/check-prisma-client.mjs [--expect=sqlite|postgresql] [--notice=<provider the next generate will write>]");
  process.exit(64);
}

function fail(message, code) {
  console.error(`PRISMA_CLIENT_CHECK_FAILED: ${message}`);
  process.exit(code);
}

function read(file, missingCode) {
  if (!fs.existsSync(file)) {
    fail(
      `${path.relative(process.cwd(), file)} is missing — the client has never been generated. Run: npm run db:generate`,
      missingCode,
    );
  }
  return fs.readFileSync(file, "utf8");
}

const providerOf = (source) =>
  /provider\s*=\s*"([a-z-]+)"/i.exec(source.slice(source.indexOf("datasource")))?.[1];

// Prisma's own formatter: column alignment differs, comments do not survive. Neither is a
// schema change, so both are normalised away before comparing.
const normalise = (source) =>
  source
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .join("\n");

const source = read(CLIENT_SCHEMA, 2);
const provider = providerOf(source);
if (!provider) {
  fail(`no datasource provider found in ${path.relative(process.cwd(), CLIENT_SCHEMA)}`, 2);
}

if (noticeFor) {
  console.log(
    `CLIENT_CLOBBER_NOTICE: the generated client on disk targets "${provider}"; the command ` +
      `you are about to run writes a "${noticeFor}" one over it, in the same directory. ` +
      (noticeFor === "postgresql"
        ? `After it, \`npm test\` and \`npm test:integration\` will refuse to run until you regenerate ` +
          `with \`npm run db:generate\` (RA-26).`
        : `Restore with \`npm run db:generate\`.`),
  );
  process.exit(0);
}

if (provider !== expected) {
  fail(
    `the generated client targets "${provider}", but this check expects "${expected}"` +
      (expected === "sqlite"
        ? ` — the suite runs against SQLite (tests/integration/helpers/harness.ts pushes ` +
          `prisma/schema.sqlite.prisma). This is what \`npm run db:generate:postgres\` leaves ` +
          `behind, and it looks like an adapter bug, not a stale artefact. Fix: npm run db:generate`
        : `. Fix: generate with the matching schema`),
    1,
  );
}

if (expected === "sqlite") {
  if (!fs.existsSync(SOURCE_SCHEMA)) {
    fail(`${path.relative(process.cwd(), SOURCE_SCHEMA)} is missing — cannot verify the client is current`, 2);
  }
  if (normalise(read(SOURCE_SCHEMA, 2)) !== normalise(source)) {
    fail(
      `the generated client's schema text differs from prisma/schema.sqlite.prisma, so the client ` +
        `is older than the schema even though its provider matches (RA-25): a model added since the ` +
        `last generate is absent from the client, and the app fails at query time rather than here. ` +
        `Fix: npm run db:generate (then push it — \`npm run db:push\` or the harness does)`,
      1,
    );
  }
}

console.log(
  `PRISMA_CLIENT_OK generated client targets ${provider}` +
    (expected === "sqlite" ? " and matches prisma/schema.sqlite.prisma" : ""),
);
