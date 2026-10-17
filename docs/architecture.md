# Architecture

Module map and the load-bearing design decisions of GID Task Flow. Claims are
pinned to a commit so they can be re-checked: this pass was written against
`9a46388` ("feat: API tokens, idempotency, pagination, export refactor and auth
wiring"), 2026-10-08.

## 1. Shape of the system

Next.js 16 App Router, one process, one owner. Route handlers are thin:
authenticate → validate with zod → call a `src/lib` service → respond. All
domain arithmetic lives in `src/lib`, which is what makes it unit-testable
without a browser or a server.

```
browser / agent
      │
      ▼
src/proxy.ts            cookie gate; passes Bearer-presented /api/* through
      │
      ▼
src/app/api/**/route.ts  requireAuth | requireWriteAccess | requireSessionAuth
      │                    → zod (src/lib/validators.ts)
      ▼
src/lib/**               task-lifecycle, business-time, breaks, export-*,
                         api-tokens, idempotency, rate-limit, security-events,
                         stats-cache, prisma, session, auth, bootstrap,
                         startup-checks
      │
      ▼
Prisma 7 (driver adapters) ── SQLite (better-sqlite3) or Postgres (pg)
```

| Area | Files | Responsibility |
| --- | --- | --- |
| AuthN/AuthZ | `src/lib/auth.ts`, `src/lib/session.ts`, `src/lib/api-tokens.ts`, `src/proxy.ts` | one owner credential + scoped revocable bearer tokens; `tokenVersion` session revocation |
| Task domain | `src/lib/task-lifecycle.ts`, `src/lib/business-time.ts` | the only place a status or an elapsed-seconds value is computed; server-authoritative |
| Breaks | `src/lib/breaks.ts`, `src/app/api/breaks/log/route.ts` | banks the running task, then writes one completed break task in a transaction |
| Reporting | `src/lib/export-data.ts`, `export-html.ts`, `export-html-styles.ts`, `pdf-render.ts`, `src/app/api/export/route.ts` | query → aggregation → HTML → Chromium PDF, HTML fallback if no browser |
| Machine API | `src/app/api/tokens/route.ts`, `src/lib/idempotency.ts`, `src/lib/rate-limit.ts`, `src/lib/security-events.ts` | mint/list/revoke tokens, replay protection, throttling, redacted audit lines |
| Persistence | `prisma/schema.sqlite.prisma` + `prisma/migrations/`, `prisma/postgres/schema.prisma` + `prisma/postgres/migrations/`, `src/lib/prisma.ts` | dual provider, parity-enforced (`scripts/check-schema-parity.mjs`) |
| Boot | `src/instrumentation.ts`, `src/lib/startup-checks.ts`, `src/lib/bootstrap.ts` | fail-closed config validation, guarantees the settings row exists |
| UI | `src/app/**/page.tsx`, `src/components/**`, `src/components/ui/**`, `src/hooks/**`, `src/app/globals.css` | client components over the same API routes; design tokens in CSS |

## 2. Data model (verified)

`prisma/schema.sqlite.prisma` declares exactly these models: `UserSettings`,
`Job`, `Project`, `Task`, `BreakType`, `TaskEvent`, `SubTask`, `JobAttendance`,
`ApiToken`. There is **no `User` model and no `userId` column on any table**
(`grep -n "userId" prisma/schema.sqlite.prisma` → no matches), and
`UserSettings` is a singleton keyed on `id Int @id @default(1)`.

`ApiToken` is the only credential table: `tokenHash` (SHA-256 digest, unique —
plaintext is never stored), `name`, `scope` (`read`/`write`), `expiresAt`,
`revokedAt`, `lastUsedAt`. Archival is a flag: `Job.isArchived` and
`Project.isArchived`.

## 3. Two Prisma schemas, one contract

Prisma cannot generate one client for two providers, so the repo carries
`prisma/schema.sqlite.prisma` and `prisma/postgres/schema.prisma`. There is no
`prisma/schema.prisma`. `npm run db:parity`
(`scripts/check-schema-parity.mjs`) fails the build when anything other than the
provider/datasource/generator lines drift, and Postgres migrations are kept as a
baseline plus per-change migrations under `prisma/postgres/migrations/`.
`src/lib/prisma.ts` infers the provider and aborts on a
`DB_PROVIDER` / `DATABASE_URL` mismatch rather than opening an empty database.

**Generate order is load-bearing (AR-02).** Both schemas emit into the same
default `node_modules/.prisma/client`, so the last `prisma generate` wins and
there is only ever one client on disk. Generate Postgres
(`npm run db:generate:postgres`) to typecheck Postgres-specific code, then
**generate SQLite again** (`npm run db:generate:sqlite`) before running
`vitest`: the integration harness boots a SQLite database, and a Postgres-built
client against it fails on provider/adapter mismatch with an error that looks
like a test bug rather than a setup bug. `npm run db:parity` proves the two
schemas agree; nothing can prove which client is currently generated, so the
sequence is a convention, and `docs/CONTRIBUTING.md` repeats it.

## 4. Invariants the code defends

1. **Elapsed time is server-side.** A client cannot set worked seconds;
   `startedAt` from a browser is ignored unless `ALLOW_CLIENT_START_TIME=true`.
2. **One running task per day.** Starting a task auto-holds the previous one;
   `hold` banks time into `on_hold`. The per-project version of this — at most
   one `in_progress` task in a project — is enforced in code, not in the
   database: `PATCH /api/tasks` (FL-02) runs the whole transition in one
   interactive transaction that (a) holds every *other* `in_progress` task of
   that project with its worked time banked, then (b) applies its own status
   change with a guarded `updateMany` (`WHERE id = ? AND status IN (<legal
   states>)`), returning 409 when that guard matches 0 rows. `POST /api/tasks`
   and `POST /api/breaks/log` use the same hold-then-write order, so no legal
   flow ever commits two runners.
   `tests/integration/task-lifecycle.test.ts` proves it for two concurrent
   resume-vs-resume requests on two different tasks of one project (fired
   together, not sequentially): exactly one task ends `in_progress`, the other
   is auto-held, and both transitions are billed once. Honest limits of that
   proof: the integration harness is SQLite-only and SQLite has a single
   writer, so the two transactions are serialized — the test shows the
   displacement logic is correct, but it cannot exercise a Postgres
   `READ COMMITTED` interleave, and this repo has no Postgres test harness.
   **Why there is no `UNIQUE (projectId) WHERE status = 'in_progress'` index:**
   the app intentionally *displaces* the running task instead of rejecting the
   new one, so a backstop would need to be deferred to commit time — and a
   partial unique index cannot be deferred (Postgres allows `DEFERRABLE` only on
   `UNIQUE` constraints, which do not support `WHERE`; Prisma expresses neither
   partial nor deferrable constraints in either schema). The immediate variant
   is actively harmful: under `READ COMMITTED` two concurrent resumes of two
   different tasks can both pass the read phase, and the loser's
   `UPDATE … status='in_progress'` blocks on the winner's uncommitted index
   tuple, then aborts its whole transaction with `23505` — replacing today's
   clean auto-hold (200, the other task back to `on_hold`) with a 500. It is
   also operationally unsafe here: an index that lives only in hand-written
   migration SQL is invisible to `prisma/schema.sqlite.prisma`, so `prisma db
   push` (what the entire integration harness provisions with, see
   `tests/integration/helpers/harness.ts`) and `npm run db:parity` silently
   disagree with the deployed database; and `CREATE UNIQUE INDEX` fails outright
   during the `prisma migrate deploy` in `docker-entrypoint.sh` if any project
   already holds two `in_progress` rows — a pre-invariant database would refuse
   to boot instead of converging, which also breaks the Coolify deploy path.
   The transaction + guarded update + the concurrency test stay the enforcement
   mechanism.

   That reasoning about *tooling blindness* is now handled rather than accepted. The
   attendance invariant (PAR-04) ships as a partial unique index
   `JobAttendance_one_open_check_in` in both migration sets, and the three objections
   above are answered one by one: the backfill runs in the same migration so a database
   that already holds two open rows converges instead of refusing to boot; the index is
   applied to the harness's `db push` databases
   (`RAW_SQL_OBJECT_MIGRATIONS` in `tests/integration/helpers/harness.ts`), so the tests
   see the constraint production has; and `npm run db:parity:migrations` fails if the two
   definitions diverge or if that harness list stops applying the file. The backfill itself is
   gated twice over (PAR-09): rule E of that script refuses a required partial index whose file
   does not resolve existing violations *before* the `CREATE`, because an un-backfilled index
   makes `migrate deploy` fail on exactly the live data the race produced, and
   `tests/unit/migration-attendance-backfill.test.ts` replays the shipped SQLite migration files
   onto a temp database with planted duplicates and asserts which row survives. The task case above
   still declines the same tool for its own reasons — a unique index on
   `(projectId) WHERE status='in_progress'` would turn today's clean auto-hold into a 500 —
   so the difference is the enforcement goal, not the mechanism.
3. **A break ends as exactly one completed break task**, written transactionally
   after banking the task that was running. FL-01 closes the double-log path
   from both ends: the widget/overlay send a **deterministic** `Idempotency-Key`
   derived from the stored break record (`jobId` + `breakTypeId` + start epoch-ms
   + project scope, `breakIdempotencyKey` in `src/lib/breaks.ts`), so a second
   tab, a double click or a retry after a timeout is answered with the original
   response plus `Idempotency-Replayed: true` instead of a second row; and
   `POST /api/breaks/log` additionally refuses to duplicate inside the same
   transaction when an equivalent break task already exists (same project +
   `<name> Break` + start minute) — it returns the existing row as an idempotent
   200 with `Break-Deduplicated: true` rather than throwing, because the
   caller's intent is already satisfied on the board. Proved by
   `tests/integration/break-idempotency.test.ts`.
4. **Destruction is opt-in and audited.** Jobs and projects are never deleted —
   archival is a flag (`isArchived`). Tasks have exactly one hard-delete route,
   `DELETE /api/tasks/{taskId}?hard=true`, which refuses unless the literal flag
   is present, the row is terminal, and no subtask is unfinished; it writes an
   in-transaction `TaskEvent` snapshot and one machine-readable
   `task.hard_deleted` JSON line after commit
   (`src/app/api/tasks/[taskId]/route.ts`). Subtasks and break types are the
   other hard deletes.
5. **Fail closed.** Short/known-default `SESSION_SECRET` aborts boot in
   production; plaintext `APP_PASSWORD` aborts boot in production; a missing
   credential shows a setup banner instead of a 500.
6. **A token can never mint a token.** `/api/tokens` is `requireSessionAuth`,
   which rejects Bearer credentials.
7. **Single-process state.** Rate-limit buckets, idempotency entries and the
   stats cache live in memory; they are not shared and do not survive a restart.

## 5. Time and timezones (FL-07)

One rule, stated once and enforced by `src/lib/business-time.ts`:

- An **instant** is a UTC-absolute `Date`. That is what Prisma columns store,
  what `gte`/`lte` compare, and what `toISOString()` serialises in API bodies.
- A **`YYYY-MM-DD` label** (`startDate`/`endDate`, the `from`/`to` list filters, a
  day group key) always names a **local** calendar day in the server's timezone —
  `TZ` when set, otherwise the container's zone, which is UTC unless the operator
  configures it. A label never means "UTC midnight to UTC midnight".
- **Day bucketing and day bounds come from the same place**: `startOfLocalDay` /
  `endOfLocalDay` / `localDayWindow` (bounds) and `localDayKey` (the bucket
  label), which are the local-field convention `workingTimeDiffSeconds` already
  used for the work-day windows. Bounds are "next local midnight minus 1 ms",
  not a stamped `23:59:59.999`, so a 23- or 25-hour DST day is covered exactly —
  and `[start, end]` selects the same storable instants as the attendance route's
  `[local midnight, next local midnight)` (`dayBounds` in
  `src/app/api/attendance/route.ts`, `dateWindowFilter` in `src/lib/validators.ts`).

The bug this closes: the export used to compute its labels from local fields and
then re-parse them as UTC (`new Date("2026-03-31T00:00:00Z")` in
`resolveExportDateWindow`), while rows were grouped on local day keys. Outside
UTC the "today" window slid by the zone offset, so an early shift was fetched but
grouped on the previous day, or dropped from the report entirely.
`tests/unit/export-timezone.test.ts` pins the rule under `UTC`, `Asia/Jakarta`
(fixed +07) and `America/Los_Angeles` (DST) by mutating `process.env.TZ`, and
asserts the export window, the export day groups and the attendance window
select the same instants; `localDateKey` (used by the grouping helpers in
`src/lib/export-helpers`) is checked against `localDayKey` so the two cannot
drift silently.

Rendering is local by design: `formatTime`/`buildReportHtml` use
`toLocaleString()`, and elapsed arithmetic never crosses a timezone boundary
inside a single request.

---

## ADR-001: The product is single-user by design

- Status: accepted
- Date: 2026-10-08 (recorded retrospectively; the design predates it)
- Evidence: `prisma/schema.sqlite.prisma` (no `User`, no `userId`),
  `src/lib/auth.ts` (one `APP_USERNAME` + one `APP_PASSWORD_HASH`),
  `src/lib/bootstrap.ts` (singleton `UserSettings` row), `src/lib/session.ts`

### Context

The tool exists to record one person's worked time, breaks and task history
against their own jobs and clients, and to print reports about it. Every
earlier README revision described it as a team or enterprise product, which
implied an access-control model the code never had. That mismatch is audit
finding **MF-07**.

### Decision

Stay single-user. One operator, one owner credential, one data set, one process.
Machine access is added **on top of** that model as scoped, individually
revocable bearer tokens rather than by introducing users.

### What the security posture actually is

- **One owner credential**: `APP_USERNAME` (default `admin`) with a bcrypt cost-12
  hash (`APP_PASSWORD_HASH`), checked in `src/lib/auth.ts`, login throttled per IP.
- **Session**: `jose` HS256 JWT cookie `stl_session` carrying `{sub, tv}`;
  `HttpOnly`, `SameSite=Lax`, `Secure` in production; `tv` (`tokenVersion`)
  revocation on logout and password change.
- **Scoped, revocable bearer tokens**: `gid_<40 hex>`, only the SHA-256 digest
  stored, `read` or `write` scope, optional `expiresAt`, per-token revoke that
  keeps the row for the audit trail, and a per-token 120 req/min budget.
- **Rate limits**: login 5/5min per IP, agent 120/min per token id, token
  minting 10/5min, plus a rejection lock so brute force does not cost DB lookups
  (`src/lib/rate-limit.ts`; budgets in `docs/security.md` §3).
- **Same-site cookie as the CSRF boundary**: no CSRF token and no `Origin`
  check; `SameSite=Lax` + `frame-ancestors 'none'` + mutations restricted to
  POST/PATCH/DELETE is the mitigation, with its residual risks written down
  (`docs/security.md` §2).
- **Redacted security events** to stderr (`src/lib/security-events.ts`).

### What this posture is **not**

Not multi-tenant, not defense-in-depth against a malicious authenticated user,
not confidentiality between colleagues. There is no per-resource ownership check
because there is no second principal to check against: any valid credential —
cookie or token — sees the entire database.

### What multi-user would require (not a small diff)

1. A `User` model plus `userId` foreign keys on `Job`, `Project`, `Task`,
   `SubTask`, `BreakType`, `TaskEvent`, `JobAttendance` and `ReportTitle` data,
   and a migration that back-fills them.
2. An ownership predicate injected into **every** read and write in `src/lib`
   and each route — today every query is unconditional, so this is a change to
   all of them, not a middleware.
3. Per-user sessions (the singleton `UserSettings.tokenVersion` has to become
   per-user) and a credential store per user; `APP_USERNAME` /
   `APP_PASSWORD_HASH` env credentials disappear.
4. Roles/permissions beyond the current `read`/`write` token scopes, plus an
   admin surface, password reset, and email or equivalent out-of-band identity.
5. Row-level security or an equivalent backstop, an audit trail that names the
   actor, and per-user rate-limit keys.
6. UI for membership, invitation and transfer of jobs/projects.

### Consequences the operator must act on

- **A deployment exposes exactly one account.** Anyone who can reach the HTTP
  port and guess one password owns every task, project, client name and report.
  There is no "least-privileged user" to fall back on.
- Therefore network exposure is **not** an application concern and must be
  handled outside it: reverse-proxy authentication (or IP allow-list), a VPN, or
  Coolify's internal networking with no public HTTP entry. TLS is required so
  the `Secure` cookie is actually sent.
- `SESSION_SECRET` is a single shared secret: rotating it revokes all sessions
  at once, and there is no per-user secret to isolate a blast radius.
- Because state is per-process, run **one** app replica. Two replicas double the
  effective rate-limit/idempotency budgets and fork the stats cache.

### Rejected alternatives

- *Shared single login for a team*: rejected — it destroys attribution of worked
  time, which is the product's purpose, and it is what the old README implied.
- *Multi-user now, as a thin "shared account + owner id" shim*: rejected —
  without foreign keys on every table the shim cannot enforce isolation, so it
  would advertise a control that does not exist.
