/**
 * MF-06: `npm run db:restore` — put a snapshot taken by `db:backup` back.
 *
 * Two-stage by design (preview, then apply): running the command without
 * `--force`/`--yes` prints exactly what would happen — which file is replaced,
 * how many rows are live today versus in the snapshot — and exits 0 without
 * touching anything. Applying a snapshot is deliberately destructive, so on
 * *both* providers the live database is snapshotted into the backup root first
 * (an automatic `*-pre-restore` safety copy, via the same `db:backup` path, so
 * Postgres needs a working `pg_dump` before it will drop anything) and the new
 * file is validated with `PRAGMA integrity_check` *and* a row-count comparison
 * against the manifest before the command reports success. A restore also clears
 * the entrypoint's "schema unchanged" marker, because a snapshot can be older
 * than the migrations the next boot would otherwise skip.
 *
 * Provider paths:
 *   sqlite   atomic-ish file swap: the payload is copied to `<target>.restoring`,
 *            verified there, then renamed over the live database file; the WAL /
 *            shm sidecars of the replaced database are removed.
 *   postgres `psql -v ON_ERROR_STOP=1 -f <payload.sql>` against the configured
 *            database. Because a plain `pg_dump` contains `CREATE TABLE`
 *            statements, restoring onto a non-empty schema would abort on the
 *            first existing table, so `--force` onto a non-empty database also
 *            recreates the `public` schema. psql is addressed with discrete
 *            `-h/-p/-U/-d` parameters and `PGPASSWORD`, never the DSN: libpq
 *            rejects Prisma's `?schema=` URI parameter and argv would leak the
 *            password. If `psql` is not installed the command fails loudly
 *            (exit 3) with the exact manual command.
 *
 * Like backup.ts this module is import-safe: the CLI only runs when the file is
 * the entry point, so the unit tests can assert exit codes and output in-process.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BACKUP_DIR_NAME,
  EXIT,
  BackupError,
  assertInsideBackupRoot,
  assertNoSecrets,
  collectSecretValues,
  countPostgresTables,
  countSqliteTablesFromSnapshot,
  detectProvider,
  readManifest,
  redactConnectionUrl,
  redactSecrets,
  resolveBackupRoot,
  resolveDatabaseUrl,
  runBackup,
  snapshotDirName,
  sqliteFilePathFromUrl,
  toPgTarget,
  verifyPayload,
  verifySqliteIntegrity,
  parseArgs,
  type DbProvider,
  type EnvLike,
  type Manifest,
  type TableCounts,
} from "./backup";

export type RestorePlan = {
  provider: DbProvider;
  connectionString: string;
  backupRoot: string;
  snapshotDir: string;
  payloadFile: string;
  manifest: Manifest;
  /** Live database file (sqlite only). */
  targetFile: string | null;
  /** Rows currently in the live database, when it could be inspected. */
  currentCounts: TableCounts | null;
  targetNonEmpty: boolean;
  /** Snapshot taken automatically right before an applied restore. */
  safetyDir: string;
};

/**
 * Locate the snapshot directory. A bare name is resolved inside the backup root
 * so `npm run db:restore -- 2026-10-08T12-00-00Z` works from anywhere, while an
 * absolute path still has to live under that root (a restore source outside the
 * backup dir is almost certainly a typo pointing at the wrong file).
 */
export function resolveSnapshotDir(snapshotArg: string, backupRoot: string, cwd: string): string {
  const raw = snapshotArg.trim();
  if (!raw) {
    throw new BackupError("A snapshot directory is required.", EXIT.USAGE);
  }
  // A bare name (`2026-10-08T12-00-00Z`) always means "the snapshot of that name
  // inside the backup root"; a path is taken literally so an operator can point
  // at a copied-out tree — confinement still applies below.
  const looksLikeName = !path.isAbsolute(raw) && !raw.includes("/") && !raw.includes("\\");
  const candidate = path.isAbsolute(raw)
    ? raw
    : looksLikeName
      ? path.join(backupRoot, raw)
      : path.resolve(cwd, raw);

  const inside = assertInsideBackupRoot(candidate, backupRoot);
  if (!fs.existsSync(path.join(inside, "manifest.json"))) {
    throw new BackupError(
      `No manifest.json in ${inside}. Expected a directory produced by db:backup inside ${backupRoot}.`,
      EXIT.USAGE,
    );
  }
  return inside;
}

/** The live SQLite file must never be inside the backup root. */
export function assertTargetOutsideBackups(targetFile: string, backupRoot: string): string {
  const relative = path.relative(path.resolve(backupRoot), path.resolve(targetFile));
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new BackupError(
      `Refusing to restore onto ${targetFile}: it lives inside the backup root ${backupRoot}.`,
      EXIT.USAGE,
    );
  }
  return path.resolve(targetFile);
}

export function planRestore(input: {
  env: EnvLike;
  cwd: string;
  snapshot: string;
  now?: Date;
  /** Live row counts are read lazily by runRestore; tests can inject them. */
  currentCounts?: TableCounts | null;
}): RestorePlan {
  const provider = detectProvider(input.env);
  const connectionString = resolveDatabaseUrl(input.env, provider);
  const sqliteDbFile = provider === "sqlite" ? sqliteFilePathFromUrl(connectionString, input.cwd) : null;
  const backupRoot = resolveBackupRoot(input.env, input.cwd, provider, sqliteDbFile);
  const snapshotDir = resolveSnapshotDir(input.snapshot, backupRoot, input.cwd);
  const manifest = readManifest(snapshotDir);

  if (manifest.dbProvider !== provider) {
    throw new BackupError(
      `Snapshot is a ${manifest.dbProvider} backup but the environment resolves to ${provider}. Set DB_PROVIDER/DATABASE_URL to match the snapshot.`,
      EXIT.USAGE,
    );
  }

  const targetFile =
    provider === "sqlite" && sqliteDbFile
      ? assertTargetOutsideBackups(sqliteDbFile, backupRoot)
      : null;

  const currentCounts = input.currentCounts ?? null;
  const safetyDir = path.join(
    backupRoot,
    `${snapshotDirName(input.now ?? new Date())}-pre-restore`,
  );

  return {
    provider,
    connectionString,
    backupRoot,
    snapshotDir,
    payloadFile: path.join(snapshotDir, manifest.payload.file),
    manifest,
    targetFile,
    currentCounts,
    targetNonEmpty: Boolean(currentCounts && currentCounts.totals.rows > 0),
    safetyDir: assertInsideBackupRoot(safetyDir, backupRoot),
  };
}

/** Human-readable preview; also what `--dry-run` prints. */
export function renderPreview(plan: RestorePlan, force: boolean): string[] {
  const lines: string[] = [];
  const live = plan.currentCounts;
  lines.push(`snapshot dir     : ${plan.snapshotDir}`);
  lines.push(`provider         : ${plan.provider}`);
  lines.push(`payload          : ${plan.manifest.payload.file} (${plan.manifest.payload.bytes} bytes, sha256 ${plan.manifest.payload.sha256.slice(0, 16)}…)`);
  lines.push(`taken at         : ${plan.manifest.createdAt} (app ${plan.manifest.appVersion})`);
  lines.push(`snapshot rows    : ${plan.manifest.totals.rows} across ${plan.manifest.totals.tables} tables`);
  lines.push(
    `live database    : ${
      live
        ? `${live.totals.rows} rows across ${live.totals.tables} tables in ${
            plan.targetFile ? path.basename(plan.targetFile) : redactConnectionUrl(plan.connectionString)
          }`
        : "not inspected (unreadable or unreachable)"
    }`,
  );

  if (plan.provider === "sqlite") {
    lines.push(`replaces         : ${plan.targetFile}`);
    lines.push("method           : verified file swap + PRAGMA integrity_check + row-count check");
  } else {
    lines.push(`into             : ${redactConnectionUrl(plan.connectionString)}`);
    lines.push("method           : psql -v ON_ERROR_STOP=1 -f <payload>");
    if (plan.targetNonEmpty) {
      lines.push("WARNING            : the target is non-empty, so the public schema is dropped and recreated.");
    }
  }

  if (plan.targetNonEmpty) {
    lines.push(`safety copy      : ${plan.safetyDir} (automatic before the restore is applied)`);
  } else {
    lines.push("safety copy      : not needed (target is empty)");
  }

  lines.push(
    force
      ? "mode             : APPLY (--force/--yes given)"
      : "mode             : PREVIEW ONLY — re-run with --force (or --yes) to apply",
  );
  return lines;
}

function liveSqliteCounts(dbFile: string): TableCounts | null {
  if (!fs.existsSync(dbFile)) return null;
  try {
    return countSqliteTablesFromSnapshot(dbFile);
  } catch (error) {
    // A locked/half-written live file must not block a restore preview.
    console.warn(`[db:restore] could not read live row counts: ${(error as Error).message}`);
    return null;
  }
}

async function livePostgresCounts(connectionString: string): Promise<TableCounts | null> {
  try {
    return await countPostgresTables(connectionString);
  } catch (error) {
    console.warn(`[db:restore] could not read live row counts: ${(error as Error).message}`);
    return null;
  }
}

/** Run an external Postgres client command without ever echoing the URL. */
function runPsql(
  binary: string,
  sqlArgs: string[],
  childEnv: NodeJS.ProcessEnv,
  secrets: readonly string[],
): { ok: boolean; output: string } {
  const result = spawnSync(binary, sqlArgs, { encoding: "utf8", env: childEnv });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const safe = redactSecrets(output, secrets);
  assertNoSecrets(safe, secrets, "psql output");
  return { ok: !result.error && result.status === 0, output: safe };
}

/** Compare live counts against the manifest and report the first drift. */
export function compareCounts(
  manifest: Manifest,
  actual: TableCounts,
): { ok: boolean; detail: string } {
  const problems: string[] = [];
  for (const [table, expected] of Object.entries(manifest.rowCounts)) {
    const got = actual.counts[table];
    if (got === undefined) {
      problems.push(`${table} is missing`);
    } else if (got !== expected) {
      problems.push(`${table} has ${got} rows, snapshot says ${expected}`);
    }
  }
  // A table the snapshot promised to leave out must actually come back empty —
  // otherwise "excluded" was only a claim in the manifest.
  for (const table of Object.keys(manifest.secretHandling.excludedTables)) {
    const got = actual.counts[table];
    if (got === undefined) {
      problems.push(`${table} is missing, although the snapshot excluded only its rows`);
    } else if (got !== 0) {
      problems.push(`${table} has ${got} rows although the snapshot excluded it`);
    }
  }
  return {
    ok: problems.length === 0,
    detail:
      problems.length === 0
        ? `${Object.keys(manifest.rowCounts).length} tables verified${Object.keys(manifest.secretHandling.excludedTables).length ? `, ${Object.keys(manifest.secretHandling.excludedTables).length} excluded table(s) confirmed empty` : ""}`
        : problems.join("; "),
  };
}

export type RunRestoreResult = { exitCode: number; lines: string[]; plan: RestorePlan | null };

export async function runRestore(
  env: EnvLike,
  cwd: string,
  options: { snapshot: string; force: boolean; dryRun?: boolean; now?: Date },
): Promise<RunRestoreResult> {
  const now = options.now ?? new Date();
  const secrets = collectSecretValues(env);
  const lines: string[] = [];
  const note = (line: string) => {
    const safe = redactSecrets(line, secrets);
    assertNoSecrets(safe, secrets, "a restore line");
    lines.push(safe);
  };

  // Validate the snapshot first (arguments, manifest, provider match), then
  // inspect the live database: a bad snapshot path must not cost a DB round-trip.
  const plan = planRestore({ env, cwd, snapshot: options.snapshot, now });
  const currentCounts =
    plan.provider === "sqlite"
      ? liveSqliteCounts(plan.targetFile as string)
      : await livePostgresCounts(plan.connectionString);
  plan.currentCounts = currentCounts;
  plan.targetNonEmpty = Boolean(currentCounts && currentCounts.totals.rows > 0);

  for (const line of renderPreview(plan, options.force)) note(line);

  if (options.dryRun) {
    note("dry run: nothing was written.");
    return { exitCode: EXIT.OK, lines, plan };
  }

  // Verification is unconditional: never restore bytes we have not checked.
  await verifyPayload(plan.manifest, plan.snapshotDir);
  note("checksum         : verified against manifest");

  if (!options.force) {
    note("");
    note("PREVIEW ONLY — nothing was changed. Re-run with --force (or --yes) to apply this snapshot.");
    if (plan.targetNonEmpty) {
      note(`The live database holds ${plan.currentCounts?.totals.rows ?? 0} rows that would be replaced.`);
    }
    return { exitCode: EXIT.OK, lines, plan };
  }

  // Cleared *before* anything is destroyed, not after the swap: if verification
  // fails midway the database has still been replaced, and the next boot must not
  // be allowed to skip `migrate deploy` on the strength of the old marker.
  invalidateSchemaMarker(note);

  if (plan.provider === "sqlite") {
    await restoreSqlite(plan, env, cwd, note);
  } else {
    await restorePostgres(plan, env, cwd, note, secrets);
  }

  note("");
  note("Restart the app afterwards so it reconnects to the restored database:");
  note("  docker compose restart app    (or: docker restart <container>)");
  return { exitCode: EXIT.OK, lines, plan };
}

/**
 * The locations `docker-entrypoint.sh` may keep its "schema unchanged" marker
 * (AR-07), in the same preference order.
 */
const SCHEMA_MARKER_FILES = ["/data/.prisma-schema-hash", "/app/.prisma-schema-hash", "/tmp/.prisma-schema-hash"];

/**
 * The entrypoint skips `prisma generate` + `migrate deploy` when the image's
 * schema hash matches a marker stored in the volume. A restore moves the
 * database backwards underneath that marker without changing the image, so the
 * next boot would start the app against a schema older than its own migrations —
 * the first query touching a newer column fails at runtime. Clearing the marker
 * is what makes "restart the app" actually re-apply the migrations.
 */
export function invalidateSchemaMarker(
  note: (line: string) => void,
  files: readonly string[] = SCHEMA_MARKER_FILES,
): string[] {
  const cleared: string[] = [];
  for (const file of files) {
    let written: string;
    try {
      written = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    // Only ever remove a file the entrypoint wrote — its whole content is the
    // sha256 it compared. Anything else at that path is not ours to delete.
    if (!/^[0-9a-f]{64}$/.test(written.trim())) continue;
    try {
      fs.rmSync(file);
      cleared.push(file);
    } catch {
      note(`migrations       : could not remove ${file}; delete it before the next boot so migrate deploy is not skipped.`);
    }
  }
  if (cleared.length > 0) {
    note(`migrations       : cleared ${cleared.join(", ")} — the next boot re-runs prisma migrate deploy onto the restored database`);
  } else {
    note("migrations       : no schema marker to clear here; if the app runs in Docker, remove /data/.prisma-schema-hash so migrate deploy is not skipped.");
  }
  return cleared;
}

async function restoreSqlite(
  plan: RestorePlan,
  env: EnvLike,
  cwd: string,
  note: (line: string) => void,
): Promise<void> {
  const target = plan.targetFile as string;
  verifySqliteIntegrity(plan.payloadFile);
  note("integrity        : snapshot payload passes PRAGMA integrity_check");

  if (plan.targetNonEmpty) {
    // Never destroy the only copy: snapshot the live database first.
    const safety = await runBackup(env, cwd, { label: "pre-restore", now: new Date() });
    note(`safety copy      : ${safety.plan.snapshotDir}`);
  }

  const staging = `${target}.restoring`;
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.copyFile(plan.payloadFile, staging);
  verifySqliteIntegrity(staging);
  // The staged copy must not carry sidecars from the source directory.
  for (const suffix of ["-wal", "-shm"]) {
    await fsp.rm(`${staging}${suffix}`, { force: true }).catch(() => undefined);
  }

  // Swap: drop the live file, move the verified copy into place, and remove the
  // `-wal` / `-shm` sidecars of the *replaced* database — SQLite would otherwise
  // replay the old pages onto the restored file.
  await fsp.rm(target, { force: true });
  await fsp.rename(staging, target);
  for (const suffix of ["-wal", "-shm"]) {
    await fsp.rm(`${target}${suffix}`, { force: true }).catch(() => undefined);
  }
  note(`swapped in       : ${target}`);

  const after = countSqliteTablesFromSnapshot(target);
  const verdict = compareCounts(plan.manifest, after);
  if (!verdict.ok) {
    throw new BackupError(
      `Restore verification failed after the file swap: ${verdict.detail}. The previous database is in the safety copy if one was taken.`,
      EXIT.VERIFY_FAILED,
    );
  }
  note(`row check        : ${verdict.detail}`);
}

export async function restorePostgres(
  plan: RestorePlan,
  env: EnvLike,
  cwd: string,
  note: (line: string) => void,
  secrets: readonly string[],
): Promise<void> {
  let binary: string;
  try {
    const probe = spawnSync((env.PSQL_PATH || "psql").trim() || "psql", ["--version"], { encoding: "utf8" });
    if (probe.error || probe.status !== 0) throw new Error("absent");
    binary = (env.PSQL_PATH || "psql").trim() || "psql";
  } catch {
    throw new BackupError(
      `psql was not found (override with PSQL_PATH). Restore manually with:\n  psql --no-password -v ON_ERROR_STOP=1 -d "${redactConnectionUrl(plan.connectionString)}" -f "${plan.payloadFile}"`,
      EXIT.MISSING_TOOL,
    );
  }

  // Discrete parameters plus PGPASSWORD, never the DSN: libpq refuses a URI
  // containing Prisma's `?schema=`, and a URL on argv would expose the password
  // to every local process for as long as psql runs.
  const target = toPgTarget(plan.connectionString);
  const childEnv = { ...process.env, ...env, ...target.env } as unknown as NodeJS.ProcessEnv;

  if (plan.targetNonEmpty) {
    // Same rule as the SQLite path, and for a harsher reason: the DROP below
    // takes the live data with it, so it may only run once a copy exists.
    const safety = await runBackup(env, cwd, { label: "pre-restore", now: new Date() });
    note(`safety copy      : ${safety.plan.snapshotDir}`);

    note("dropping public   : non-empty target, recreating the public schema (per --force)");
    const drop = runPsql(
      binary,
      [
        "--no-password",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO CURRENT_USER;",
        ...target.args,
      ],
      childEnv,
      secrets,
    );
    if (!drop.ok) {
      throw new BackupError(`Could not recreate the public schema: ${drop.output.trim()}`, EXIT.VERIFY_FAILED);
    }
  }

  const apply = runPsql(
    binary,
    ["--no-password", "-v", "ON_ERROR_STOP=1", "-q", "-f", plan.payloadFile, ...target.args],
    childEnv,
    secrets,
  );
  if (!apply.ok) {
    throw new BackupError(
      `psql failed while applying ${plan.manifest.payload.file}: ${apply.output.trim()} (exit was non-zero, nothing more was changed).`,
      EXIT.VERIFY_FAILED,
    );
  }
  note(`applied          : ${plan.manifest.payload.file} via ${binary}`);

  const after = await livePostgresCounts(plan.connectionString);
  if (!after) {
    note("row check        : skipped — the restored database could not be re-read.");
    return;
  }
  const verdict = compareCounts(plan.manifest, after);
  if (!verdict.ok) {
    throw new BackupError(`Restore verification failed: ${verdict.detail}`, EXIT.VERIFY_FAILED);
  }
  note(`row check        : ${verdict.detail}`);
}

const RESTORE_USAGE = `Usage: npm run db:restore -- <snapshot-dir|name> [options]

  <snapshot>            A directory produced by db:backup, inside the backup root
                        (GID_BACKUP_DIR, default <db dir or cwd>/${BACKUP_DIR_NAME}).
                        List them with:  ls <backup root>
  --force | --yes       Actually apply the restore. Without it the command prints
                        a preview and exits 0, changing nothing.
  --dry-run             Same as the default preview (explicit for scripts).
  --help                Show this help.

Exit codes: 0 ok (including preview), 2 usage, 3 missing tool/resource, 4 verification failed.`;

export async function runRestoreCli(argv: readonly string[], io: CliIoLike): Promise<number> {
  const out = io.out ?? ((line: string) => process.stdout.write(`${line}\n`));
  const err = io.err ?? ((line: string) => process.stderr.write(`${line}\n`));
  const { flags, positionals } = parseArgs(argv);

  if (flags.help || flags.h) {
    out(RESTORE_USAGE);
    return EXIT.OK;
  }
  for (const key of Object.keys(flags)) {
    if (!["force", "yes", "dry-run", "help"].includes(key)) {
      err(`Unknown flag: --${key}\n\n${RESTORE_USAGE}`);
      return EXIT.USAGE;
    }
  }
  if (positionals.length !== 1) {
    err(
      positionals.length === 0
        ? `A snapshot directory is required.\n\n${RESTORE_USAGE}`
        : `Exactly one snapshot directory is expected.\n\n${RESTORE_USAGE}`,
    );
    return EXIT.USAGE;
  }

  const force = flags.force === true || flags.yes === true;
  try {
    const result = await runRestore(io.env, io.cwd, {
      snapshot: positionals[0] as string,
      force,
      dryRun: flags["dry-run"] === true,
    });
    for (const line of result.lines) out(line);
    return result.exitCode;
  } catch (error) {
    const secrets = collectSecretValues(io.env);
    const message = redactSecrets(error instanceof Error ? error.message : String(error), secrets);
    err(`db:restore failed: ${message}`);
    if (error instanceof BackupError && error.exitCode === EXIT.USAGE && !fs.existsSync(path.join(io.cwd, BACKUP_DIR_NAME))) {
      err(`(No ${BACKUP_DIR_NAME} directory under ${io.cwd} — run \`npm run db:backup\` first, or pass the snapshot's absolute path.)`);
    }
    return error instanceof BackupError ? error.exitCode : EXIT.UNEXPECTED;
  }
}

type CliIoLike = {
  env: EnvLike;
  cwd: string;
  out?: (line: string) => void;
  err?: (line: string) => void;
};

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
  runRestoreCli(process.argv.slice(2), { env: process.env, cwd: process.cwd() })
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      process.stderr.write(`db:restore crashed: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(EXIT.UNEXPECTED);
    });
}
