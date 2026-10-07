/**
 * MF-06: `npm run db:backup` — a provider-aware snapshot of the whole database.
 *
 * The app ships two providers (SQLite file in `/data`, or Postgres), so a single
 * "dump the db" script cannot work for both. This script resolves the provider
 * exactly like `src/lib/prisma.ts` does and then takes the snapshot with the
 * mechanism that is genuinely available for that provider:
 *
 *   sqlite   -> the online backup API of better-sqlite3 (a production
 *               dependency, verified present: `Database#backup()`), which
 *               produces a consistent copy even while the app is writing.
 *               `VACUUM INTO` is the documented fallback when the adapter's
 *               backup call is unavailable, and a plain copy after a
 *               `wal_checkpoint(TRUNCATE)` is the last resort.
 *   postgres -> `pg_dump` (plain SQL, so the payload is greppable and needs no
 *               proprietary archive format on restore). When the binary is not
 *               installed the script fails loudly (exit 3) and prints the exact
 *               command to run instead of silently writing a partial backup.
 *
 * Every snapshot is a directory under the backup root containing the payload
 * file plus a `manifest.json` (provider, per-table row counts, app version, UTC
 * timestamp, sha256 of the payload). Nothing outside that root is ever written,
 * which is enforced by `assertInsideBackupRoot()` rather than by convention.
 *
 * Secret hygiene: environment secrets (APP_PASSWORD, APP_PASSWORD_HASH,
 * SESSION_SECRET, any password embedded in a connection string) are never
 * printed, never written into the manifest, and any output line is scrubbed via
 * `redactSecrets()` as a belt-and-braces pass. The payload itself is a database
 * snapshot, so it contains only the *stored* one-way hashes (bcrypt password
 * hash, SHA-256 token digests) that the running database already holds; use
 * `--exclude-tokens` to drop the `ApiToken` rows from the snapshot entirely.
 *
 * The module is import-safe: the CLI only runs when the file is the process
 * entry point, so `tests/unit/backup-restore.test.ts` can call the pure helpers
 * and `runBackupCli()` in-process.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

export type DbProvider = "sqlite" | "postgres";

/**
 * Anything shaped like an environment map. Deliberately NOT `NodeJS.ProcessEnv`:
 * Next's global augmentation makes `NODE_ENV` required on that type, which would
 * force every caller — including a pure unit test that only wants to flip
 * `DB_PROVIDER` — to fabricate a full process env. These functions only ever
 * read a handful of string keys, so the honest type is the weaker one.
 */
export type EnvLike = Record<string, string | undefined>;

/** Payload flavours: a SQLite database file, or plain SQL text. */
export type PayloadKind = "sqlite-file" | "postgres-sql";

/**
 * Stable exit codes (documented in docs/backup-restore.md):
 * 0 ok, 1 unexpected failure, 2 bad usage/argument, 3 required tool or resource
 * missing, 4 verification failed (checksum / integrity check).
 */
export const EXIT = {
  OK: 0,
  UNEXPECTED: 1,
  USAGE: 2,
  MISSING_TOOL: 3,
  VERIFY_FAILED: 4,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** Error carrying the exit code the CLI should surface. */
export class BackupError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number = EXIT.UNEXPECTED,
  ) {
    super(message);
    this.name = "BackupError";
  }
}

/** Directory name the snapshot lands in when nothing overrides it. */
export const BACKUP_DIR_NAME = "backups";

/** Marker that lets restore verify it is reading one of our manifests. */
export const BACKUP_FORMAT = "gid-taskflow-backup";
export const BACKUP_FORMAT_VERSION = 1;

export const SQLITE_PAYLOAD_NAME = "database.sqlite";
export const POSTGRES_PAYLOAD_NAME = "database.sql";
export const MANIFEST_NAME = "manifest.json";

/** Tables whose row counts are reported; `_prisma_migrations` bookkeeping is noise. */
const INTERNAL_SQLITE_TABLES = /^sqlite_|_prisma_migrations$/i;
const INTERNAL_POSTGRES_TABLES = /^_prisma_migrations$/i;

/** Env keys whose *values* must never reach stdout or the manifest. */
const SECRET_ENV_KEYS = [
  "APP_PASSWORD",
  "APP_PASSWORD_HASH",
  "SESSION_SECRET",
  "NEXT_SECRET",
  "DATABASE_URL",
  "DATABASE_URL_SQLITE",
  "DATABASE_URL_POSTGRES",
];

/** Env keys that hold a path override, never the payload itself. */
const PATH_ENV_KEYS = ["GID_BACKUP_DIR", "PG_DUMP_PATH", "PSQL_PATH", "PG_RESTORE_PATH"];

export type Manifest = {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  appVersion: string;
  createdAt: string;
  dbProvider: DbProvider;
  label: string | null;
  payload: {
    file: string;
    kind: PayloadKind;
    bytes: number;
    sha256: string;
  };
  rowCounts: Record<string, number>;
  totals: { tables: number; rows: number };
  secretHandling: {
    /** Rows deliberately absent from the payload (`--exclude-tokens`). */
    excludedTables: Record<string, number>;
    envSecretsWritten: false;
    note: string;
  };
};

export type CliIo = {
  env: EnvLike;
  cwd: string;
  out?: (line: string) => void;
  err?: (line: string) => void;
};

/** Same precedence as src/lib/prisma.ts, kept as a pure function for tests. */
export function detectProvider(env: EnvLike): DbProvider {
  const provider = (env.DB_PROVIDER || "").toLowerCase();
  const schemaPath = (env.PRISMA_SCHEMA_PATH || "").toLowerCase();
  const url = (env.DATABASE_URL || "").trim();

  const hinted =
    (schemaPath.includes("postgres")
      ? "postgres"
      : schemaPath.includes("sqlite")
        ? "sqlite"
        : "") ||
    (url.startsWith("postgres") ? "postgres" : "") ||
    provider;

  if (hinted === "postgres" || hinted === "postgresql") return "postgres";
  return "sqlite";
}

/**
 * Connection string for the resolved provider. A provider/url mismatch is a
 * hard failure (ST-03 reasoning): backing up the wrong database is worse than
 * backing up nothing.
 */
export function resolveDatabaseUrl(env: EnvLike, provider: DbProvider): string {
  const resolved = (env.DATABASE_URL || "").trim();
  const sqliteUrl = (env.DATABASE_URL_SQLITE || "").trim() || "file:./dev.db";
  const postgresUrl =
    (env.DATABASE_URL_POSTGRES || "").trim() ||
    "postgresql://postgres:postgres@localhost:5432/postgres?schema=public";

  const url = resolved || (provider === "postgres" ? postgresUrl : sqliteUrl);
  const looksSqlite = url.startsWith("file:");

  if (provider === "sqlite" && !looksSqlite) {
    throw new BackupError(
      `Provider resolved to sqlite but DATABASE_URL is not a file: URL (${redactConnectionUrl(url)}). Set DB_PROVIDER or DATABASE_URL.`,
      EXIT.MISSING_TOOL,
    );
  }
  if (provider === "postgres" && looksSqlite) {
    throw new BackupError(
      `Provider resolved to postgres but DATABASE_URL is a file: URL. Set DB_PROVIDER=sqlite or a postgresql:// URL.`,
      EXIT.MISSING_TOOL,
    );
  }
  return url;
}

/** `file:./dev.db?mode=rwc` -> absolute path. Relative paths resolve against `cwd`. */
export function sqliteFilePathFromUrl(url: string, cwd: string): string {
  if (!url.startsWith("file:")) {
    throw new BackupError(`Not a SQLite file URL: ${redactConnectionUrl(url)}`, EXIT.USAGE);
  }
  const withoutScheme = url.slice("file:".length).split("?")[0].split("#")[0];
  // `file:/data/dev.db` and Windows `file:D:/x/dev.db` / `file:C:\x\dev.db`.
  const cleaned = withoutScheme.replace(/^\/+([A-Za-z]:)/, "$1");
  return path.isAbsolute(cleaned) ? cleaned : path.resolve(cwd, cleaned);
}

/**
 * Where snapshots go.
 *
 * SQLite defaults to `<dirname(db file)>/backups`, which is the repo root in
 * development (`./backups`) and the persistent `/data` volume inside the Docker
 * image (`/data/backups`) — a backup that lives on the container's writable
 * layer would be lost on the next deploy, so co-locating with the volume is the
 * only durable default. Postgres has no local file, so it uses the current
 * working directory. `GID_BACKUP_DIR` overrides both.
 */
export function resolveBackupRoot(
  env: EnvLike,
  cwd: string,
  provider: DbProvider,
  sqliteDbFile?: string | null,
): string {
  const override = (env.GID_BACKUP_DIR || "").trim();
  if (override) {
    return path.resolve(cwd, override);
  }
  const base =
    provider === "sqlite" && sqliteDbFile ? path.dirname(sqliteDbFile) : cwd;
  return path.join(base, BACKUP_DIR_NAME);
}

/** Refuse to write (or read) outside the backup root. */
export function assertInsideBackupRoot(target: string, root: string): string {
  const resolvedTarget = path.resolve(target);
  const resolvedRoot = path.resolve(root);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  const outside =
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    (relative !== "" && path.isAbsolute(relative));
  if (outside || resolvedTarget === resolvedRoot) {
    throw new BackupError(
      `Refusing to touch "${resolvedTarget}": every backup path must live inside ${resolvedRoot}${resolvedTarget === resolvedRoot ? " (a snapshot is a directory below it)" : ""}.`,
      EXIT.USAGE,
    );
  }
  return resolvedTarget;
}

/** Filesystem-safe UTC stamp: `2026-10-08T12-30-05Z` (or `-001` millis with ms). */
export function timestampSlug(now: Date): string {
  const iso = now.toISOString().slice(0, 19);
  return `${iso.replace(/:/g, "-")}Z`;
}

/** Single filesystem-safe label segment; anything else collapses to `-`. */
export function slugifyLabel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || null;
}

/** Backup directory name for one snapshot. */
export function snapshotDirName(now: Date, label?: string | null): string {
  const slug = slugifyLabel(label);
  return slug ? `${timestampSlug(now)}-${slug}` : timestampSlug(now);
}

/** Hide the password in `postgres://user:secret@host/db` style URLs. */
export function redactConnectionUrl(url: string): string {
  return url
    .replace(/(:\/\/[^:/@\s]+:)[^@@\s]+(@)/, "$1***$2")
    .replace(/(password=)[^&\s]+/i, "$1***");
}

/** Values that must never be echoed: env secrets + any connection password. */
export function collectSecretValues(env: EnvLike): string[] {
  const values = new Set<string>();
  for (const key of [...SECRET_ENV_KEYS, ...PATH_ENV_KEYS]) {
    const raw = env[key];
    if (!raw) continue;
    if (key.startsWith("DATABASE_URL")) {
      const password = /:\/\/[^:/@\s]+:([^@@\s]+)@/.exec(raw)?.[1];
      if (password) values.add(password);
      const querySecret = /[?&]password=([^&\s]+)/i.exec(raw)?.[1];
      if (querySecret) values.add(querySecret);
      continue;
    }
    if (raw.length >= 6) values.add(raw);
  }
  return [...values];
}

/** Replace every known secret occurrence in a printable line. */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (!secret || secret.length < 6) continue;
    out = out.split(secret).join("[redacted]");
  }
  return out;
}

/**
 * Final guard before anything leaves the process: if a secret slipped through
 * the redaction (e.g. printed by a child tool we captured), fail instead of
 * leaking it.
 */
export function assertNoSecrets(text: string, secrets: readonly string[], where: string): void {
  for (const secret of secrets) {
    if (!secret || secret.length < 6) continue;
    if (text.includes(secret)) {
      throw new BackupError(`Refusing to output ${where}: it would leak an environment secret.`, EXIT.USAGE);
    }
  }
}

/** Version reported in the manifest; falls back when package.json is unreadable. */
export function readAppVersion(cwd: string): string {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8")) as {
      version?: unknown;
    };
    return typeof raw.version === "string" && raw.version ? raw.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export async function sha256OfFile(file: string): Promise<string> {
  const buffer = await fsp.readFile(file);
  return createHash("sha256").update(buffer).digest("hex");
}

export type TableCounts = {
  counts: Record<string, number>;
  totals: { tables: number; rows: number };
};

/**
 * Per-table row counts straight from the snapshot file (readonly), so the
 * manifest describes the backup rather than a live second connection that could
 * change underneath us.
 */
export function countSqliteTablesFromSnapshot(
  dbFile: string,
  exclude: readonly string[] = [],
): TableCounts {
  const db = new Database(dbFile, { readonly: true });
  try {
    const rows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      )
      .all() as Array<{ name: string }>;
    const counts: Record<string, number> = {};
    let total = 0;
    for (const row of rows) {
      if (INTERNAL_SQLITE_TABLES.test(row.name)) continue;
      if (exclude.includes(row.name)) continue;
      const safeName = row.name.replace(/"/g, '""');
      const count = (db.prepare(`SELECT COUNT(*) AS c FROM "${safeName}"`).get() as { c: number }).c;
      counts[row.name] = Number(count);
      total += Number(count);
    }
    return { counts, totals: { tables: Object.keys(counts).length, rows: total } };
  } finally {
    db.close();
  }
}

/** `PRAGMA integrity_check` — must answer `ok`, otherwise the file is unusable. */
export function verifySqliteIntegrity(dbFile: string): void {
  let db: InstanceType<typeof Database> | null = null;
  try {
    db = new Database(dbFile, { readonly: true });
    const row = db.prepare("PRAGMA integrity_check").get() as { integrity_check?: string };
    const verdict = row?.integrity_check;
    if (verdict !== "ok") {
      throw new BackupError(
        `integrity_check on ${path.basename(dbFile)} returned ${JSON.stringify(verdict ?? "no answer")}.`,
        EXIT.VERIFY_FAILED,
      );
    }
  } catch (error) {
    if (error instanceof BackupError) throw error;
    // "file is not a database" / an unreadable file is a verification failure,
    // not an unexpected crash: the operator must see exit 4 with the reason.
    throw new BackupError(
      `Cannot verify ${path.basename(dbFile)}: ${(error as Error).message}`,
      EXIT.VERIFY_FAILED,
    );
  } finally {
    db?.close();
  }
}

/**
 * Consistent online copy of a live SQLite database.
 *
 * `Database#backup()` (better-sqlite3 >= 7.5) streams pages with the WAL folded
 * in, so the app can keep serving traffic. If the installed adapter somehow
 * lacks it, fall back to `VACUUM INTO` and then to checkpoint + copy, each
 * documented in the output so an operator knows which path produced the file.
 */
export async function createSqliteSnapshot(
  sourceFile: string,
  destFile: string,
  note: (line: string) => void,
): Promise<"backup-api" | "vacuum-into" | "checkpoint-copy"> {
  if (!fs.existsSync(sourceFile)) {
    throw new BackupError(
      `SQLite database file not found at ${sourceFile}. Start the app once, or set DATABASE_URL_SQLITE.`,
      EXIT.MISSING_TOOL,
    );
  }

  const source = new Database(sourceFile, { readonly: true });
  try {
    if (typeof source.backup === "function") {
      await source.backup(destFile);
      return "backup-api";
    }
    const vacuum = pathToFileForSql(destFile);
    source.prepare(`VACUUM INTO '${vacuum}'`).run();
    note("better-sqlite3 backup() unavailable - used VACUUM INTO.");
    return "vacuum-into";
  } catch (error) {
    note(`Online backup failed (${(error as Error).message}); falling back to checkpoint + copy.`);
    source.pragma("wal_checkpoint(TRUNCATE)");
    await fsp.copyFile(sourceFile, destFile);
    return "checkpoint-copy";
  } finally {
    source.close();
  }
}

/** Escape a Windows path for embedding in a single-quoted SQL string literal. */
function pathToFileForSql(file: string): string {
  return file.replace(/'/g, "''").replace(/\\/g, "/");
}

/**
 * `--exclude-tokens`: delete the `ApiToken` rows from the *snapshot copy* only.
 * The live database is never touched, so a backup can travel without carrying
 * material an attacker could brute-force offline.
 */
export function stripTableFromSnapshot(dbFile: string, table: string): number {
  const db = new Database(dbFile);
  try {
    const safeName = table.replace(/"/g, '""');
    const before = (db.prepare(`SELECT COUNT(*) AS c FROM "${safeName}"`).get() as { c: number }).c;
    db.prepare(`DELETE FROM "${safeName}"`).run();
    return Number(before);
  } finally {
    db.close();
  }
}

/**
 * Make the snapshot portable and hash-stable: fold any WAL in, drop back to the
 * rollback journal, then remove the `-wal` / `-shm` sidecars so the manifest's
 * sha256 covers every byte of the backup. A snapshot that needed a sidecar file
 * would silently restore as a corrupted database.
 */
export function finalizeSnapshotFile(file: string): void {
  const db = new Database(file);
  try {
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.pragma("journal_mode = DELETE");
  } finally {
    db.close();
  }
  for (const suffix of ["-wal", "-shm"]) {
    const side = `${file}${suffix}`;
    if (fs.existsSync(side)) fs.rmSync(side, { force: true });
  }
}

/** Postgres row counts via the already-installed `pg` driver (lazy import). */
export async function countPostgresTables(connectionString: string): Promise<TableCounts> {
  const { Client } = (await import("pg")) as typeof import("pg");
  const client = new Client({ connectionString });
  try {
    await client.connect();
    const tables = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
    );
    const counts: Record<string, number> = {};
    let total = 0;
    for (const row of tables.rows as Array<{ table_name: string }>) {
      if (INTERNAL_POSTGRES_TABLES.test(row.table_name)) continue;
      const quoted = `"${row.table_name.replace(/"/g, '""')}"`;
      const result = await client.query(`SELECT COUNT(*)::int AS c FROM public.${quoted}`);
      const count = Number(result.rows[0]?.c ?? 0);
      counts[row.table_name] = count;
      total += count;
    }
    return { counts, totals: { tables: Object.keys(counts).length, rows: total } };
  } finally {
    await client.end().catch(() => undefined);
  }
}

export type ToolResolution = { binary: string; versionLine: string | null };

/** Resolve an external Postgres client tool, honouring the `*_PATH` overrides. */
export function requireTool(
  env: EnvLike,
  defaultBinary: string,
  envOverrideKey: string,
): ToolResolution {
  const binary = (env[envOverrideKey] || "").trim() || defaultBinary;
  const probe = spawnSync(binary, ["--version"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) {
    throw new BackupError(
      `${defaultBinary} was not found (tried "${binary}"; override with ${envOverrideKey}). Install the PostgreSQL client tools.`,
      EXIT.MISSING_TOOL,
    );
  }
  return { binary, versionLine: (probe.stdout || "").split("\n")[0].trim() };
}

export type BackupPlan = {
  provider: DbProvider;
  connectionString: string;
  sqliteDbFile: string | null;
  backupRoot: string;
  snapshotDir: string;
  payloadFile: string;
  payloadKind: PayloadKind;
  excludeTokens: boolean;
};

/** Everything the CLI decides before it writes a byte (also the --dry-run output). */
export function planBackup(input: {
  env: EnvLike;
  cwd: string;
  now: Date;
  label?: string | null;
  outDir?: string | null;
  excludeTokens?: boolean;
}): BackupPlan {
  const provider = detectProvider(input.env);
  const connectionString = resolveDatabaseUrl(input.env, provider);
  const sqliteDbFile = provider === "sqlite" ? sqliteFilePathFromUrl(connectionString, input.cwd) : null;
  const backupRoot = resolveBackupRoot(input.env, input.cwd, provider, sqliteDbFile);

  const requestedDir = input.outDir
    ? path.isAbsolute(input.outDir)
      ? input.outDir
      : path.resolve(backupRoot, input.outDir)
    : path.join(backupRoot, snapshotDirName(input.now, input.label));

  // `--out` is only a way to *name* a snapshot; confinement is non-negotiable.
  const snapshotDir = input.outDir ? assertInsideBackupRoot(requestedDir, backupRoot) : requestedDir;

  const payloadKind: PayloadKind = provider === "sqlite" ? "sqlite-file" : "postgres-sql";
  return {
    provider,
    connectionString,
    sqliteDbFile,
    backupRoot,
    snapshotDir: assertInsideBackupRoot(snapshotDir, backupRoot),
    payloadFile: path.join(snapshotDir, payloadKind === "sqlite-file" ? SQLITE_PAYLOAD_NAME : POSTGRES_PAYLOAD_NAME),
    payloadKind,
    excludeTokens: Boolean(input.excludeTokens),
  };
}

export function buildManifest(input: {
  plan: BackupPlan;
  now: Date;
  appVersion: string;
  payloadFile: string;
  counts: TableCounts;
  excludedTables: Record<string, number>;
  label?: string | null;
}): Manifest {
  const stats = fs.statSync(input.payloadFile);
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: input.appVersion,
    createdAt: input.now.toISOString(),
    dbProvider: input.plan.provider,
    label: slugifyLabel(input.label),
    payload: {
      file: path.basename(input.payloadFile),
      kind: input.plan.payloadKind,
      bytes: stats.size,
      // Synchronous on purpose: the manifest must describe the exact bytes that
      // are on disk before any caller can mutate them.
      sha256: digestFileSync(input.payloadFile),
    },
    rowCounts: input.counts.counts,
    totals: input.counts.totals,
    secretHandling: {
      excludedTables: input.excludedTables,
      envSecretsWritten: false,
      note:
        "The payload is a database snapshot: it contains only the stored one-way hashes (bcrypt password hash, SHA-256 API token digests), never plaintext credentials, and no environment secret is ever written here.",
    },
  };
}

function digestFileSync(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** Read + validate a snapshot manifest (used by `db:restore`). */
export function readManifest(snapshotDir: string): Manifest {
  const manifestPath = path.join(snapshotDir, MANIFEST_NAME);
  if (!fs.existsSync(manifestPath)) {
    throw new BackupError(`No ${MANIFEST_NAME} in ${snapshotDir}. Point db:restore at a backup directory.`, EXIT.USAGE);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new BackupError(`${manifestPath} is not valid JSON: ${(error as Error).message}`, EXIT.USAGE);
  }
  const manifest = parsed as Partial<Manifest>;
  if (manifest?.format !== BACKUP_FORMAT || !manifest.payload?.file || !manifest.payload?.sha256) {
    throw new BackupError(`${manifestPath} is not a ${BACKUP_FORMAT} manifest (or is missing the checksum).`, EXIT.USAGE);
  }
  if (!fs.existsSync(path.join(snapshotDir, manifest.payload.file))) {
    throw new BackupError(
      `Payload ${manifest.payload.file} is missing from ${snapshotDir}.`,
      EXIT.USAGE,
    );
  }
  return manifest as Manifest;
}

/** Verify payload size + sha256 against the manifest. */
export async function verifyPayload(manifest: Manifest, snapshotDir: string): Promise<void> {
  const payloadFile = path.join(snapshotDir, manifest.payload.file);
  const sha = await sha256OfFile(payloadFile);
  if (sha !== manifest.payload.sha256) {
    throw new BackupError(
      `Checksum mismatch for ${manifest.payload.file}: manifest says ${manifest.payload.sha256}, file is ${sha}.`,
      EXIT.VERIFY_FAILED,
    );
  }
  const bytes = (await fsp.stat(payloadFile)).size;
  if (bytes !== manifest.payload.bytes) {
    throw new BackupError(
      `Size mismatch for ${manifest.payload.file}: manifest says ${manifest.payload.bytes} bytes, file is ${bytes}.`,
      EXIT.VERIFY_FAILED,
    );
  }
}

export type RunBackupResult = {
  exitCode: number;
  plan: BackupPlan;
  manifest: Manifest | null;
  method: string | null;
  lines: string[];
};

/**
 * The whole backup, as a function: plans, writes the payload into a fresh
 * snapshot directory, counts rows, verifies the bytes, then writes the manifest.
 * Returns the printed lines so the CLI and the tests share one implementation.
 */
export async function runBackup(
  env: EnvLike,
  cwd: string,
  options: {
    now?: Date;
    label?: string | null;
    outDir?: string | null;
    excludeTokens?: boolean;
    dryRun?: boolean;
    /** Test seam for the SQLite copy so no native handle is opened twice. */
    snapshot?: (sourceFile: string, destFile: string, note: (l: string) => void) => Promise<string>;
  } = {},
): Promise<RunBackupResult> {
  const now = options.now ?? new Date();
  const secrets = collectSecretValues(env);
  const lines: string[] = [];
  const note = (line: string) => {
    const safe = redactSecrets(line, secrets);
    assertNoSecrets(safe, secrets, "a backup line");
    lines.push(safe);
  };

  const plan = planBackup({
    env,
    cwd,
    now,
    label: options.label,
    outDir: options.outDir,
    excludeTokens: options.excludeTokens,
  });

  note(`provider        : ${plan.provider}`);
  note(`connection      : ${redactConnectionUrl(plan.connectionString)}`);
  note(`backup root     : ${plan.backupRoot}`);
  note(`snapshot dir    : ${plan.snapshotDir}`);
  note(`payload         : ${path.basename(plan.payloadFile)}`);
  if (plan.excludeTokens) note("ApiToken rows   : excluded (--exclude-tokens)");

  if (options.dryRun) {
    note("dry run: nothing was written.");
    return { exitCode: EXIT.OK, plan, manifest: null, method: null, lines };
  }

  if (fs.existsSync(plan.snapshotDir)) {
    throw new BackupError(`${plan.snapshotDir} already exists - a snapshot is never overwritten.`, EXIT.USAGE);
  }
  await fsp.mkdir(plan.snapshotDir, { recursive: true });

  let counts: TableCounts;
  let excludedTables: Record<string, number> = {};
  let method: string;

  try {
    if (plan.provider === "sqlite") {
      const source = plan.sqliteDbFile as string;
      method = options.snapshot
        ? await options.snapshot(source, plan.payloadFile, note)
        : await createSqliteSnapshot(source, plan.payloadFile, note);
      note(`snapshot method : ${method}`);

      if (plan.excludeTokens) {
        const removed = stripTableFromSnapshot(plan.payloadFile, "ApiToken");
        excludedTables = { ApiToken: removed };
        note(`ApiToken rows   : ${removed} removed from the snapshot copy`);
      }

      finalizeSnapshotFile(plan.payloadFile);
      verifySqliteIntegrity(plan.payloadFile);
      counts = countSqliteTablesFromSnapshot(plan.payloadFile);
    } else {
      const tool = requireTool(env, "pg_dump", "PG_DUMP_PATH");
      note(`dump tool       : ${tool.binary}${tool.versionLine ? ` (${tool.versionLine})` : ""}`);
      const dumpArgs = [
        "--no-owner",
        "--no-privileges",
        "--no-password",
        "--format=plain",
        `--dbname=${plan.connectionString}`,
        `--file=${plan.payloadFile}`,
      ];
      if (plan.excludeTokens) dumpArgs.unshift("--exclude-table-data=public.\"ApiToken\"");
      // `env` is passed explicitly because pg_dump reads PGPASSWORD from it; the
      // cast only exists because Next's global augmentation marks NODE_ENV as
      // required on NodeJS.ProcessEnv, which a resolved config map cannot promise.
      const result = spawnSync(tool.binary, dumpArgs, {
        encoding: "utf8",
        env: { ...process.env, ...env } as unknown as NodeJS.ProcessEnv,
      });
      if (result.status !== 0) {
        const detail = redactSecrets(`${result.stderr || result.stdout || ""}`.trim(), secrets);
        throw new BackupError(
          `pg_dump failed (exit ${result.status}). Run it manually to see the server error:\n  pg_dump --no-owner --no-privileges --format=plain --dbname="<your DATABASE_URL>" --file=backup.sql${detail ? `\n  ${detail}` : ""}`,
          EXIT.MISSING_TOOL,
        );
      }
      method = "pg_dump";
      counts = await countPostgresTables(plan.connectionString);
    }

    const manifest = buildManifest({
      plan,
      now,
      appVersion: readAppVersion(cwd),
      payloadFile: plan.payloadFile,
      counts,
      excludedTables,
      label: options.label,
    });

    const manifestText = JSON.stringify(manifest, null, 2);
    assertNoSecrets(manifestText, secrets, "the manifest");
    await fsp.writeFile(path.join(plan.snapshotDir, MANIFEST_NAME), `${manifestText}\n`, "utf8");

    note(`tables / rows   : ${manifest.totals.tables} tables, ${manifest.totals.rows} rows`);
    note(`payload sha256  : ${manifest.payload.sha256}`);
    note(`manifest        : ${path.join(plan.snapshotDir, MANIFEST_NAME)}`);

    return { exitCode: EXIT.OK, plan, manifest, method, lines };
  } catch (error) {
    // A half-written snapshot is worse than none: it looks restorable.
    await fsp.rm(plan.snapshotDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export type ParsedArgs = {
  flags: Record<string, string | boolean>;
  positionals: string[];
};

/** Tiny argv parser shared by both CLIs (`--flag`, `--key value`, `--key=value`). */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined) continue;
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const body = token.slice(2);
    const eq = body.indexOf("=");
    if (eq >= 0) {
      flags[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[body] = next;
      i += 1;
    } else {
      flags[body] = true;
    }
  }
  return { flags, positionals };
}

const BACKUP_USAGE = `Usage: npm run db:backup -- [options]

  --label <text>        Suffix appended to the timestamped snapshot directory.
  --out <name|path>     Snapshot directory name (must stay inside the backup root).
  --exclude-tokens      Drop ApiToken rows from the snapshot (still restorable).
  --dry-run             Print the plan, write nothing.
  --json                Print the manifest as JSON on the last line.
  --help                Show this help.

Environment: DB_PROVIDER / DATABASE_URL / DATABASE_URL_SQLITE / DATABASE_URL_POSTGRES
             GID_BACKUP_DIR (default: <db dir or cwd>/backups), PG_DUMP_PATH
Exit codes:  0 ok, 2 usage, 3 missing tool/resource, 4 verification failed.`;

/** CLI body; returns the exit code so tests can assert it without a process. */
export async function runBackupCli(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const out = io.out ?? ((line: string) => process.stdout.write(`${line}\n`));
  const err = io.err ?? ((line: string) => process.stderr.write(`${line}\n`));
  const { flags, positionals } = parseArgs(argv);

  if (flags.help || flags.h) {
    out(BACKUP_USAGE);
    return EXIT.OK;
  }
  if (positionals.length > 0) {
    err(`Unexpected argument: ${positionals[0]}\n\n${BACKUP_USAGE}`);
    return EXIT.USAGE;
  }
  for (const key of Object.keys(flags)) {
    if (!["label", "out", "exclude-tokens", "dry-run", "json"].includes(key)) {
      err(`Unknown flag: --${key}\n\n${BACKUP_USAGE}`);
      return EXIT.USAGE;
    }
  }

  try {
    const result = await runBackup(io.env, io.cwd, {
      label: typeof flags.label === "string" ? flags.label : null,
      outDir: typeof flags.out === "string" ? flags.out : null,
      excludeTokens: flags["exclude-tokens"] === true,
      dryRun: flags["dry-run"] === true,
    });
    for (const line of result.lines) out(line);
    if (flags.json && result.manifest) out(JSON.stringify(result.manifest));
    return result.exitCode;
  } catch (error) {
    const secrets = collectSecretValues(io.env);
    const message = redactSecrets(error instanceof Error ? error.message : String(error), secrets);
    err(`db:backup failed: ${message}`);
    return error instanceof BackupError ? error.exitCode : EXIT.UNEXPECTED;
  }
}

/** True when this module is the process entry point (tsx / node), not an import. */
function isCliEntry(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return path.resolve(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  runBackupCli(process.argv.slice(2), { env: process.env, cwd: process.cwd() })
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      process.stderr.write(`db:backup crashed: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(EXIT.UNEXPECTED);
    });
}
