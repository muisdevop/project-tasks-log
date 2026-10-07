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
- `LICENSE` (MIT) and this `CHANGELOG.md` (PM-02).
- `.gitignore` entries for archives and scratch files; `project-tasks-log.zip` is no
  longer in the repository's future (PM-01).

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
