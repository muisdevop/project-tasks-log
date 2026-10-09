# Changelog

Notable changes to GID Task Flow, kept by hand in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
format. Versioning follows SemVer.

## [Unreleased]

Nothing staged.

## [0.2.0] - 2026-10-09

Audit remediation campaign (93 findings, 2026-10-07 audit workbook). Entries are
tagged with the finding ids they close.

### Added
- `src/lib/task-lifecycle.ts`: one server-authoritative transition machine for
  task status/elapsed time, replacing per-route arithmetic (FL-02..07, SEC-05).
- `src/lib/startup-checks.ts` + `src/instrumentation.ts`: fail-fast validation of
  `SESSION_SECRET` / plaintext `APP_PASSWORD` in production (SEC-03).
- `src/lib/bootstrap.ts`: guarantees the settings row and reports whether login is
  configured at boot instead of returning a blank 500 on first run (BG-05, ST-02).
- `POST /api/breaks/log`: transactional break recording that banks the running task
  first (FL-01, UX-03).
- `src/lib/rate-limit.ts` with per-IP login throttling and `Retry-After` (MF-02).
- Security headers from `next.config.ts`: CSP, nosniff, frame-ancestors,
  Referrer-Policy, Permissions-Policy, HSTS in production (MF-03).
- `src/components/ui/card.tsx` and `src/components/ui/status-banner.tsx`: shared
  Card / SectionCard / SurfaceSection / PageHeader / EmptyState / StatusBanner
  primitives, plus `.btn-*` and `.field-*` component classes and a full light+dark
  design-token set in `globals.css` (UI-03, UI-10, BF-04).
- Off-canvas mobile sidebar with hamburger, skip link, backdrop, Escape and
  route-change close, and a break widget that docks clear of the header on small
  screens (UI-06, RS-01, RS-02).
- Stacked label/value cards as the small-screen rendering of dashboard tables (RS-03).
- `useKeyedApiMutation` alongside `useApiMutation`, so task board, subtasks and
  attendance share one mutation core (UI-04).
- `next/dynamic` code splitting for the TipTap editor and the export builder, plus
  `scripts/measure-bundle.mjs` (`npm run bundle:budget`) reporting and enforcing a
  per-route First Load JS budget (PF-05).
- `scripts/check-schema-parity.mjs` (`npm run db:parity`) failing when the SQLite and
  Postgres Prisma schemas drift (AR-02).
- Coverage tooling (`@vitest/coverage-v8`), `vitest.config.ts` thresholds and
  `test:unit` / `test:integration` / `test:coverage` scripts; `npm test` now chains
  lint + typecheck so a green suite cannot hide lint errors (TC-02, TC-04).
- `src/lib/api-tokens.ts` + `/api/tokens` (AI-02, commit `9a46388`): scoped
  `read`/`write` bearer tokens formatted `gid_<40 hex>`, stored only as a SHA-256
  digest with `expiresAt` / `revokedAt` / `lastUsedAt`, individually revocable, and
  minted/listed/revoked through a cookie-only route so a token can never mint a
  token. `ApiToken` migrations exist for both providers.
- `src/lib/idempotency.ts` (AI-03): `Idempotency-Key` replay semantics
  (replay / 409 on body mismatch / 400 on malformed key / 425 while in flight),
  wired into `POST /api/tokens` today with a 5-minute window.
- `src/lib/security-events.ts` (MF-02): one redacted JSON line per security event
  to stderr — `login.failed`, `login.rate_limited`, `token.rejected|revoked|expired|
  rate_limited|created|revoked_by_operator|mint_denied`, `idempotency.conflict`.
- Rate-limit buckets beyond human login (AI-03): per-token `api` 120/min,
  `tokens-mint` 10/5min, `tokens-list` 60/min, `anonymous` 30/min, plus a
  per-IP rejected-bearer lock (30/5min) in `src/lib/auth.ts` so brute force stops
  costing database lookups.
- Opt-in keyset pagination and substring search on the list routes
  (`GET /api/tasks`, `/api/jobs`, `/api/projects`: `limit` 1..200 default 50,
  opaque `cursor`, `q`, plus `status`/`jobId` filters; `nextCursor` appears only
  when pagination is requested) — byte-compatible with the old payloads otherwise (MF-05).
- Stats aggregation memoised per process (`src/lib/stats-cache.ts`), and the
  `/api/export` handler split into `src/lib/export-data.ts`, `export-html.ts`,
  `export-html-styles.ts` and `pdf-render.ts` so the route holds only transport
  concerns (AR-01, PF-03).
- `docs/security.md`: credential resolution order, token lifecycle, CSRF posture
  and residual risks, rate-limit budgets, idempotency rules, event redaction.
- `docs/architecture.md`: module map, data model, invariants, and **ADR-001
  "the product is single-user by design"** recording the MF-07 decision instead
  of only disclaiming it.
- `docs/CONTRIBUTING.md`: gates, branch/PR and WIP-visibility workflow,
  semver + annotated-tag release procedure, documentation duties, repository
  hygiene findings.
- `.gitattributes`: `* text=auto eol=lf` plus binary overrides, so a Windows
  checkout stops reporting phantom line-ending churn.
- `LICENSE` (MIT) and this `CHANGELOG.md` (PM-02).
- `.gitignore` entries for archives and scratch files, so a repository snapshot
  can never be committed by accident (`*.zip`, `*.tar.gz`, `.tmp-*`).
  PM-01 note: `project-tasks-log.zip` was untracked and never committed
  (`git log --all --diff-filter=A -- project-tasks-log.zip` is empty), and the
  operator has now deleted it — it held a `dev.db` snapshot with real
  client/project/task names.

### Changed
- Elapsed time, task start times and completion outputs are computed from server
  data; client-supplied timing is ignored unless `ALLOW_CLIENT_START_TIME=true` (SEC-05).
- Subtasks are returned with the task payload instead of one request per expanded task (PF-06).
- Sessions carry a token version and are invalidated on password change (SEC-06).
- Rich text is sanitised on write and on render, with a plain-text extractor for
  empty-content suppression (SEC-08, UX-02).
- Post-login redirects are validated against open-redirect tricks, and the proxy now
  preserves the requested path in `?next=` (UX-05, BG-04).
- Prisma provider inference fails fast on a `DB_PROVIDER` / `DATABASE_URL` mismatch (ST-03).
- bcrypt cost aligned to 12 across `scripts/hash-password.ts` and runtime hashing (SEC-10).
- README rewritten to describe the implementation rather than aspirational claims:
  real env vars (`SESSION_SECRET`, not `NEXTAUTH_SECRET`), the actual
  `GET /api/export` contract, real npm scripts, honest dark-mode / responsive /
  security posture, and a Known limitations section (BF-01, PM-03, BF-04).
- Nine unused `@tiptap/*` extension packages removed; `@tiptap/extension-link`,
  which the editor imports, is now declared explicitly.
- Reports read one clock: `src/lib/business-time.ts` (`startOfLocalDay`,
  `endOfLocalDay`, `localDayKey`, `parseLocalDayStart`, `localDayWindow`) is the only
  place a day boundary is computed, so the export window, the attendance day bounds and
  the day-group key are the same value. The old UTC `T00:00:00Z`/`T23:59:59.999Z`
  round-trip that shifted a non-UTC day by hours is gone, and
  `tests/unit/export-timezone.test.ts` proves the equivalence under UTC, Asia/Jakarta
  and America/Los_Angeles (FL-07).
- `/api/export` is now bounded and streamed: `MAX_EXPORT_ROWS = 5_000` (queried as
  `take: MAX+1`, answered with a clear 400 telling the caller to narrow the window) and
  the HTML fallback is emitted as a `ReadableStream` through `reportHtmlChunks` /
  `htmlStreamFromChunks`, byte-identical to the previous single string (PF-02).
- Export row types are derived from the Prisma selects with `satisfies`
  (`EXPORT_TASK_FIELDS`, `EXPORT_PROJECT_FIELDS`, `EXPORT_JOB_FIELDS`,
  `EXPORT_SUBTASK_FIELDS`, `FieldProvenance`), so a renamed column breaks the
  typecheck instead of silently blanking a report column (AR-05).
- `src/lib/prisma.ts` refuses to guess: the provider is resolved from
  `PRISMA_SCHEMA_PATH` -> `DB_PROVIDER` -> `DATABASE_URL` scheme and any contradiction
  throws before an adapter is constructed, with a message that quotes `file:` URLs but
  never a password, user or host (ST-03).
- Nested agent scratch directories are excluded from git, ESLint and typecheck
  (`.gitignore /.qoder/`, `eslint.config.mjs` globalIgnores), so a stale worktree copy
  can no longer be linted, built or committed by accident.
- `vitest.config.ts` gives the bcrypt suites real headroom (`testTimeout: 15_000`,
  `hookTimeout: 60_000`) instead of cheapening the hashing: `bcryptjs` is pure JS at
  cost 12 and a rate-limit test performs up to six of those comparisons while every
  test file runs in a parallel worker.

- `.env.example` is now tracked (`!.env.example` in `.gitignore`) and completed: it
  documents `DB_PROVIDER`, `DATABASE_URL_SQLITE` / `DATABASE_URL_POSTGRES`,
  `PRISMA_SCHEMA_PATH`, `DB_QUERY_TIMEOUT_MS` and the backup CLI paths, and its
  `APP_PASSWORD` is empty instead of a demo password - a template that ships a usable
  credential is the same forgeable default the audit removed from `docker-compose.yml`
  (PM-01, AI-01: a fresh clone can now `cp .env.example .env`).

### Fixed
- Board/queue rendering, dialog focus handling, form validation, empty/error states
  and duplicate element ids across the task board, job pages and settings (BG-01,
  BG-02, UI-01, UI-02, UI-05, UI-07, UI-09, UX-01, UX-04, UX-07, UX-08).
- `on_hold` was missing from the stats buckets, so the dashboard disagreed with the
  board (UX-08).
- PDF export inside the container. The AGENTS.md docker gate found that Alpine
  Chromium has no usable GPU/EGL in the image and only 64 MB of `/dev/shm`, so
  `page.setContent` died with `ProtocolError: Network.enable timed out` and every
  containerised export silently degraded to the HTML fallback.
  `buildPuppeteerLaunchOptions` now always passes `--disable-gpu` and
  `--disable-dev-shm-usage` next to the sandbox flags, pinned by
  `tests/unit/export-pdf-render.test.ts` and `tests/integration/export.test.ts` (AR-06).
- Duplicate break records: `POST /api/breaks/log` derives a deterministic
  idempotency key and answers a replay with `Break-Deduplicated: true` instead of
  inserting a second row (FL-01).
- `docker-compose.yml` was unparseable YAML. Removing the forgeable demo secrets
  put `${VAR:?message with ": " inside}` into an unquoted scalar, which is a
  mapping-error, so `docker compose config`/`up` failed on the dev file - and it
  had failed for the whole campaign because nothing parsed it. The values are now
  quoted and CI runs `docker compose config -q` against both files plus asserts
  the required-secret guard still refuses an empty environment (AR-08).
- The CI pipeline could not have passed, and only failed once it actually ran.
  The quality job sets `NODE_ENV: production`, so `npm ci` skipped every
  devDependency - `tsx`, `vitest`, `eslint`, `typescript`, `@playwright/test`,
  `tailwindcss` - and `npm run docs:openapi:check` died with `sh: 1: tsx: not found`
  (MF-01). Install is now `npm ci --include=dev`, so a production `NODE_ENV` cannot
  hollow out the toolchain again.
- `src/lib/prisma.ts` rebuilt the database client on every property access in
  production. The lazy `Proxy` memoised only on `globalThis`, and `globalThis` is
  deliberately populated outside production, so with `NODE_ENV=production`
  `resolveClient()` found no cache each time: every `prisma.*` call constructed a new
  `PrismaClient` plus a new driver adapter and connection pool, none of them ever
  disconnected. The client is now also memoised in module scope, and
  `tests/unit/prisma-provider-mismatch.test.ts` counts adapter constructions under
  production to keep it that way (ST-03 / PF-01; found by running the suite under
  CI's environment rather than a developer's).
- Two tests encoded host-environment assumptions instead of behaviour: one pinned the
  literal `"0.1.0"` from `package.json` (it broke on the 0.2.0 bump) and one read
  `globalThis.prisma`, which production does not set. Both now assert against the
  source of truth, and nothing in the suite may hardcode a version string.
