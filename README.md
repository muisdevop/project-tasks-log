# GID Task Flow

A single-user task and time tracker: jobs contain projects, projects contain
tasks, and every task records real worked time against the job's business hours.
Subtasks, break scheduling, progress notes and printable activity reports round
it out. Built with Next.js 16 (App Router), TypeScript, Prisma 7 and Tailwind CSS v4.

**Not** a team/enterprise product: there is one shared login, no user model, and
no per-user data scoping. The README used to claim otherwise; this version
describes the code that is actually in the repository.

---

## Feature inventory (verified against the source)

Task tracking
- Tasks move through `in_progress`, `on_hold`, `completed`, `cancelled`; every
  transition is written by one state machine (`src/lib/task-lifecycle.ts`) that
  computes elapsed seconds server-side, so the clock cannot be edited by a client.
- `hold` banks the running task into `on_hold`, and starting another task
  auto-holds the previous one — a day never bills two tasks simultaneously.
- Subtasks per task, progress notes, completion output, cancellation reason.
- Every state change is recorded as a `TaskEvent` row (`created`, `started`,
  `completed`, `cancelled`, `note`, ...).
- Tasks are grouped by date on the board and are never hard-deleted.

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

Interface
- Glassmorphism UI driven by design tokens in `src/app/globals.css`;
  shared primitives live in `src/components/ui/`.
- Automatic dark mode: `prefers-color-scheme: dark` overrides the full token set
  (surface, text, borders, shadows, page gradient), not just one or two variables.
- Mobile and tablet: the sidebar becomes an off-canvas drawer with a hamburger,
  skip link, backdrop, Escape/route-change close and scroll lock; wide dashboard
  tables switch to stacked label/value cards below `md`.
- Contrast was measured per token pair; action buttons and accent text use
  700-weight gradients/tints that clear WCAG AA against their surfaces.

---

## Requirements

- Node.js 20+ (22+ recommended), npm 10+
- SQLite 3 (default, zero setup) **or** PostgreSQL 14+
- A Chromium/Chrome binary only if you want PDF instead of HTML export

## Quick start

```bash
npm install
cp .env.example .env           # then set SESSION_SECRET and your password
npm run db:migrate             # prisma migrate dev --schema prisma/schema.sqlite.prisma
npm run dev                    # http://localhost:3000
```

First run without a usable credential is a supported state, not a crash: the
login page shows a setup banner telling you to generate a hash
(`npm run password:hash -- "your-password"`) and set `APP_PASSWORD_HASH`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | next dev (Turbopack) |
| `npm run build` | production build |
| `npm start` | start the built server |
| `npm test` | `lint` + `typecheck` + `vitest run` — the full local gate |
| `npm run lint` | eslint (must be 0 errors **and** 0 warnings) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test:unit` | unit tests only (`tests/integration/**` excluded) |
| `npm run test:integration` | API-route integration tests against a temp SQLite DB |
| `npm run test:coverage` | vitest with v8 coverage + configured thresholds |
| `npm run test:e2e` | Playwright browser matrix (real `next dev`, own port + DB + build cache) |
| `npm run test:e2e:install` | installs the Chromium/WebKit/Firefox engines Playwright needs |
| `npm run bundle:budget` | per-route First Load JS report + budget gate (PF-05) |
| `npm run db:migrate` / `db:migrate:sqlite` / `db:migrate:postgres` | schema apply |
| `npm run db:generate` / `db:generate:sqlite` / `db:generate:postgres` | client generation |
| `npm run db:migrate:sqlite-to-postgres` | data migration helper |
| `npm run db:seed` | demo data |
| `npm run password:hash -- "pw"` | bcrypt (cost 12) hash for `APP_PASSWORD_HASH` |
| `npm run docs:openapi` | regenerate `docs/openapi.yaml` from the zod schemas |
| `npm run docs:openapi:check` | fail if the committed OpenAPI file is stale (CI) |
| `npm run db:parity` | fail if the SQLite and Postgres Prisma schemas drift |

## Configuration

Every variable below is read by the code; there are no NextAuth variables (the
app uses a `jose`-signed cookie of its own).

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `file:./dev.db` | `file:` for SQLite, `postgresql://...` for Postgres |
| `DB_PROVIDER` | inferred | `sqlite` / `postgres`; a provider/URL mismatch aborts startup |
| `DATABASE_URL_SQLITE` | `file:./dev.db` | fallback when `DATABASE_URL` is unset |
| `DATABASE_URL_POSTGRES` | local postgres | fallback when `DATABASE_URL` is unset |
| `PRISMA_SCHEMA_PATH` | unset | hints which schema the generated client came from |
| `SESSION_SECRET` | — | required, >= 16 chars, not a known default; production refuses to boot otherwise |
| `APP_USERNAME` | `admin` | login name |
| `APP_PASSWORD_HASH` | — | preferred credential (bcrypt cost 12) |
| `APP_PASSWORD` | — | development convenience; **hard failure in production** |
| `ALLOW_CLIENT_START_TIME` | unset | set `true` only to trust client-supplied task start times |
| `PUPPETEER_EXECUTABLE_PATH` | auto-detected | Chromium used for PDF export |
| `PORT` / `HOSTNAME` | `3000` / `0.0.0.0` | honoured by `next start` and the standalone server |

## API

All routes are cookie-protected except `POST /api/auth/login`,
`POST /api/auth/logout` and `GET /api/health`. Anything else without a valid
`stl_session` cookie is redirected to `/login` by `src/proxy.ts` (Next 16's
middleware replacement); API calls get a `401` from `requireAuth()`.

| Method + path | Purpose | Notes |
| --- | --- | --- |
| `POST /api/auth/login` | `{username, password}` | sets HttpOnly, SameSite=Lax cookie; rate limited per IP |
| `POST /api/auth/logout` | clears the cookie | |
| `GET /api/health` | liveness/readiness | `{status:"ok"}` or `503 {status:"error"}`; unauthenticated on purpose |
| `GET /api/stats` | dashboard aggregates | includes the `onHold` bucket |
| `GET/POST /api/jobs`, `GET/PATCH /api/jobs/:jobId` | jobs + per-job schedule/break config | |
| `GET/POST /api/projects`, `GET/PATCH /api/projects/:projectId` | projects | archive is a flag, not a delete |
| `GET /api/tasks?projectId=` | board payload | tasks arrive **with** their subtasks |
| `POST /api/tasks` | create | `title`, `description?`, `projectId`, `isBreak?` |
| `PATCH /api/tasks` | transition | `{taskId, action:"complete"\|"cancel"\|"resume"\|"hold"\|"log-notes", details?, notes?}` — no client-controlled time |
| `GET/POST/PATCH/DELETE /api/subtasks` | subtask CRUD | `?taskId=` / `?id=` |
| `GET/POST/PATCH/DELETE /api/breaks` | break config per job | `?jobId=` / `?id=` |
| `POST /api/breaks/log` | record a finished break | `{jobId, projectId?, name, startedAt}`; transactional |
| `GET/POST/PATCH /api/attendance` | check-in/out ledger | `?jobId=` |
| `GET/PATCH /api/settings`, `GET/PATCH /api/profile`, `GET/PATCH /api/report-titles` | single-user settings row | |
| `GET /api/export` | report download | `?timePeriod=day\|week\|month\|range&groupBy=date\|job\|project&startDate&endDate&jobIds=1,2&projectIds=3&reportTitle=` — PDF, HTML fallback, `429` while another export runs |

The old `POST /api/export` JSON contract documented here previously did not
exist; the machine-readable contract is **[`docs/openapi.yaml`](docs/openapi.yaml)** —
17 paths / 35 operations, whose request schemas are generated straight from the
zod schemas in `src/lib/validators.ts` (`npm run docs:openapi`, freshness checked
by `npm run docs:openapi:check`). Point an OpenAPI viewer or MCP bridge at that
file instead of guessing payloads from this table.

## Architecture

```
src/
  app/                 routes (pages + API handlers, thin: auth -> validate -> service -> respond)
  components/          client components; ui/ holds the shared primitives
  hooks/               useApiMutation / useKeyedApiMutation, useMediaQuery
  lib/                 domain logic: task-lifecycle, business-time, breaks, validators,
                       auth, session, prisma (dual-provider client), startup-checks, rate-limit
  proxy.ts             cookie gate + login redirect target
prisma/
  schema.sqlite.prisma + migrations/     SQLite (versioned)
  postgres/schema.prisma                 Postgres (parity-checked: npm run db:parity)
scripts/               hash-password, measure-bundle, check-schema-parity,
                       generate-openapi, migrate-sqlite-to-postgres
docs/                  openapi.yaml (generated contract)
tests/                 unit/ (pure lib) and integration/ (route handlers + temp SQLite)
```

Two Prisma schema files exist because Prisma cannot emit one client for two
providers; `npm run db:parity` fails if anything except the provider/datasource
lines drifts.

## AI / agent integration

For an agent working on this repo, the reliable entry points are:

- `AGENTS.md` — the build/test/docker gate that must pass before a commit, and the
  warning that this Next.js version differs from older training data.
- `docs/openapi.yaml` — the request/response contract, generated from the zod
  schemas the routes actually parse with, so it cannot drift silently.
- The invariant scripts, which are the fastest way to know whether a change broke a
  documented rule: `npm run db:parity` (schema duplication), `npm run bundle:budget`
  (code splitting), `npm run docs:openapi:check` (contract freshness).

What is **not** available to an agent or an external integration today: there is no
token-based API access (every non-public route requires the browser session cookie),
no idempotency keys on mutating endpoints, and no machine-readable write API for
bulk import. Those are tracked as `AI-02` and `AI-03` in the audit backlog.

## Security posture (honest)

- One shared credential, bcrypt cost 12, compared with a constant-time bcrypt
  check; login is rate limited per IP and failures are logged as security events.
- Session is a `jose` JWT in an HttpOnly, `SameSite=Lax`, `Secure`-in-production
  cookie carrying `{sub, tv}`; `tv` (token version) is how sessions are revoked
  when the password changes. `SESSION_SECRET` is validated fail-closed at boot.
- CSRF: there is **no** CSRF token. `SameSite=Lax` plus `Content-Security-Policy
  frame-ancestors 'none'` / `X-Frame-Options: DENY` is the current mitigation —
  state-changing requests are same-site and same-origin, and the app cannot be
  framed. This is a documented residual risk, not a claimed feature.
- Rich text is sanitised with DOMPurify on write and on render; link hrefs are
  restricted to `http(s):`, `mailto:` and root-relative paths.
- Security headers (CSP, nosniff, Referrer-Policy, Permissions-Policy, HSTS in
  production) ship from `next.config.ts`; the container runs as a non-root user
  with a `/api/health` HEALTHCHECK.
- Post-login redirects go through `safeRedirectTarget()`, which rejects absolute,
  protocol-relative and backslash tricks.
- Detailed posture (API tokens, rate-limit budgets, idempotency, security events,
  CSRF limits): `docs/security.md`.

## Testing

- `npm test` chains lint + typecheck + vitest, so "green" cannot mean
  "tests pass while lint errors" (TC-04).
- Unit tests cover the pure domain layer (transitions, business-hours arithmetic,
  validators, redirect safety, rich-text extraction, startup checks, sessions).
- Integration tests import the real route handlers and run them against a
  throwaway SQLite file: auth, task state machine and races, break logging
  (including rollback), subtasks, attendance, stats, jobs/projects and export
  filtering.
- `npm run test:coverage` enforces thresholds over `src/lib` and `src/app/api`
  (60% lines/functions/statements, 50% branches) — a ratchet, not a wish.
- `npm run test:e2e` is the browser matrix (RS-04): 3 engines x 3 viewports
  (Chromium/WebKit/Firefox at 375/768/1440px) checking that the shell does not
  scroll horizontally, that navigation is reachable at each size, that the three
  main routes log no page/console errors, and that exporting really hands the
  user a non-empty file in that engine. `tests/e2e/global-setup.ts` owns the app
  process: it builds on its own `distDir` (`.next-e2e`, so it can never serve a
  stale cache to `npm run dev`), migrates and seeds a dedicated
  `e2e-playwright.db` on a dedicated port (3177), reclaims that port from a
  leftover `next` process before wiping the file, and shuts its own server down.
  It is deliberately not Playwright's `webServer` option, because `webServer`
  boots before `globalSetup` and cannot seed first.
- Not covered today: the production Puppeteer->Chromium PDF byte path in CI (the
  matrix asserts the download is non-empty, which is the HTML fallback in dev)
  and pixel-level visual regression baselines.

## Docker and Coolify

```bash
docker build -t gid-task-flow .
docker run --rm -p 3000:3000 -v stl-data:/data gid-task-flow            # SQLite
docker compose up                                       # app + postgres profile
```

- `docker-compose.yml` (dev) and `docker-compose.prod.yml` (production shape:
  restart policy, resource limits, healthchecks) both exist.
- The image is built from `output: "standalone"` output, runs as a non-root user,
  installs Chromium for PDF export, and migrates only when the schema hash
  changes (`docker-entrypoint.sh`).
- Coolify renames containers (`<name>-<suffix>`), so nothing may hardcode a
  service DNS name: the database host comes from `DATABASE_URL` /
  `DB_HOST`-style environment, never from a fixed container name.
- No `DATABASE_URL` is baked into the image: `docker-entrypoint.sh` resolves the
  connection from `DB_PROVIDER` plus `DATABASE_URL` / `DATABASE_URL_SQLITE` /
  `DATABASE_URL_POSTGRES`, so attaching Postgres is a matter of setting
  `DB_PROVIDER=postgres` and `DATABASE_URL_POSTGRES` (or one `DATABASE_URL`).

## Known limitations

- Single shared account: no users, roles, or per-user filtering (a `userId`
  migration is the first step if that ever changes).
- No pagination/search on list endpoints; fine for one operator's data, not for
  years of history.
- Cookie-only auth: automated clients currently have to reuse the human session;
  scoped API tokens are not implemented yet.
- Coverage excludes the browser-dependent PDF step.

## Development workflow

`AGENTS.md` states the definition of done, and CI enforces it:
lint and typecheck clean, all tests green, coverage over threshold,
`npm run build` and `npm run bundle:budget` succeed, the image builds, and the
app is exercised against both SQLite and Postgres.

## License

MIT — see [LICENSE](LICENSE). Release history is in [CHANGELOG.md](CHANGELOG.md).
