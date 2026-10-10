# GID Task Flow

A **single-user** task and time tracker: jobs contain projects, projects contain
tasks, and every task records real worked time against the job's business hours.
Subtasks, break scheduling, progress notes and printable activity reports round
it out. Built with Next.js 16 (App Router), TypeScript, Prisma 7 and Tailwind CSS v4.

There is one owner credential, no user model and no per-user data scoping. That
is a deliberate product decision, recorded with its consequences in
[`docs/architecture.md`](docs/architecture.md#adr-001-single-user-by-design).
This README describes the code that is actually in the repository — claims here
were last re-checked against commit `9a46388` (2026-10-08) and every command and
path below exists.

---

## Feature inventory

Task tracking
- Tasks move through `in_progress`, `on_hold`, `completed`, `cancelled`; every
  transition is written by one state machine (`src/lib/task-lifecycle.ts`) that
  computes elapsed seconds server-side, so the clock cannot be edited by a client.
- `hold` banks the running task into `on_hold`, and starting another task
  auto-holds the previous one — a day never bills two tasks simultaneously.
- Subtasks per task, progress notes, completion output, cancellation reason.
- Every state change is recorded as a `TaskEvent` row (`created`, `started`,
  `completed`, `cancelled`, `note`, ...).
- Tasks are grouped by date on the board. Jobs and projects are never deleted
  (`isArchived` is a flag); the one task delete route is the opt-in hard delete
  `DELETE /api/tasks/:taskId?hard=true`, which refuses anything but a terminal
  task with no unfinished subtask and leaves an audit line (`src/app/api/tasks/[taskId]/route.ts`).
  Subtasks and break types also hard-delete.

Breaks
- Per-job break types, one-time or recurring, with an optional minute duration.
- Starting a break pauses the UI; ending it writes **one** completed break task
  through `POST /api/breaks/log`, inside a transaction that first banks the
  task that was running (`src/lib/breaks.ts`).

Reporting
- Filters by job, project and date range (`day` / `week` / `month` / `range`),
  grouping by date, job or project, and a configurable report title.
- PDF via headless Chromium with automatic HTML fallback when no browser is
  available; a single in-process mutex rejects concurrent exports with `429`.
- Dashboard aggregates are memoised per process (`src/lib/stats-cache.ts`).

Interface
- Glassmorphism UI driven by design tokens in `src/app/globals.css`;
  shared primitives live in `src/components/ui/`.
- Automatic dark mode: a `prefers-color-scheme: dark` block overrides the token
  set (surface, text, borders, shadows, page gradient).
- Mobile and tablet: the sidebar becomes an off-canvas drawer with a hamburger,
  skip link, backdrop, Escape/route-change close and scroll lock; wide dashboard
  tables switch to stacked label/value cards below `md`.
- Contrast is a manual review item, not an automated gate: action buttons and
  accent text use 700-weight gradients/tints. There is no axe/pa11y CI job.

---

## Requirements

- Node.js `^20.19.0 || ^22.12.0 || >=24.0.0` — declared in `package.json`'s `engines`
  and enforced at install time by `.npmrc` (`engine-strict=true`). The floor is not
  a preference: `prisma@7` requires `^20.19` on the 20 line, and the Dockerfile pins
  `node:20-alpine3.20` (with digest; the build transcript reports `v20.19.2`), which
  clears that floor by one patch version. CI runs `node-version: "20"`. Before this
  field existed, a devDependency whose own `engines` excluded Node 20 installed with a
  warning and then died inside CI's test worker — see RA-09 in the CHANGELOG.
- SQLite 3 (default, zero setup) **or** PostgreSQL — `docker-compose.yml` and
  `docker-compose.prod.yml` both pin `postgres:16-alpine`.
- A Chromium/Chrome binary only if you want PDF instead of HTML export.

## Quick start

```bash
npm install
cp .env.example .env           # then set SESSION_SECRET and your password
npm run db:migrate             # prisma migrate dev --schema prisma/schema.sqlite.prisma
npm run dev                    # http://localhost:3000
```

> `.env.example` exists on disk but is **not tracked by git** — `.gitignore`
> pattern `.env*` swallows it. Until that is fixed (see
> [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md#repository-hygiene)), a fresh clone
> has no template and you must create `.env` by hand from the table below.

First run without a usable credential is a supported state, not a crash: the
login page shows a setup banner telling you to generate a hash
(`npm run password:hash -- "your-password"`) and set `APP_PASSWORD_HASH`.

## Scripts

Every row is a real entry in `package.json` `scripts`.

| Command | What it does |
| --- | --- |
| `npm run dev` | `next dev` |
| `npm run build` | `next build` (production build) |
| `npm start` | `next start` on the built server |
| `npm test` | `lint` + `typecheck` + `vitest run` — the full local gate |
| `npm run lint` | `eslint` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test:unit` | `vitest run --exclude tests/integration/**` |
| `npm run test:integration` | `vitest run tests/integration` (route handlers + temp SQLite) |
| `npm run test:coverage` | `vitest run --coverage` (v8, thresholds in `vitest.config.ts`) |
| `npm run test:e2e` | `playwright test` — 3 engines x 3 viewports against a real `next dev` |
| `npm run test:e2e:install` | `playwright install --with-deps chromium webkit firefox` |
| `npm run bundle:budget` | `node scripts/measure-bundle.mjs` — per-route First Load JS + budget gate |
| `npm run db:migrate` / `db:migrate:sqlite` | `prisma migrate dev` on `prisma/schema.sqlite.prisma` |
| `npm run db:migrate:postgres` | `prisma migrate deploy` on `prisma/postgres/schema.prisma` |
| `npm run db:migrate:dev:postgres` | `prisma migrate dev` on the Postgres schema (authoring) |
| `npm run db:generate` / `db:generate:sqlite` | client generation, SQLite schema |
| `npm run db:generate:postgres` | client generation, Postgres schema |
| `npm run db:migrate:sqlite-to-postgres` | `tsx scripts/migrate-sqlite-to-postgres.ts` data move |
| `npm run db:seed` | `tsx prisma/seed.ts` demo data |
| `npm run db:parity` | `node scripts/check-schema-parity.mjs` — fails if the two Prisma schemas drift |
| `npm run smoke:container -- <baseUrl>` | `node scripts/container-smoke.mjs` — 28 functional checks against a *running* container (`APP_USERNAME`/`APP_PASSWORD`, `REQUIRE_PDF=1` to demand a real PDF) |
| `npm run db:backup` | `tsx scripts/backup.ts` — labelled snapshot of the active provider (`docs/backup-restore.md`) |
| `npm run db:restore` | `tsx scripts/restore.ts` — verifies and restores one of those snapshots |
| `npm run password:hash -- "pw"` | `tsx scripts/hash-password.ts`, bcrypt cost 12, for `APP_PASSWORD_HASH` |
| `npm run docs:openapi` | regenerate `docs/openapi.yaml` from the zod schemas |
| `npm run docs:openapi:check` | fail if the committed OpenAPI file is stale (CI) |

Not present in `package.json`: `postinstall`, `test:watch`, `format`. Do not
script against them. (`db:backup` and `db:restore` *do* exist — they were added
by the MF-06 backup tooling; this note used to claim they did not, which the
2026-10-09 re-audit caught by diffing the note against `package.json`.)

## Configuration

These are the variables the working tree reads
(`grep -rho "process.env\.[A-Z_]*" src scripts next.config.ts` was the check).
There are no NextAuth variables — NextAuth is not a dependency; sessions are
`jose`-signed cookies this app signs itself.

| Variable | Default | Read by | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | `file:./dev.db` | `src/lib/prisma.ts`, entrypoint | `file:` = SQLite, `postgresql://` = Postgres |
| `DB_PROVIDER` | inferred | `src/lib/prisma.ts` | `sqlite` / `postgres`; a provider/URL mismatch aborts startup |
| `DATABASE_URL_SQLITE` | `file:./dev.db` | entrypoint / prisma | used when `DATABASE_URL` is unset |
| `DATABASE_URL_POSTGRES` | local postgres | entrypoint / prisma | used when `DATABASE_URL` is unset |
| `PRISMA_SCHEMA_PATH` | unset | entrypoint, prisma | tells the runtime which schema the generated client came from |
| `DB_QUERY_TIMEOUT_MS` | `8000` | `src/lib/db-resilience.ts` (`withQueryTimeout`) | per-query timeout; clamped to 500..30000 |
| `SESSION_SECRET` | — | `src/lib/session.ts`, `src/proxy.ts`, `src/lib/startup-checks.ts` | required, >= 16 chars, not a known default; production refuses to boot otherwise |
| `APP_USERNAME` | `admin` | `src/lib/auth.ts` | login name |
| `APP_PASSWORD_HASH` | — | `src/lib/auth.ts` | preferred credential (bcrypt cost 12) |
| `APP_PASSWORD` | — | `src/lib/auth.ts`, `src/lib/startup-checks.ts` | development convenience; **hard failure in production** |
| `ALLOW_CLIENT_START_TIME` | unset | `src/app/api/tasks/route.ts` | set `true` only to trust client-supplied task start times |
| `PUPPETEER_EXECUTABLE_PATH` | auto-detected | `src/lib/pdf-render.ts` | Chromium used for PDF export; unset means HTML fallback |
| `DEV_ALLOWED_ORIGINS` | localhost | `next.config.ts` | comma-separated extra origins for `allowedDevOrigins` (dev/LAN only) |
| `NEXT_DIST_DIR` | `.next` | `next.config.ts` | build/cache dir; the Playwright matrix sets `.next-e2e` |
| `GID_BACKUP_DIR` | `<db dir or cwd>/backups` (so `/data/backups` in the image) | `scripts/backup.ts`, `scripts/restore.ts` | snapshot location; the default keeps backups on the persistent volume, not the container's writable layer |
| `PG_DUMP_PATH` | `pg_dump` on `PATH` | `scripts/backup.ts` | absolute-path override for the Postgres dump binary |
| `PSQL_PATH` | `psql` on `PATH` | `scripts/restore.ts` | absolute-path override for `psql` — Postgres restores run through `psql -f`, not `pg_restore` |

The last three are read inside the backup scripts, which take an injected `env`
object (`env.GID_BACKUP_DIR`, `requireTool(env, "pg_dump", "PG_DUMP_PATH")`,
`env.PSQL_PATH`) instead of spelling `process.env.<NAME>`, so the grep above does
not find them on its own — they were missing from this table until the 2026-10-09
re-audit. `PATH_ENV_KEYS` in `scripts/backup.ts` also whitelists
`PG_RESTORE_PATH` for redaction, but nothing calls `pg_restore`, so that name is
deliberately not documented as a knob.
| `PORT` | `3000` | `next start`, container | `HOSTNAME` is pinned to `0.0.0.0` in the Dockerfile because Docker otherwise injects the container name |

## Authentication and access model

Public, unauthenticated paths are exactly `/login`, `/api/auth/login`,
`/api/health` (plus `/_next` and `/favicon.ico`) — the `publicPaths` list in
`src/proxy.ts` (Next 16's middleware replacement). Everything else needs one of
two credentials:

1. **`stl_session` cookie** — human browser session, `jose` HS256 JWT with
   `{sub, tv}`; `tv` matching `UserSettings.tokenVersion` is what revokes old
   cookies on logout or password change.
2. **`Authorization: Bearer gid_...`** — scoped API token
   (`src/lib/api-tokens.ts`), accepted only by handlers that forward their
   `Request` to `requireAuth(request)` / `requireWriteAccess(request)`.
   `read` tokens get GET; mutating routes demand `write` (otherwise `403`).

`src/proxy.ts` passes Bearer-presented `/api/*` requests through so machine
clients get JSON `401`/`403`/`429` instead of a redirect to the HTML login page;
verification happens in the route, never in the proxy. `/api/tokens` itself is
**cookie-only** (`requireSessionAuth`) — a token cannot mint, list or revoke
another token.

Full posture, rate-limit budgets, idempotency rules and residual risks:
[`docs/security.md`](docs/security.md).

## API

| Method + path | Purpose | Notes |
| --- | --- | --- |
| `POST /api/auth/login` | `{username, password}` | sets HttpOnly, `SameSite=Lax`, `Secure`-in-production cookie; per-IP rate limited |
| `POST /api/auth/logout` | clears the cookie | bumps `tokenVersion` |
| `GET /api/health` | liveness/readiness | `{status:"ok"}` or `503 {status:"error"}`; unauthenticated on purpose |
| `GET /api/stats` | dashboard aggregates | includes the `onHold` bucket |
| `GET/POST /api/jobs`, `GET/PATCH /api/jobs/:jobId` | jobs + per-job schedule/break config | GET accepts `limit`, `cursor`, `q` |
| `GET/POST /api/projects`, `GET/PATCH /api/projects/:projectId` | projects | `isArchived` is a flag, not a delete; GET accepts `limit`, `cursor`, `q`, `jobId` |
| `GET /api/tasks` | board payload | `projectId` (or `jobId`); tasks arrive **with** their subtasks; optional `limit` (1..200, default 50), `cursor`, `q`, `status` — when `limit`/`cursor` are used the payload gains `nextCursor` (`null` on the last page) |
| `POST /api/tasks` | create | `title`, `description?`, `projectId`, `isBreak?` |
| `PATCH /api/tasks` | transition | `{taskId, action:"complete"\|"cancel"\|"resume"\|"hold"\|"log-notes", details?, notes?}` — no client-controlled time |
| `GET/POST/PATCH/DELETE /api/subtasks` | subtask CRUD | `?taskId=` / `?id=` |
| `GET/POST/PATCH/DELETE /api/breaks` | break config per job | `?jobId=` / `?id=` |
| `POST /api/breaks/log` | record a finished break | `{jobId, projectId?, name, startedAt}`; transactional |
| `GET/POST/PATCH /api/attendance` | check-in/out ledger | `?jobId=` |
| `GET/POST/PATCH /api/settings` | settings row (incl. password change) | single row, `id = 1` |
| `GET/PATCH /api/profile`, `GET/PATCH /api/report-titles` | profile / title templates | |
| `GET/POST/PATCH/DELETE /api/tokens` | scoped API tokens | cookie-session only. POST returns the plaintext **once**; only its SHA-256 digest is stored. `DELETE` is a revoke that keeps the row |
| `GET /api/export` | report download | `?timePeriod=day\|week\|month\|range&groupBy=date\|job\|project&startDate&endDate&jobIds=1,2&projectIds=3&reportTitle=` — PDF, HTML fallback, `404` when the filter matches no task, `429` while another export runs |

The machine-readable contract is
**[`docs/openapi.yaml`](docs/openapi.yaml)** — 21 paths / 42 operations, request
schemas generated straight from the zod schemas in `src/lib/validators.ts`
(`npm run docs:openapi`; freshness checked by `npm run docs:openapi:check`).
Known gap: `/api/tokens` is **not** in that document yet, so the generated
contract does not cover token minting.

## Architecture

```
src/
  app/                 routes (pages + API handlers, thin: auth -> validate -> service -> respond)
  components/          client components; ui/ holds the shared primitives
  hooks/               useApiMutation / useKeyedApiMutation / useStoredState, useMediaQuery
  lib/                 domain logic: task-lifecycle, business-time, breaks, validators,
                       auth, session, prisma (dual-provider client), bootstrap, startup-checks,
                       rate-limit, api-tokens, idempotency, security-events, stats-cache,
                       export-*, pdf-render, sanitize, rich-text, navigation, api-error, abort
  proxy.ts             cookie/Bearer gate + login redirect target
  instrumentation.ts   boots startup checks before the server takes traffic
prisma/
  schema.sqlite.prisma + migrations/     SQLite (13 versioned migrations)
  postgres/schema.prisma + migrations/   Postgres (baseline + the API-token migration)
scripts/               hash-password, measure-bundle, check-schema-parity,
                       generate-openapi, migrate-sqlite-to-postgres
docs/                  openapi.yaml (generated contract), security.md, architecture.md,
                       CONTRIBUTING.md
tests/                 unit/ (pure lib), integration/ (route handlers + temp SQLite),
                       e2e/ (Playwright matrix)
```

There is **no** `prisma/schema.prisma` file. Two schema files exist because
Prisma cannot emit one client for two providers; `npm run db:parity` fails if
anything except the provider/datasource lines drifts. Module map and the
single-user decision: [`docs/architecture.md`](docs/architecture.md).

## AI / agent integration

For an agent working on this repo, the reliable entry points are:

- `AGENTS.md` — the build/test/docker gate that must pass before a commit, and
  the warning that this Next.js version differs from older training data.
- `docs/openapi.yaml` — the request/response contract for the 17 documented
  paths (not `/api/tokens` yet).
- The invariant scripts: `npm run db:parity` (schema duplication),
  `npm run bundle:budget` (code splitting), `npm run docs:openapi:check`
  (contract freshness).

For an external integration, API tokens are real and usable today: mint one with
a browser session at `POST /api/tokens`, send it as `Authorization: Bearer gid_...`,
scope it `read` unless writes are required, give it an `expiresAt`, and revoke it
per token. Per-token rate limit is 120 requests/minute; `Idempotency-Key` is
honoured by `POST /api/tokens` (a retried mint replays instead of creating a
second token). Worked curl sequence: `docs/security.md` section 1.4.

Still not available: no token-management UI page (the route is API-only, no
`src/app/**/page.tsx` links to it), no per-token route allow-list (a `write`
token reaches every wired route), no bulk-import endpoint, and `/api/tokens` is
missing from the OpenAPI document.

## Security posture (honest)

- One owner credential, bcrypt cost 12 (`BCRYPT_COST` in `src/lib/auth.ts`),
  plus scoped, individually revocable bearer tokens.
- Session is a `jose` HS256 JWT in an HttpOnly, `SameSite=Lax`,
  `Secure`-in-production cookie carrying `{sub, tv}`; `SESSION_SECRET` is
  validated fail-closed at boot (`src/lib/startup-checks.ts`).
- CSRF: there is **no** CSRF token and no `Origin`/`Referer` check. `SameSite=Lax`
  plus `Content-Security-Policy frame-ancestors 'none'` / `X-Frame-Options: DENY`
  is the mitigation, and mutations are POST/PATCH/DELETE only. Documented residual
  risk, not a feature.
- Rate limits per IP (login 5/5min) and per token id (120/min) with `Retry-After`
  on `429`; security events are written as redacted JSON lines to stderr
  (`src/lib/security-events.ts`).
- Rich text is sanitised with DOMPurify on write and on render; link hrefs are
  restricted to `http(s):`, `mailto:` and root-relative paths.
- Security headers (CSP, nosniff, Referrer-Policy, Permissions-Policy, HSTS in
  production) ship from `next.config.ts`; the container runs as a non-root user
  with a `/api/health` HEALTHCHECK.
- Post-login redirects go through the validator in `src/lib/navigation.ts`, which
  rejects absolute, protocol-relative and backslash tricks.
- **A deployment exposes exactly one account.** Network reachability is the
  operator's problem: reverse-proxy auth, VPN, or Coolify's internal networking —
  see `docs/architecture.md` (ADR-001 consequences).

## Testing

- `npm test` chains lint + typecheck + vitest, so "green" cannot mean
  "tests pass while lint errors".
- Unit tests (`tests/unit/`) cover the pure domain layer: transitions,
  business-hours arithmetic, validators, redirect safety, rich-text extraction,
  startup checks, sessions, api tokens, idempotency, rate limiting, security
  events, stats cache, export helpers/HTML/PDF stubs.
- Component tests (`tests/unit/components/`) render the interactive board
  components in jsdom with Testing Library queries — no server, so a fetch is
  whatever the test stubs. They cover what the browser matrix cannot assert
  cheaply: the modal dialog contract (`role="dialog"`, `aria-modal`, Escape,
  focus moves in and back out, Tab stays inside), every control having a real
  accessible name, subtask fetch/toggle/delete round-trips, per-row busy state,
  and the paginated board's params and cursor. `vitest.config.ts` runs them as a
  second project pinned to `NODE_ENV=development`, because `React.act` is absent
  from a production React build and the `node` project must keep exercising
  production code paths.
- Integration tests (`tests/integration/`) import the real route handlers and run
  them against a throwaway SQLite file: auth, api tokens, task state machine and
  races, break logging (including rollback), subtasks, attendance, stats,
  jobs/projects, list pagination (`lists.test.ts`) and export filtering.
- `npm run test:coverage` enforces thresholds over `src/lib` and `src/app/api`
  (60% lines/functions/statements, 50% branches) — a ratchet, not a wish.
- `npm run test:e2e` is the browser matrix: 3 engines x 3 viewports
  (Chromium/WebKit/Firefox at 375/768/1440px) checking that the shell does not
  scroll horizontally, that navigation is reachable at each size, that the main
  routes log no page/console errors, and that exporting hands the user a
  non-empty file in that engine. `tests/e2e/global-setup.ts` owns the app
  process: it runs `next dev` with `NEXT_DIST_DIR=.next-e2e` (so it can never
  serve a stale cache to `npm run dev`), migrates and seeds a dedicated
  `e2e-playwright.db` on a dedicated port (3177, override with `E2E_PORT`),
  reclaims that port from a leftover `next` process before wiping the file, and
  shuts its own server down. It is deliberately not Playwright's `webServer`
  option, because `webServer` boots before `globalSetup` and cannot seed first.
- `npm run smoke:container` is the container gate: it logs into a *running*
  image and walks the real contracts — task lifecycle with server-side timing,
  `Idempotency-Key` replay, break dedupe, stats, export, a PDF produced by the
  image's own Alpine Chromium (`REQUIRE_PDF=1`), token mint/scope/revocation, the
  hard-delete guard, admin event paging, logout. CI runs it against both
  providers after the health check. It exists because unit, integration and
  browser tests all passed over a container-only PDF failure (audit AR-06).
- Not covered today: pixel-level visual regression baselines (the matrix checks
  geometry and console hygiene, not screenshot diffs) and automated WCAG axe
  scans. Accessible *names* and the dialog contract are now asserted in the
  component suite; colour contrast and landmark coverage are still a manual
  review.

## Docker and Coolify

```bash
# Both compose files require these two values; put them in a local `.env`
# (git-ignored) next to docker-compose.yml, or export them per command.
SESSION_SECRET="$(openssl rand -hex 32)"
APP_PASSWORD_HASH="$(npm run password:hash -- 'your-password')"

docker build -t gid-task-flow .
docker run --rm -p 3000:3000 -v stl-data:/data \
  -e SESSION_SECRET -e APP_PASSWORD_HASH gid-task-flow        # SQLite volume at /data

docker compose up                                              # SQLite (default)
DB_PROVIDER=postgres docker compose --profile postgres up      # Postgres
docker compose -f docker-compose.prod.yml up -d                # production shape
DB_PROVIDER=postgres docker compose -f docker-compose.prod.yml --profile postgres up -d
```

- `docker-compose.yml` (dev/demo) and `docker-compose.prod.yml` (restart policy,
  resource limits, healthchecks) both exist and are self-contained — do not
  layer them. **Neither supplies a `SESSION_SECRET` or an `APP_PASSWORD_HASH`
  default any more** (SEC-03): compose refuses to start until you provide them,
  because a hash of `admin123` and a secret printed in a public README are no
  credentials at all. `startup-checks.ts` also rejects the old demo secret by
  value, so a copy of the retired compose file cannot boot a real deployment.
- The image builds from Next's `output: "standalone"`, runs as a non-root user,
  installs Chromium from the Alpine package for PDF export, and runs
  `prisma generate` + `migrate deploy` only when the schema/migration hash
  changes (`docker-entrypoint.sh`).
- Coolify renames containers (`<name>-<random suffix>`), so nothing may hardcode
  a service DNS name: the database host always comes from `DATABASE_URL` /
  `DATABASE_URL_POSTGRES`, never from a fixed container name.
- No `DATABASE_URL` is baked into the image: the entrypoint resolves the
  connection from `DB_PROVIDER` plus `DATABASE_URL` / `DATABASE_URL_SQLITE` /
  `DATABASE_URL_POSTGRES`, so attaching Postgres is `DB_PROVIDER=postgres` +
  `DATABASE_URL_POSTGRES` (or one `DATABASE_URL`) with no rebuild.

## Development workflow, releases, known limitations

- Contribution rules, the branch/PR convention and the tagging/release
  procedure: [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md).
- Release history: [`CHANGELOG.md`](CHANGELOG.md). Check `git tag -l` for what
  has actually shipped; `v0.2.0` is the annotated tag for this audit
  remediation campaign, and per `docs/CONTRIBUTING.md` a tag is only ever
  created after CI is green at that exact commit.
- `AGENTS.md` states the definition of done, and `.github/workflows/ci.yml`
  enforces lint, typecheck, tests, coverage, build, bundle budget, schema
  parity, OpenAPI freshness, compose-file parsing, the image build, and a
  container boot plus `npm run smoke:container` against **both** SQLite and
  Postgres. CI only runs once the work is pushed to
  GitHub — the workflow exists in-tree, and unpushed commits are unverified by it.

Known limitations
- Single shared account: no users, roles, or per-user filtering (ADR-001).
- List endpoints paginate only when asked (`limit`/`cursor` on `/api/tasks`,
  `/api/jobs`, `/api/projects`); `q` is a substring match on title/name, not
  full-text search, and related reads (`/api/tasks` with subtasks) still load
  whole pages of rows at once.
- Rate limits, idempotency and the stats cache are **per process**; a second
  replica or a restart resets them.
- Idempotency keys are honoured on the creating routes (`/api/tasks`, `/api/jobs`,
  `/api/projects`, `/api/breaks`, `/api/breaks/log`, `/api/attendance`,
  `/api/tokens`) — see `docs/security.md` §7. The single-row `PATCH`/`DELETE`
  routes are last-write-wins and deliberately have no key: the transition machine
  in `src/lib/task-lifecycle.ts` rejects an out-of-order repeat instead of
  double-applying it.
- Coverage excludes the browser-dependent PDF step; no a11y automation.
- `npm run db:backup` / `npm run db:restore` produce and verify labelled
  snapshots (`docs/backup-restore.md`). They run through `tsx`, a devDependency,
  so they are a host-side operation: the standalone image cannot run them, and
  Postgres snapshots additionally need `pg_dump` on the PATH.

## Support and feedback

This is a self-hosted, single-operator project. There is no support inbox, no
SLA, and no promise that GitHub Issues, Discussions or the Wiki are monitored —
the remote is `https://github.com/muisdevop/project-tasks-log` and the
canonical place decisions and defects live is this repository's files
(`CHANGELOG.md`, `docs/`). If you run this for someone else, the person who owns
that deployment is the support channel: they hold `SESSION_SECRET`, the database
and every credential in it.

For a suspected vulnerability, do not open a public issue: rotate
`SESSION_SECRET`, revoke tokens at `DELETE /api/tokens?id=n`, and fix forward.

## License

MIT — see [LICENSE](LICENSE). `package.json` declares `"license": "MIT"` to
match, and the package is `private` so it is never published.
