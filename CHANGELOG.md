# Changelog

Notable changes to GID Task Flow, kept by hand in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
format. Versioning follows SemVer; the package version is still `0.1.0` because
this is the first release-tracked build.

## Unreleased

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
  PM-01 note: `project-tasks-log.zip` is untracked and ignored, and it was never
  committed (`git log --all --diff-filter=A -- project-tasks-log.zip` is empty),
  but it still sits on disk at the repo root — it holds a `dev.db` snapshot with
  real client/project/task names, so delete it rather than leave it to rot.

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

### Fixed
- Board/queue rendering, dialog focus handling, form validation, empty/error states
  and duplicate element ids across the task board, job pages and settings (BG-01,
  BG-02, UI-01, UI-02, UI-05, UI-07, UI-09, UX-01, UX-04, UX-07, UX-08).
- `on_hold` was missing from the stats buckets, so the dashboard disagreed with the
  board (UX-08).
