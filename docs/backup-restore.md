# Backup and restore

**Audit finding:** MF-06 — the app stores nothing but the database, yet the
repository had no supported way to snapshot it or put it back.

**Implementation:** `scripts/backup.ts` (`npm run db:backup`) and
`scripts/restore.ts` (`npm run db:restore`). Both are also unit-tested in
`tests/unit/backup-restore.test.ts`, including the parts that must never
happen: writing an environment secret into a snapshot, or restoring without an
explicit `--force`.

Everything below describes the behaviour of those scripts as it was observed on
this repository; the `--help` output of each script is the authority on flags.

---

## 1. The two-minute version

```bash
npm run db:backup                 # snapshot into ./backups/<UTC timestamp>/
npm run db:restore -- 2026-10-07T23-21-54Z     # preview only, changes nothing
npm run db:restore -- 2026-10-07T23-21-54Z --force
```

A backup is a **directory**, never a single file, and it is never overwritten.
The name is a UTC timestamp to the second, optionally with a label:

```
backups/
└── 2026-10-07T23-21-54Z/
    ├── database.sqlite        # the payload (or backup.sql for Postgres)
    └── manifest.json          # provider, row counts, checksum, app version
```

`/backups/` is in `.gitignore` — snapshots contain user data and must never be
committed.

## 2. What a snapshot contains

`manifest.json` from a real run against the development database:

```json
{
  "format": "gid-taskflow-backup",
  "formatVersion": 1,
  "appVersion": "0.1.0",
  "createdAt": "2026-10-07T23:21:54.189Z",
  "dbProvider": "sqlite",
  "payload": { "file": "database.sqlite", "kind": "sqlite-file", "bytes": 114688, "sha256": "96a0…" },
  "rowCounts": { "Task": 28, "TaskEvent": 59, "Job": 13, "Project": 16, "ApiToken": 6, "…" : "…" },
  "totals": { "tables": 9, "rows": 123 },
  "secretHandling": { "envSecretsWritten": false, "note": "…" }
}
```

The row counts are read **from the snapshot**, not from the live database, so
the manifest is evidence about the copy you are holding. `_prisma_migrations`
bookkeeping is deliberately excluded from the reported tables.

Payload kinds:

| Provider | How it is taken | Payload |
| --- | --- | --- |
| SQLite | `better-sqlite3` online backup API; falls back to `VACUUM INTO`, then to checkpoint + copy | `database.sqlite` |
| Postgres | `pg_dump --no-owner --no-privileges --format=plain` | `backup.sql` |

The SQLite chain matters: the backup API produces a consistent copy **while the
app is writing**, which is the only safe way to snapshot a live file. Plain file
copying is not offered.

## 3. Credentials and secrets

- A snapshot contains the **stored digests only**: the bcrypt `APP_PASSWORD_HASH`
  in `UserSettings` and SHA-256 API token digests in `ApiToken`. Plaintext
  credentials are never in the database, so they are never in a snapshot.
- No environment secret (`SESSION_SECRET`, `APP_PASSWORD`, `DATABASE_URL`,
  tokens) is ever written into the payload or the manifest. The manifest records
  `envSecretsWritten: false`, and a final guard checks every line the script
  prints — including output captured from `pg_dump` — and refuses to emit it if
  an environment secret appears anywhere in it.
- To hand a copy of the data to someone else without the credentials that can
  call the API, add `--exclude-tokens`: `ApiToken` rows are dropped and the
  manifest records that, so the restore still verifies.

Treat a snapshot with the same care as the production database.

## 4. Configuration

| Variable | Used by | Default |
| --- | --- | --- |
| `DB_PROVIDER` | both | `sqlite` |
| `DATABASE_URL` | both | provider-specific below |
| `DATABASE_URL_SQLITE` | backup | `file:./dev.db` |
| `DATABASE_URL_POSTGRES` | backup/restore | from `DATABASE_URL` |
| `PRISMA_SCHEMA_PATH` | backup | provider's schema |
| `GID_BACKUP_DIR` | both | `<db directory or cwd>/backups` |
| `PG_DUMP_PATH` | backup | `pg_dump` on `PATH` |
| `PSQL_PATH` | restore | `psql` on `PATH` |

Resolution follows the same rules as the app itself, so a snapshot taken next to
the running database is describing the database the app is actually using — the
command prints `provider`, `connection` (redacted) and `backup root` on every
run before it writes anything.

## 5. Flags

`npm run db:backup -- [options]`

- `--label <text>` — suffix on the timestamped directory (`2026-10-07T23-21-54Z-pre-release`).
- `--out <name>` — explicit snapshot directory name; it must stay inside the backup root, so a mistyped path cannot scatter snapshots across the filesystem.
- `--exclude-tokens` — drop `ApiToken` rows.
- `--dry-run` — print the plan, write nothing.
- `--json` — print the manifest as the last line, for piping into a job runner.

`npm run db:restore -- <snapshot-dir|name> [options]`

- `<snapshot>` — a directory inside the backup root, given as a name or a path.
- `--force` / `--yes` — actually apply. **Without either flag the command is a
  preview** that prints what would be replaced and exits 0 having changed
  nothing. That default is intentional: restore is the operation an operator
  should never be able to trigger by tab-completing a command.
- `--dry-run` — the same preview, spelled explicitly for scripts.

Exit codes for both: `0` ok (including a preview), `2` usage, `3` missing tool
or resource, `4` verification failed.

## 6. What restore checks

1. The manifest parses and is a `gid-taskflow-backup` with a checksum.
2. The payload's SHA-256 matches the manifest — a truncated or edited snapshot
   stops there.
3. For SQLite, `PRAGMA integrity_check` on the payload must answer `ok`.
4. The current database is snapshotted first — the same `db:backup` path, with
   the label `pre-restore`, written into the backup root — so the state you are
   overwriting is recoverable. A restore onto an empty target skips it.
5. After the swap the live row counts are re-read and compared with the
   manifest; a mismatch exits `4` and tells you where the safety snapshot is.

For Postgres, step 4 is a schema-level operation: a non-empty target means the
`public` schema is recreated and reloaded from the plain SQL dump, because the
dump contains `CREATE TABLE` statements. That is destructive and it is the
reason `--force` exists. If `psql` is missing the script says so and prints the
exact `psql` command to run by hand instead of failing mysteriously.

## 7. Where the scripts run

Both scripts are TypeScript executed with `tsx`, a **dev dependency**. They run
wherever `npm ci` has installed dev dependencies — a checkout, CI, or a
maintenance container. They are not part of the production image, which ships
only the Next.js standalone output.

Production patterns that work with that:

- **SQLite on a volume (the compose/Coolify default).** Run the backup from a
  checkout with `DATABASE_URL_SQLITE` pointed at the mounted file, so the
  online backup API reads the live database through the same file handle
  semantics the app uses. The mounted path in `docker-compose.yml` is
  `file:/data/dev.db`.
- **Postgres.** Nothing needs to be inside the app container: `pg_dump` over the
  network against `DATABASE_URL_POSTGRES` is the normal tool for the job, and
  the database container itself has `pg_dump` if you prefer
  `docker compose exec postgres pg_dump …` and then build the manifest by hand.
- **A maintenance container** for a scheduled job: mount the repo (or just
  `node:22` plus `npx tsx scripts/backup.ts --json`) and the data volume, then
  cron it.

Coolify note: container names get a random suffix, so never script
`docker compose exec <fixed-name>` against a stack you do not own. Address the
database through `DATABASE_URL*` values, which is what these scripts do.

## 8. Limits of this design

- No encryption at rest: snapshots are ordinary files. Encrypt the volume or the
  artifact store, not the script.
- No off-site copy or retention policy — schedule `db:backup` and let your
  storage layer age the directories.
- No automated restore rehearsal. The most common backup failure is a snapshot
  that was never restored; `db:restore` without `--force` against a scratch
  database is the cheapest way to check, and is worth putting in CI.
