/**
 * Unit: the MF-06 backup/restore CLIs.
 *
 * `scripts/backup.ts` and `scripts/restore.ts` are deliberately import-safe (the
 * CLI only runs when the file is the process entry point), so every assertion
 * here calls the real implementation — including real `better-sqlite3` snapshots
 * against a throwaway database file — without spawning a child process.
 * Postgres-only paths are covered where they can be proven offline: the
 * `pg_dump` / `psql` lookups are forced to miss through `PG_DUMP_PATH` /
 * `PSQL_PATH`, which is exactly what happens on a machine without the client
 * tools, so the "fail loudly with the manual command" contract is testable.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  BACKUP_FORMAT,
  EXIT,
  MANIFEST_NAME,
  SQLITE_PAYLOAD_NAME,
  assertInsideBackupRoot,
  assertNoSecrets,
  buildManifest,
  collectSecretValues,
  countSqliteTablesFromSnapshot,
  detectProvider,
  parseArgs,
  readAppVersion,
  readManifest,
  redactConnectionUrl,
  redactSecrets,
  resolveBackupRoot,
  resolveDatabaseUrl,
  runBackupCli,
  snapshotDirName,
  sqliteFilePathFromUrl,
  timestampSlug,
  slugifyLabel,
  verifyPayload,
  verifySqliteIntegrity,
  type Manifest,
} from "../../scripts/backup";
import {
  resolveSnapshotDir,
  runRestoreCli,
  renderPreview,
  planRestore,
  assertTargetOutsideBackups,
  compareCounts,
  type RestorePlan,
} from "../../scripts/restore";

const SESSION_SECRET = "unit-suite-session-secret-0123456789";
const APP_PASSWORD = "unit-app-password-xyz";
const BCRYPT_HASH = "$2b$12$abcdefghijklmnopqrstuvwxyz012345678901234567890123456";

let tempDir = "";
let dbFile = "";
let backupRoot = "";
let env: NodeJS.ProcessEnv;
let printed: string[];
let errors: string[];

function io() {
  return {
    env,
    cwd: tempDir,
    out: (line: string) => printed.push(line),
    err: (line: string) => errors.push(line),
  };
}

function digest(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** A minimal env for the pure resolvers (Node's ProcessEnv type is nominal-ish). */
function overrides(values: Record<string, string>): NodeJS.ProcessEnv {
  return { ...values } as NodeJS.ProcessEnv;
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gid-backup-test-"));
  dbFile = path.join(tempDir, "dev.db");
  backupRoot = path.join(tempDir, "backups");

  const db = new Database(dbFile);
  db.exec('CREATE TABLE "Job" (id INTEGER PRIMARY KEY, name TEXT)');
  db.exec('CREATE TABLE "Task" (id INTEGER PRIMARY KEY, title TEXT)');
  db.exec('CREATE TABLE "ApiToken" (id INTEGER PRIMARY KEY, tokenHash TEXT)');
  db.exec("CREATE TABLE _prisma_migrations (id TEXT PRIMARY KEY)");
  db.prepare('INSERT INTO "Job" (name) VALUES (?)').run("Backup Job");
  db.prepare('INSERT INTO "Task" (title) VALUES (?)').run("Backup Task");
  db.prepare('INSERT INTO "ApiToken" (tokenHash) VALUES (?)').run("deadbeef".repeat(8));
  db.close();

  env = {
    ...(process.env as NodeJS.ProcessEnv),
    DB_PROVIDER: "sqlite",
    PRISMA_SCHEMA_PATH: "prisma/schema.sqlite.prisma",
    DATABASE_URL: `file:${dbFile.replace(/\\/g, "/")}`,
    DATABASE_URL_SQLITE: `file:${dbFile.replace(/\\/g, "/")}`,
    SESSION_SECRET,
    APP_PASSWORD,
    APP_PASSWORD_HASH: BCRYPT_HASH,
    GID_BACKUP_DIR: backupRoot,
  };
  printed = [];
  errors = [];
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("provider + path resolution", () => {
  it("mirrors src/lib/prisma.ts precedence", () => {
    expect(detectProvider(overrides({ DB_PROVIDER: "postgres" }))).toBe("postgres");
    expect(detectProvider(overrides({ PRISMA_SCHEMA_PATH: "prisma/postgres/schema.prisma" }))).toBe(
      "postgres",
    );
    expect(detectProvider(overrides({ DATABASE_URL: "postgresql://u:p@h/db" }))).toBe("postgres");
    expect(detectProvider(overrides({ DATABASE_URL: "file:./dev.db" }))).toBe("sqlite");
    expect(detectProvider(overrides({}))).toBe("sqlite");
  });

  it("resolves a connection per provider and refuses a mismatch", () => {
    expect(resolveDatabaseUrl(env, "sqlite")).toBe(env.DATABASE_URL);
    expect(
      resolveDatabaseUrl(overrides({ DATABASE_URL_POSTGRES: "postgresql://u@h:5432/d" }), "postgres"),
    ).toBe("postgresql://u@h:5432/d");
    expect(() => resolveDatabaseUrl(overrides({ DATABASE_URL: "file:./x.db" }), "postgres")).toThrow(
      /resolved to postgres/,
    );
    expect(() => resolveDatabaseUrl(overrides({ DATABASE_URL: "postgresql://u@h/d" }), "sqlite")).toThrow(
      /resolved to sqlite/,
    );
  });

  it("turns file: URLs into absolute paths on POSIX and Windows shapes", () => {
    const posix = sqliteFilePathFromUrl("file:/data/dev.db", "/app");
    expect(posix).toMatch(/\/data\/dev\.db$/);
    expect(sqliteFilePathFromUrl("file:./dev.db?mode=rwc", tempDir)).toBe(dbFile);
    expect(sqliteFilePathFromUrl("file:C:/Users/x/dev.db", tempDir)).toMatch(/C:.*dev\.db$/);
    expect(() => sqliteFilePathFromUrl("postgresql://h/d", tempDir)).toThrow(/Not a SQLite file URL/);
  });

  it("puts snapshots next to the database by default and honours GID_BACKUP_DIR", () => {
    expect(resolveBackupRoot(overrides({ DB_PROVIDER: "sqlite" }), "/app", "sqlite", "/data/dev.db")).toBe(
      path.join(path.dirname("/data/dev.db"), "backups"),
    );
    expect(resolveBackupRoot(overrides({}), "/app", "postgres")).toBe(path.join("/app", "backups"));
    expect(
      resolveBackupRoot(overrides({ GID_BACKUP_DIR: "relative/override" }), "/app", "sqlite"),
    ).toBe(path.resolve("/app", "relative/override"));
    // An explicit override wins over the database-adjacent default.
    expect(resolveBackupRoot(env, tempDir, "sqlite", dbFile)).toBe(backupRoot);
  });

  it("refuses every path outside the backup root", () => {
    const root = path.join(tempDir, "backups");
    expect(assertInsideBackupRoot(path.join(root, "2026-10-08T10-00-00Z"), root)).toBe(
      path.join(root, "2026-10-08T10-00-00Z"),
    );
    expect(() => assertInsideBackupRoot(path.join(tempDir, "sneaky"), root)).toThrow(/must live inside/);
    // `..` traversal and the root itself are both rejected.
    expect(() => assertInsideBackupRoot(path.resolve(root, "..", "..", "elsewhere"), root)).toThrow(
      /must live inside/,
    );
    expect(() => assertInsideBackupRoot(root, root)).toThrow(/must live inside/);
  });

  it("keeps the live database out of the backup root", () => {
    expect(() => assertTargetOutsideBackups(path.join(backupRoot, "dev.db"), backupRoot)).toThrow(
      /inside the backup root/,
    );
    expect(assertTargetOutsideBackups(dbFile, backupRoot)).toBe(dbFile);
  });

  it("builds filesystem-safe snapshot names", () => {
    const now = new Date("2026-10-08T12:34:56.789Z");
    expect(timestampSlug(now)).toBe("2026-10-08T12-34-56Z");
    expect(snapshotDirName(now)).toBe("2026-10-08T12-34-56Z");
    expect(snapshotDirName(now, "Nightly Run")).toBe("2026-10-08T12-34-56Z-nightly-run");
    expect(slugifyLabel("  !!!  ")).toBeNull();
    expect(slugifyLabel("a/b\\c:d")).toBe("a-b-c-d");
  });
});

describe("secret hygiene", () => {
  it("collects env secrets and connection passwords", () => {
    const secrets = collectSecretValues({
      ...env,
      DATABASE_URL: "postgresql://admin:s3cret-pg-pass@db:5432/app",
    });
    expect(secrets).toContain(SESSION_SECRET);
    expect(secrets).toContain(APP_PASSWORD);
    expect(secrets).toContain(BCRYPT_HASH);
    expect(secrets).toContain("s3cret-pg-pass");
    expect(secrets).not.toContain("admin");
  });

  it("redacts and then hard-refuses anything it cannot mask", () => {
    const secrets = collectSecretValues(env);
    expect(redactSecrets(`password=${APP_PASSWORD} secret ${SESSION_SECRET}`, secrets)).toBe(
      "password=[redacted] secret [redacted]",
    );
    expect(redactConnectionUrl("postgresql://admin:s3cret@db:5432/app")).toBe(
      "postgresql://admin:***@db:5432/app",
    );
    expect(redactConnectionUrl("postgres://db:5432/app?password=hidden")).toBe(
      "postgres://db:5432/app?password=***",
    );
    expect(() => assertNoSecrets(`leaked ${SESSION_SECRET}`, secrets, "a line")).toThrow(
      /would leak an environment secret/,
    );
  });
});

describe("sqlite snapshot primitives", () => {
  it("counts rows, skipping provider bookkeeping tables", () => {
    const { counts, totals } = countSqliteTablesFromSnapshot(dbFile);
    expect(counts).toEqual({ Job: 1, Task: 1, ApiToken: 1 });
    expect(totals).toEqual({ tables: 3, rows: 3 });
  });

  it("rejects a corrupted file with a verification exit code", () => {
    const bad = path.join(tempDir, "bad.db");
    fs.writeFileSync(bad, "this is not a database");
    try {
      verifySqliteIntegrity(bad);
      expect.unreachable("integrity check should have thrown");
    } catch (error) {
      expect((error as { exitCode?: number }).exitCode).toBe(EXIT.VERIFY_FAILED);
    }
  });

  it("reads app version from package.json without failing when absent", () => {
    // Asserted against package.json rather than a literal: pinning "0.1.0" here
    // meant the 0.2.0 release bump failed the suite on CI, where NODE_ENV differs
    // from a developer shell and nothing else re-ran these files.
    const declared = (
      JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
        version: string;
      }
    ).version;
    expect(readAppVersion(process.cwd())).toBe(declared);
    expect(readAppVersion(process.cwd())).toMatch(/^\d+\.\d+\.\d+$/);
    expect(readAppVersion(path.join(tempDir, "nope"))).toBe("0.0.0");
  });

  it("parses argv into flags and positionals", () => {
    expect(parseArgs(["snap", "--force", "--label=x", "--json"])).toEqual({
      flags: { force: true, label: "x", json: true },
      positionals: ["snap"],
    });
    expect(parseArgs([])).toEqual({ flags: {}, positionals: [] });
  });
});

describe("db:backup CLI", () => {
  it("writes a payload plus manifest and reports the digest", async () => {
    const code = await runBackupCli(["--label", "nightly"], io());
    expect(code).toBe(EXIT.OK);

    const dirs = fs.readdirSync(backupRoot);
    expect(dirs).toHaveLength(1);
    expect(dirs[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-nightly$/);

    const snapshotDir = path.join(backupRoot, dirs[0] as string);
    const manifest = readManifest(snapshotDir);
    const payloadFile = path.join(snapshotDir, manifest.payload.file);

    expect(manifest.format).toBe(BACKUP_FORMAT);
    expect(manifest.formatVersion).toBe(1);
    // The CLI runs with the temp dir as cwd, so package.json is legitimately
    // absent here; `readAppVersion` is asserted against the repo elsewhere.
    expect(manifest.appVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.dbProvider).toBe("sqlite");
    expect(manifest.label).toBe("nightly");
    expect(manifest.createdAt).toMatch(/Z$/);
    expect(manifest.payload.kind).toBe("sqlite-file");
    expect(manifest.payload.sha256).toBe(digest(payloadFile));
    expect(manifest.payload.bytes).toBe(fs.statSync(payloadFile).size);
    expect(manifest.rowCounts).toEqual({ Job: 1, Task: 1, ApiToken: 1 });
    expect(manifest.totals).toEqual({ tables: 3, rows: 3 });
    expect(manifest.secretHandling.envSecretsWritten).toBe(false);

    // A snapshot is self-contained: no WAL sidecars that would break the digest.
    expect(fs.existsSync(`${payloadFile}-wal`)).toBe(false);
    expect(fs.existsSync(`${payloadFile}-shm`)).toBe(false);

    // The copy is a real database with the live rows in it.
    expect(countSqliteTablesFromSnapshot(payloadFile).counts).toEqual({ Job: 1, Task: 1, ApiToken: 1 });

    const allOutput = [...printed, ...errors].join("\n");
    for (const secret of collectSecretValues(env)) {
      expect(allOutput).not.toContain(secret);
    }
    expect(printed.join("\n")).toContain("snapshot method : backup-api");
  });

  it("--dry-run writes nothing and --out cannot escape the backup root", async () => {
    expect(await runBackupCli(["--dry-run"], io())).toBe(EXIT.OK);
    expect(fs.existsSync(backupRoot)).toBe(false);

    expect(await runBackupCli(["--out", "../escaped"], io())).toBe(EXIT.USAGE);
    expect(await runBackupCli(["--out", path.join(os.tmpdir(), "elsewhere")], io())).toBe(EXIT.USAGE);
    expect(fs.existsSync(backupRoot)).toBe(false);
    expect(errors.join("\n")).toMatch(/must live inside/);
  });

  it("--exclude-tokens removes ApiToken rows from the snapshot copy only", async () => {
    expect(await runBackupCli(["--exclude-tokens", "--label", "safe"], io())).toBe(EXIT.OK);

    const snapshotDir = path.join(backupRoot, fs.readdirSync(backupRoot)[0] as string);
    const manifest = readManifest(snapshotDir);
    expect(manifest.rowCounts.ApiToken).toBe(0);
    expect(manifest.secretHandling.excludedTables).toEqual({ ApiToken: 1 });

    // The live database is untouched.
    expect(countSqliteTablesFromSnapshot(dbFile).counts.ApiToken).toBe(1);
  });

  it("never overwrites an existing snapshot and exposes usage/errors as exit codes", async () => {
    const fixed = { ...io(), env: env, cwd: tempDir };
    expect(await runBackupCli(["--out", "snap-1"], fixed)).toBe(EXIT.OK);
    expect(await runBackupCli(["--out", "snap-1"], fixed)).toBe(EXIT.USAGE);
    expect(errors.join("\n")).toMatch(/already exists/);

    expect(await runBackupCli(["--bogus"], io())).toBe(EXIT.USAGE);
    expect(await runBackupCli(["stray-argument"], io())).toBe(EXIT.USAGE);
    expect(await runBackupCli(["--help"], io())).toBe(EXIT.OK);
    expect(printed.join("\n")).toMatch(/Usage: npm run db:backup/);
  });

  it("prints the manifest as JSON with --json", async () => {
    expect(await runBackupCli(["--json"], io())).toBe(EXIT.OK);
    const last = printed[printed.length - 1] as string;
    const parsed = JSON.parse(last) as Manifest;
    expect(parsed.payload.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("fails loudly when the sqlite file is missing", async () => {
    env.DATABASE_URL = `file:${path.join(tempDir, "gone", "dev.db").replace(/\\/g, "/")}`;
    expect(await runBackupCli([], io())).toBe(EXIT.MISSING_TOOL);
    expect(errors.join("\n")).toMatch(/database file not found/i);
  });

  it("fails with exit 3 and a manual command when pg_dump is unavailable", async () => {
    env.DB_PROVIDER = "postgres";
    env.PRISMA_SCHEMA_PATH = "prisma/postgres/schema.prisma";
    env.DATABASE_URL = "postgresql://admin:s3cret-pg-pass@127.0.0.1:1/app";
    env.PG_DUMP_PATH = "pg_dump-that-does-not-exist";

    expect(await runBackupCli([], io())).toBe(EXIT.MISSING_TOOL);
    const message = errors.join("\n");
    expect(message).toMatch(/pg_dump was not found/);
    expect(message).toMatch(/PG_DUMP_PATH/);
    expect(message).not.toContain("s3cret-pg-pass");
  });

  it("rolls back a half-written snapshot when the dump command fails", async () => {
    env.DB_PROVIDER = "postgres";
    env.PRISMA_SCHEMA_PATH = "prisma/postgres/schema.prisma";
    env.DATABASE_URL = "postgresql://admin:s3cret-pg-pass@127.0.0.1:1/app";
    // A real binary that answers `--version` and then fails on any pg_dump flag:
    // node itself. Deterministic on Windows and Linux, and it exercises the
    // rollback rather than a mock.
    env.PG_DUMP_PATH = process.execPath;

    const code = await runBackupCli([], io());
    expect(code).toBe(EXIT.MISSING_TOOL);
    expect(errors.join("\n")).toMatch(/pg_dump failed/);
    expect(errors.join("\n")).not.toContain("s3cret-pg-pass");
    // The incomplete snapshot directory is cleaned up, not left behind.
    expect(fs.existsSync(backupRoot) ? fs.readdirSync(backupRoot) : []).toEqual([]);
  });
});

describe("manifest verification", () => {
  async function makeSnapshot(): Promise<string> {
    expect(await runBackupCli([], io())).toBe(EXIT.OK);
    return path.join(backupRoot, fs.readdirSync(backupRoot)[0] as string);
  }

  it("rejects a directory that is not a backup", () => {
    expect(() => readManifest(tempDir)).toThrow(/No manifest\.json/);
    fs.mkdirSync(path.join(tempDir, "other"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, "other", MANIFEST_NAME), "not json");
    expect(() => readManifest(path.join(tempDir, "other"))).toThrow(/not valid JSON/);
    fs.writeFileSync(
      path.join(tempDir, "other", MANIFEST_NAME),
      JSON.stringify({ format: "something-else" }),
    );
    expect(() => readManifest(path.join(tempDir, "other"))).toThrow(/is not a gid-taskflow-backup manifest/);
  });

  it("detects a tampered payload and a truncated payload", async () => {
    const snapshotDir = await makeSnapshot();
    const payload = path.join(snapshotDir, SQLITE_PAYLOAD_NAME);

    await expect(verifyPayload(readManifest(snapshotDir), snapshotDir)).resolves.toBeUndefined();

    fs.appendFileSync(payload, "corruption");
    await expect(verifyPayload(readManifest(snapshotDir), snapshotDir)).rejects.toThrow(/Checksum mismatch/);

    fs.rmSync(payload);
    expect(() => readManifest(snapshotDir)).toThrow(/Payload .* is missing/);
  });

  it("compares restored row counts against the manifest", async () => {
    const snapshotDir = await makeSnapshot();
    const manifest = readManifest(snapshotDir);
    expect(
      compareCounts(manifest, {
        counts: { Job: 1, Task: 1, ApiToken: 1 },
        totals: { tables: 3, rows: 3 },
      }).ok,
    ).toBe(true);

    const drift = compareCounts(manifest, {
      counts: { Job: 2, Task: 1 },
      totals: { tables: 2, rows: 3 },
    });
    expect(drift.ok).toBe(false);
    expect(drift.detail).toMatch(/Job has 2 rows, snapshot says 1/);
    expect(drift.detail).toMatch(/ApiToken is missing/);
  });

  it("builds a manifest that survives the secret audit", async () => {
    const snapshotDir = await makeSnapshot();
    const manifest = readManifest(snapshotDir);
    const plan = {
      provider: "sqlite" as const,
      connectionString: env.DATABASE_URL as string,
      sqliteDbFile: dbFile,
      backupRoot,
      snapshotDir,
      payloadFile: path.join(snapshotDir, SQLITE_PAYLOAD_NAME),
      payloadKind: "sqlite-file" as const,
      excludeTokens: false,
    };
    const rebuilt = buildManifest({
      plan,
      now: new Date("2026-10-08T00:00:00Z"),
      appVersion: "9.9.9",
      payloadFile: plan.payloadFile,
      counts: countSqliteTablesFromSnapshot(plan.payloadFile),
      excludedTables: {},
      label: "rebuilt",
    });
    const text = JSON.stringify(rebuilt);
    expect(rebuilt.createdAt).toBe("2026-10-08T00:00:00.000Z");
    expect(rebuilt.appVersion).toBe("9.9.9");
    expect(rebuilt.label).toBe("rebuilt");
    for (const secret of collectSecretValues(env)) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toContain(env.DATABASE_URL_SQLITE as string);

    // The manifest that is actually on disk is the one `db:restore` reads, so it
    // has to clear the same bar as a freshly rebuilt one.
    expect(manifest.format).toBe(BACKUP_FORMAT);
    expect(manifest.dbProvider).toBe("sqlite");
    expect(manifest.secretHandling.envSecretsWritten).toBe(false);
    const onDisk = JSON.stringify(manifest);
    for (const secret of collectSecretValues(env)) {
      expect(onDisk).not.toContain(secret);
    }
    expect(onDisk).not.toContain(env.DATABASE_URL_SQLITE as string);
  });
});

describe("db:restore CLI", () => {
  async function snapshotWith(label: string): Promise<string> {
    expect(await runBackupCli(["--label", label], io())).toBe(EXIT.OK);
    const dir = path.join(backupRoot, fs.readdirSync(backupRoot).sort()[fs.readdirSync(backupRoot).length - 1] as string);
    expect(fs.readdirSync(dir)).toContain(MANIFEST_NAME);
    return dir;
  }

  function restoreArgs(snapshotName: string, extra: string[] = []) {
    return runRestoreCli([snapshotName, ...extra], io());
  }

  it("resolves a bare snapshot name against the backup root", async () => {
    const snapshot = await snapshotWith("named");
    expect(resolveSnapshotDir(path.basename(snapshot), backupRoot, tempDir)).toBe(snapshot);
    expect(resolveSnapshotDir(snapshot, backupRoot, tempDir)).toBe(snapshot);
    expect(() => resolveSnapshotDir("no-such-snapshot", backupRoot, tempDir)).toThrow(/No manifest\.json/);
    expect(() => resolveSnapshotDir("", backupRoot, tempDir)).toThrow(/required/);
    expect(() => resolveSnapshotDir(path.join(tempDir, "outside"), backupRoot, tempDir)).toThrow(
      /must live inside/,
    );
  });

  it("previews without changing anything when --force is absent", async () => {
    const snapshot = await snapshotWith("preview");
    const before = fs.readFileSync(dbFile);

    expect(await restoreArgs(path.basename(snapshot))).toBe(EXIT.OK);
    expect(fs.readFileSync(dbFile).equals(before)).toBe(true);
    // No pre-restore copy was taken during a preview.
    expect(fs.readdirSync(backupRoot)).toHaveLength(1);

    const text = printed.join("\n");
    expect(text).toMatch(/PREVIEW ONLY/);
    expect(text).toMatch(/mode             : PREVIEW ONLY/);
    expect(text).toMatch(/safety copy      : .*pre-restore/);
    expect(text).toMatch(/live database    : 3 rows across 3 tables/);
    expect(text).toMatch(/checksum         : verified against manifest/);
    expect(text).toMatch(/rows that would be replaced/);
  });

  it("applies with --force, keeps a safety copy, and verifies the result", async () => {
    const snapshot = await snapshotWith("apply");

    // Mutate the live database so the restore has something to undo.
    const db = new Database(dbFile);
    db.prepare('INSERT INTO "Task" (title) VALUES (?)').run("Post-backup task");
    db.close();
    expect(countSqliteTablesFromSnapshot(dbFile).counts.Task).toBe(2);

    expect(await restoreArgs(path.basename(snapshot), ["--force"])).toBe(EXIT.OK);

    expect(countSqliteTablesFromSnapshot(dbFile).counts).toEqual({ Job: 1, Task: 1, ApiToken: 1 });
    expect(verifySqliteIntegrity(dbFile)).toBeUndefined();
    expect(fs.existsSync(`${dbFile}-restoring`)).toBe(false);

    const dirs = fs.readdirSync(backupRoot).sort();
    expect(dirs).toHaveLength(2);
    expect(dirs.some((name) => name.endsWith("-pre-restore"))).toBe(true);
    // The safety copy preserved the mutated live state.
    const safetyPayload = path.join(
      backupRoot,
      dirs.find((name) => name.endsWith("-pre-restore")) as string,
      SQLITE_PAYLOAD_NAME,
    );
    expect(countSqliteTablesFromSnapshot(safetyPayload).counts.Task).toBe(2);

    expect(printed.join("\n")).toMatch(/row check        : 3 tables verified/);
    expect(printed.join("\n")).toMatch(/docker compose restart app/);
  });

  it("--yes is an alias for --force and --dry-run never writes", async () => {
    const snapshot = await snapshotWith("alias");
    const db = new Database(dbFile);
    db.prepare('INSERT INTO "Task" (title) VALUES (?)').run("Extra");
    db.close();

    expect(await restoreArgs(path.basename(snapshot), ["--dry-run"])).toBe(EXIT.OK);
    expect(countSqliteTablesFromSnapshot(dbFile).counts.Task).toBe(2);

    expect(await restoreArgs(path.basename(snapshot), ["--yes"])).toBe(EXIT.OK);
    expect(countSqliteTablesFromSnapshot(dbFile).counts.Task).toBe(1);
  });

  it("restores onto a fresh (empty) database without needing a safety copy", async () => {
    const snapshot = await snapshotWith("fresh");
    const target = path.join(tempDir, "brand-new", "dev.db");
    env.DATABASE_URL = `file:${target.replace(/\\/g, "/")}`;

    expect(await restoreArgs(path.basename(snapshot))).toBe(EXIT.OK);
    expect(printed.join("\n")).toMatch(/safety copy      : not needed/);

    expect(await restoreArgs(path.basename(snapshot), ["--force"])).toBe(EXIT.OK);
    expect(fs.existsSync(target)).toBe(true);
    expect(countSqliteTablesFromSnapshot(target).counts).toEqual({ Job: 1, Task: 1, ApiToken: 1 });
    expect(fs.readdirSync(backupRoot).filter((name) => name.endsWith("-pre-restore"))).toEqual([]);
  });

  it("refuses a tampered payload, a provider mismatch and bad arguments", async () => {
    const snapshot = await snapshotWith("tamper");
    fs.appendFileSync(path.join(snapshot, SQLITE_PAYLOAD_NAME), "junk");
    expect(await restoreArgs(path.basename(snapshot), ["--force"])).toBe(EXIT.VERIFY_FAILED);
    expect(errors.join("\n")).toMatch(/Checksum mismatch/);
  });

  it("rejects a postgres snapshot restored under sqlite (and vice versa)", async () => {
    const snapshot = await snapshotWith("provider");
    const manifestPath = path.join(snapshot, MANIFEST_NAME);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Manifest;
    manifest.dbProvider = "postgres";
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));

    expect(await restoreArgs(path.basename(snapshot), ["--force"])).toBe(EXIT.USAGE);
    expect(errors.join("\n")).toMatch(/Snapshot is a postgres backup/);
  });

  it("needs the client tools for postgres and prints the manual command", async () => {
    // Hand-build a postgres snapshot so no server is required for the test.
    env.DB_PROVIDER = "postgres";
    env.PRISMA_SCHEMA_PATH = "prisma/postgres/schema.prisma";
    env.DATABASE_URL = "postgresql://admin:s3cret-pg-pass@127.0.0.1:1/app";

    const snapshot = path.join(backupRoot, "2026-10-08T00-00-00Z-manual");
    fs.mkdirSync(snapshot, { recursive: true });
    const payload = path.join(snapshot, "database.sql");
    fs.writeFileSync(payload, "CREATE TABLE \"Job\" (id serial PRIMARY KEY, name text);\n");
    const manifest: Manifest = {
      format: BACKUP_FORMAT,
      formatVersion: 1,
      appVersion: "0.1.0",
      createdAt: "2026-10-08T00:00:00.000Z",
      dbProvider: "postgres",
      label: "manual",
      payload: {
        file: "database.sql",
        kind: "postgres-sql",
        bytes: fs.statSync(payload).size,
        sha256: digest(payload),
      },
      rowCounts: { Job: 0 },
      totals: { tables: 1, rows: 0 },
      secretHandling: { excludedTables: {}, envSecretsWritten: false, note: "test" },
    };
    fs.writeFileSync(path.join(snapshot, MANIFEST_NAME), JSON.stringify(manifest));

    env.PSQL_PATH = "psql-that-does-not-exist";
    expect(await restoreArgs("2026-10-08T00-00-00Z-manual", ["--force"])).toBe(EXIT.MISSING_TOOL);
    const message = errors.join("\n");
    expect(message).toMatch(/psql was not found/);
    expect(message).toMatch(/psql --no-password -v ON_ERROR_STOP=1 -d/);
    expect(message).not.toContain("s3cret-pg-pass");
  });

  it("reports usage errors instead of crashing", async () => {
    expect(await runRestoreCli([], io())).toBe(EXIT.USAGE);
    expect(await runRestoreCli(["a", "b"], io())).toBe(EXIT.USAGE);
    expect(await runRestoreCli(["snap", "--maybe"], io())).toBe(EXIT.USAGE);
    expect(await runRestoreCli(["--help"], io())).toBe(EXIT.OK);
    expect(printed.join("\n")).toMatch(/Usage: npm run db:restore/);
  });

  it("keeps planRestore pure and describes the plan", async () => {
    const snapshot = await snapshotWith("pure");
    const plan = planRestore({
      env,
      cwd: tempDir,
      snapshot: path.basename(snapshot),
      now: new Date("2026-10-08T06:00:00Z"),
      currentCounts: { counts: { Job: 5 }, totals: { tables: 1, rows: 5 } },
    });
    expect(plan.provider).toBe("sqlite");
    expect(plan.manifest.payload.kind).toBe("sqlite-file");
    expect(plan.targetFile).toBe(dbFile);
    expect(plan.targetNonEmpty).toBe(true);
    expect(plan.safetyDir).toMatch(/backups[\\/]\d{4}-\d{2}-\d{2}T06-00-00Z-pre-restore$/);

    const lines = renderPreview(plan, true).join("\n");
    expect(lines).toMatch(/mode             : APPLY/);
    expect(lines).toMatch(/method           : verified file swap/);

    const empty: RestorePlan = {
      ...plan,
      currentCounts: { counts: {}, totals: { tables: 0, rows: 0 } },
      targetNonEmpty: false,
    };
    expect(renderPreview(empty, false).join("\n")).toMatch(/safety copy      : not needed/);
  });
});
