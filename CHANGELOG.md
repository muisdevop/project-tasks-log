# Changelog

Notable changes to GID Task Flow, kept by hand in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
format. Versioning follows SemVer.

## [Unreleased]
- Two commands that had never been run against a real database, and the gate that now
  watches both of them (RA-20, PAR-02, PAR-03). (a) `npm run db:migrate:postgres` was
  `prisma migrate deploy --schema prisma/postgres/schema.prisma`; the root
  `prisma.config.ts` pins `migrations.path` to the SQLite directory, so against a live
  Postgres server it loaded `13 migrations found in prisma/migrations` and died with
  `P3019: The datasource provider postgresql specified in your schema does not match the
  one specified in the migration_lock.toml, sqlite` — the documented way to migrate a
  Postgres deployment had never worked, even though `docker-entrypoint.sh` writes its own
  provider-specific config at boot and its comment admits the failure. It now points at a
  committed `prisma/postgres/migrate.config.mjs` (`db:migrate:dev:postgres` had the same
  defect and got the same fix), and running it against a freshly created database applies
  all three Postgres migrations with exit 0. Writing that file measured one more thing:
  Prisma resolves the paths inside a config relative to *the config file's directory*, not
  the cwd — the first attempt looked for `/app/prisma/postgres/prisma/postgres/schema.prisma`.
  (b) The two migration sets seeded different data: `20260327201323_add_job_hierarchy`
  inserts a default `Job` and the Postgres set contained no `INSERT` at all, so a fresh
  Postgres deployment started with an empty board while a fresh SQLite deployment started
  with "Default Job" — identical schema files, different database. Fixed additively with
  `20261010173500_seed_default_job` (`WHERE NOT EXISTS`, so it cannot collide with a job an
  operator made), verified by the fresh deploy above, which now reports
  `default-job | [1, 2, 3, 4, 5] | 09:00 | 17:00`. (c) `prisma/migrations/…add_job_hierarchy/migration.sql:21`
  declares `"workDays" JSONB NOT NULL DEFAULT [1, 2, 3, 4, 5]`: in SQLite a bracketed token
  is an *identifier* quote, so that is not a JSON array default. Measured against
  `better-sqlite3`: the DDL loads, and an insert that omits the column stores the string
  `1, 2, 3, 4, 5` — not valid JSON. The application is not exposed (`src/app/api/jobs/route.ts`
  always supplies `workDays`), and repairing it means rebuilding `Job` — the table three
  others reference — on data that is already shipped, so it is recorded as a tracked
  exception rather than fixed blind here. What is new is `scripts/check-migration-parity.mjs`
  (`npm run db:parity:migrations`, wired into CI next to `db:parity`): `db:parity` compares
  the two *schema files* and could see none of this, so the new check compares the
  *migration sets* — which tables each one seeds, and any constant default written as a
  bracket token, with a shrink-only list for the one already applied. Both rules are proven
  to fail: deleting the new Postgres seed migration produces
  `Job is seeded by the sqlite migration set but not by postgres` (exit 1), and an injected
  `DEFAULT [1, 2, 3]` produces the bracket-token message (exit 1), while the tree as
  committed reports `Migration parity OK: both sets seed the same tables (Job)` (exit 0).
  Prisma's table-rebuild copies (`INSERT INTO "new_Job" … RENAME TO "Job"`) are excluded,
  because they move existing rows rather than seeding data.

The 0.2.0 re-audit kept going until the report was clean, and that second pass
found real defects in the layer nothing had tested yet. Entries below are tagged
with the re-audit ids (RA-xx) recorded in sheet 12 of the audit workbook.

### Added
- React component-level tests (OPEN-01). `vitest.config.ts` now declares two
  projects instead of one environment: `node` for the lib and route-handler
  suite, which keeps running against real Prisma in production `NODE_ENV`, and
  `components`, a jsdom project pinned to `NODE_ENV=development` because
  `React.act` does not exist in a production React build. 44 tests over
  `ModalShell`, the task board and subtask editing
  (`tests/unit/components/`), with `render-helpers.ts` recording every fetch so a
  request body is asserted rather than assumed. Dev dependencies only
  (`jsdom`, `@testing-library/*`); nothing in the shipped bundle changes.
- Automated accessibility gates (RA-07), which the audit could previously only
  record as *not claimed*. `tests/unit/components/accessibility.test.tsx` runs
  axe-core over the rendered components in jsdom and carries a control case that
  asserts the same scan reports `button-name` and `aria-dialog-name` on bad
  markup - a gate that cannot fail is indistinguishable from a gate that never
  ran. `tests/e2e/accessibility.spec.ts` injects the same axe-core into
  Chromium, WebKit and Firefox at 1440px and scans seven routes with
  `color-contrast` and the landmark rules enabled, the two axe cannot judge
  without real pixels and a real document. 21 route x engine scans pass.
  `axe-core` is now a declared devDependency rather than a transitive of
  `eslint-plugin-jsx-a11y`.

- The 3 x 3 Playwright matrix now runs in CI. `.github/workflows/ci.yml` installed
  `@playwright/test` and had a `tests/e2e/` directory, but no job ever executed it, so
  every "128 scenarios green" number in the audit was a single local measurement
  nobody else could repeat. A `Responsive + axe matrix` job now runs
  `npx playwright test` (all nine projects) and uploads the HTML report on failure.
  The re-audit that found this also found the matrix's first local red —
  `[webkit-tablet] /projects` hit Playwright's 90s once and passed in 3s in isolation
  — so `tests/e2e/global-setup.ts` now requests every page route once before the
  tests start. `next dev` compiles a route on its first request, and that compile was
  being billed to whichever browser arrived first; warm-up moves it outside every test
  budget and prints the per-route time, and setup now fails with that number if a
  route ever takes more than 60s to serve cold.
- An engines gate that runs in the runtime it is about. `engines` ranges are now
  checked by `npm ci --include=dev` executed inside the digest-pinned base image,
  because `.npmrc`'s `engine-strict=true` makes an engines violation a hard refusal on
  Node 20 while a Node 24 developer machine only warns — the exact asymmetry that
  made RA-09 invisible locally.

### Fixed
- The Postgres half of `db:backup`/`db:restore` had never been executed (RA-13..RA-19).
  Both scripts stayed green through two audit passes because every test forced
  `pg_dump`/`psql` to be *missing* — so nothing ever looked at the arguments the tools
  actually receive. Running them in Linux against a real database that had rows found
  seven defects: the documented Prisma URL (`…?schema=public`) was handed to libpq whole
  and refused (`pg_dump: error: invalid URI query parameter: "schema"`, exit 3), the
  connection string — password included — travelled on argv where any local process can
  read it from `/proc/<pid>/cmdline` (measured `old-argv-password-hits=2`; the tools now
  get discrete `-h/-p/-U/-d` plus `PGPASSWORD`, and the same probe reads 0), `--force`
  restored onto a non-empty database by dropping and recreating the `public` schema
  *without* the safety copy the SQLite path takes (the pre-fix run left no
  `*-pre-restore` directory; the fixed run's copy contains the mutated live rows,
  `mutated=1`), a `--exclude-tokens` manifest claimed rows the dump deliberately omitted
  (`9 tables, 3 rows` against a payload holding zero of them) and then failed its own
  post-restore check — `ApiToken has 0 rows, snapshot says 2`, exit 4, after the database
  was already gone, the entrypoint's schema-hash marker survived a restore so the next
  boot skipped `migrate deploy` onto the restored file (cleared before anything is
  destroyed now: `MARKER_CLEARED`), the documentation named the Postgres payload
  `backup.sql` while the code writes `database.sql`, and the `*_PATH` overrides were
  collected as secret *values*, so the command redacted the very backup-root path it
  exists to print. Eleven new tests cover the set, with the destructive-call ordering
  pinned by which error surfaces first.
- Three provider-parity defects that made the two shipped databases disagree (PAR-01,
  PAR-05, PAR-07). `docker-entrypoint.sh` gated `prisma generate` behind the schema hash
  even though generate writes into the image's own ephemeral `node_modules`, so a
  container whose `/data` volume still held an old hash booted with a stale generated
  client; it now runs on every boot and only `migrate deploy` is gated. `npm run db:seed`
  built a `PrismaBetterSqlite3` adapter unconditionally, so seeding a Postgres deployment
  died on the URL — the adapter now follows the resolved provider. And the report-title
  PATCH (ST-01) read the settings row with a plain `SELECT` inside its transaction, which
  under PostgreSQL's READ COMMITTED lets two concurrent writers each overwrite the other's
  list: the read now carries `FOR UPDATE` where the provider understands it, and nothing
  on SQLite. Five further parity differences — the default `Job` row only the SQLite
  migrations insert, the unquoted `workDays` JSON default, the one-open-check-in race, the
  NULL-`endedAt` ordering that changes which rows survive the export row cap, and
  collation-dependent text tie-breaks — are recorded as findings PAR-02/03/04/06/08 in the
  re-audit sheet instead of fixed blind: they need new migrations on *both* providers plus
  a locking decision, and editing already-applied migrations is not a remedy.
- SEC-01's accepted-risk rationale was wrong, and the fix it argued against was
  available. The workbook and `docs/security.md` stated that no advisory had a
  non-breaking remedy and that npm's Prisma fix was a downgrade to `prisma@6.19.3`;
  that had been measured with `npm audit fix --force`. Plain `npm audit fix` takes
  `prisma` 7.5.0 → 7.10.0, `puppeteer` 24.40.0 → 24.43.1 and `@tiptap/*`
  3.21.0 → 3.31.4 as same-major upgrades, including `prosemirror-view` 1.42.6 (above
  the paste-XSS fix the old text had rationalised). The runtime tree went from
  31 advisories (9 moderate, 22 high) to 20 (7 moderate, 13 high), and the full tree
  from 43 to 26, with no declared range in `package.json` moving. Taking `prisma@7.10.0`
  needed one override — its newer `@prisma/dev` pulls `@prisma/streams-local`, whose
  engines are `>=22.0.0` in *every* published version, which `engine-strict` refuses
  on the Node 20 image and CI — so `@prisma/dev` is pinned back to the `0.20.0` this
  project already shipped with, with the `hono`/`valibot` leaves it pins raised to
  their patched versions. What still has no non-major remedy is now named per package
  from npm's own `fixAvailable` data instead of inferred.
- `puppeteer@24.43.1` removed `networkidle0` from `page.setContent`'s `waitUntil`
  union; `src/lib/pdf-render.ts` waits for `load` now, which for a document handed
  over whole by `setContent()` already means every referenced resource has finished.
  `npm run typecheck` is what caught it, and the unit test that pins the call was
  updated with it.
- The engines probe now installs where it will not leave debris behind (RA-12). It went
  red on GitHub Actions for a reason that had nothing to do with `engines`: the install
  wrote ~800 packages onto a bind mount as the container's root, so the script's own
  cleanup trap failed as the runner user after `npm ci` had already succeeded. The same
  script failed differently here, because a Git Bash `/tmp` is not the daemon's `/tmp` —
  the bind source resolved inside the VM, the container saw an empty directory, and npm
  reported a misleading "no package-lock.json". The manifests are mounted read-only and
  the install runs in the image's own filesystem now, the host path is normalised first,
  and a `PROBE_INPUT_MISSING` guard names the cause instead of npm's error. Both a
  two-package fixture (installs, cleans up) and a `jsdom@30` fixture (refused with
  `EBADENGINE` on `node v20.19.2 / npm 10.8.2`) were run against it, because a gate that
  cannot fail proves nothing.
- The toolchain now refuses a dependency that cannot run on the shipped Node (RA-09).
  CI caught what this host could not: `jsdom@30` declares `engines.node` as
  `^22.22.2 || ^24.15.0 || >=26.0.0`, so the new component suite died in CI's forked
  worker with `webidl.util.markAsUncloneable is not a function` - npm only *warns*
  about engines by default, and the developer machine ran Node 24. Two changes,
  because pinning jsdom back to `26.1.0` (engines `>=18`) would have fixed today's run
  and left the same trap armed for the next install: `package.json` now declares
  `engines.node` as `^20.19.0 || ^22.12.0 || >=24.0.0`. The floor is `prisma@7`'s own
  `^20.19`; the digest-pinned `node:20-alpine3.20` builder reports `v20.19.2`, one patch
  clear of it, and the README had been stating "no `engines` field exists"
  as if that were acceptable. `.npmrc` sets
  `engine-strict=true` so an incompatible package stops `npm ci` with its name and
  range instead of surfacing three jobs later. The pre-fix Docker build transcript is
  the proof that warnings alone were not enough: it prints 18 `npm warn EBADENGINE
  Unsupported engine` blocks - `jsdom@30.1.2` and eight of its dependencies, once per
  install step - each against `current: { node: 'v20.19.2', npm: '10.8.2' }`, and the
  build still succeeded. A re-sweep of the installed tree at this change finds
  1379 `node_modules/**/package.json` files, 482 of which declare `engines.node`, and
  none of those ranges excludes either `20.19.2` or `24.18.0`.
  `.npmrc` is deliberately not copied into the image, so the release build path is
  unchanged.
- `ModalShell` was not a dialog to assistive technology (RA-01). It rendered a
  plain `div`: no `role`, no `aria-modal`, no name, no Escape, no focus handling,
  so a screen reader announced a task form as unnamed page text and Tab walked
  straight out of the modal into the page behind it. It is now
  `role="dialog"` + `aria-modal="true"` + `aria-labelledby` aimed at the visible
  heading (`PageHeader` gained a `headingId` prop for exactly that), Escape
  closes, focus moves to the first control on open and back to the opener on
  close, and Tab wraps inside the panel. The document `keydown` listener is
  removed on cleanup, which is why the ST-04 timer/listener guard's expected
  listener count moved from 10 to 11.
- Controls that had no accessible name (RA-02). axe reported `select-name` and
  `label` as *critical*: the heading selector in `rich-text-editor.tsx`, the
  report-title selector in `export-page-content.tsx`, the break-type selector in
  `global-break-widget.tsx`, the default-title radios in
  `report-title-options-manager.tsx`, and the three `field-label` fields in
  `breaks-config.tsx` plus the input form in `confirm-dialog.tsx` - each of those
  labels was a sibling with no `for`, which does not name anything. The two
  mechanisms worth recording: neither axe nor Testing Library's role/name queries
  read a `placeholder` as a name, and a `<label>` only names a control through
  `htmlFor`/`id` or by wrapping it. Fixed with `htmlFor` pairs (via `useId` where
  the component is reused), `aria-label` on the selectors and radios, and the
  repo's existing `sr-only` label convention on the board and subtask inputs.
- The check-in and check-out buttons failed their own contrast budget (RA-06).
  White on `bg-green-500` measures **2.21:1** against the 4.5:1 the app's token
  table promises, and the red twin was worse, while `globals.css` already shipped
  `.btn-success` (4.6:1) and `.btn-danger` (5.5:1). `job-attendance.tsx` now uses
  those tokens, so the ratio comes from the documented scale instead of a
  hand-picked colour. Only a real browser can see this class of defect: jsdom has
  no painted pixels, which is why the e2e axe gate exists.
- Failures were displayed but never announced (RA-04). The task board and the
  subtask list rendered their error strings in hand-rolled `div`s, so a rejected
  save - a 409 state-machine conflict, a 503 from a paged search - changed pixels
  and told assistive technology nothing. Both now use the repo's `StatusBanner`,
  which carries `role="alert"` for the error tone.
- The subtask delete button could be focused while invisible (RA-03). It was
  `opacity-0` with only a hover rule restoring it, so keyboard users reached a
  control they could not see and could activate blindly. Added
  `focus-visible:opacity-100`.
- The rich-text surface had no role or name (RA-05). A `contenteditable` div is
  not a textbox to assistive technology unless it says so, and its placeholder is
  a CSS affordance nothing can read; the editor now sets `role="textbox"`,
  `aria-label` from the placeholder and `aria-multiline="true"`.
- The sidebar wordmark was announced twice (RA-02 sweep): the logo `img` carried
  `alt="GID Task Flow"` next to the text "GID Task Flow". It is decorative now
  (`alt=""`), and the link keeps its name from the visible text.
- The app shell no longer forces a horizontal scrollbar at the `md` breakpoint:
  `SidebarLayout`'s `<main>` carried `flex-1` with the CSS default
  `min-width: auto`, so it refused to shrink below the min-content width of the
  drawn page and the seeded dashboard measured 1002px inside a 768px viewport.
  Re-measured with the class removed, the overflow trips WebKit and Firefox at
  768px and not Chromium, whose min-content for this tree fits — the defect is real
  but engine-dependent, which is the argument for a three-engine matrix rather than
  one browser. `min-w-0` fixes it everywhere (RS-01, RS-02).
- The responsive matrix stopped measuring loading skeletons, and its overflow check
  is no longer engine-dependent. The dashboard test asserted no-overflow right after
  the heading appeared, while the stats and reminders were still arriving from
  `/api/*`, so the same layout passed or failed on request timing; it now drains
  in-flight API calls like the other route tests, waits for the stylesheet to be
  provably in effect, names the elements that overflow while their parent fits
  (blaming the deepest leaf had pointed at a PageHeader paragraph that was only a
  symptom), and asserts the shell twice over: its right edge against the viewport,
  and its computed `min-width` against `0px`. The second is the one that catches
  this class of defect on every engine — with `min-w-0` removed, 6 of
  chromium-tablet's 9 responsive tests fail it even though every scroll assertion
  on that engine passes. How the defect above was found: a firefox-tablet failure
  the first pass dismissed as flaky was real, and once the wait was fixed it
  reproduced deterministically.

### Changed
- `/api/export` pipes Chromium's printed document straight to the response instead
  of buffering it: `renderPdfBytes` (`page.pdf()`, one finished buffer) became
  `renderPdfStream` (`page.createPDFStream()`, available since Puppeteer 22 and this
  repository pins 24). The browser is now closed by the stream itself — when the
  body drains, when printing errors, or when the client hangs up mid-download — and
  all three paths are pinned by unit tests, with the integration suite asserting the
  chunks reach the caller unbuffered. This closes the PF-02 residual 0.2.0 left
  open, and corrects the reasoning in the old comment, which claimed no streamable
  PDF API existed. What genuinely stays in memory is the report HTML, because
  `page.setContent()` requires the whole document; that is now stated plainly
  instead of being used to justify the buffer.

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
- `docs/security.md` section 8, "Dependency advisories": the accepted-risk
  posture written down with the actual numbers instead of a hand-wave — 32
  runtime advisories (9 moderate / 23 high), grouped by root cause (Prisma 7
  chain, Puppeteer chain, rich-text chain), each with why npm's own fix is worse
  than the risk, the `--no-sandbox` trade-off, and the fact that SEC-14's
  Chromium pin means CVEs arrive as reviewed maintenance rather than automatic
  patches (SEC-01).
- A non-blocking `Dependency advisory posture (SEC-01)` step in CI, so an
  accepted risk keeps being measured on every run rather than rotting into an
  untracked one.
- `scripts/container-smoke.mjs` (`npm run smoke:container`): the AGENTS.md docker
  gate as code — 28 functional checks (auth refusal and cookie login, task
  lifecycle with server-side timing, `Idempotency-Key` replay, break dedupe,
  stats, `/api/export/data`, a real `%PDF` from the image's own Alpine Chromium
  under `REQUIRE_PDF=1`, token mint/scope/revocation, the hard-delete guard,
  admin event paging, logout) run against the booted container on both providers.
  CI's `smoke` job now executes it instead of the two curl requests it used to
  make, which is what caught AR-06 by hand and could not catch it again. A run
  that hits the login limiter (5 per 5 min per IP, i.e. twice per re-run) aborts
  with the `Retry-After` instead of reporting twenty misleading failures.
  (AR-06, MF-01, PM-04, TC-01)

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
- The CI advisory step measured the same tree twice. The quality job exports
  `NODE_ENV=production`, and `npm audit` hides dev dependencies in that mode, so
  the line labelled "full tree (dev tooling included)" printed the runtime count
  again — a reporting bug in the step whose whole purpose is honest measurement
  (found while regenerating the verification log, SEC-01). It now asks for
  `npm audit --include=dev`, which reports 44 advisories against the runtime
  tree's 32.
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
- `docs/security.md` section 7 listed four gaps that had already been closed —
  idempotency was in fact wired into seven route files, `/api/tokens` and
  `/api/admin/events` are in the generated contract (21 paths), and the
  Bearer-forwarding note no longer matched the routes. A stale "known gap" is
  worse than a gap, because it tells the next reader not to look. The section now
  lists only what is still open, with the one deliberate cookie-only route
  (`/api/auth/logout`) explained rather than apologised for, and each closed item
  is stated as closed and gated. (PM-02, found by re-reading the docs against the
  tree during the 2026-10-09 re-audit.)
- `README.md` contradicted `package.json` in two directions at once: the Scripts
  section said `db:backup` / `db:restore` were "not present" (they exist, added by
  the MF-06 tooling) while its table omitted them, and the Configuration table —
  which claims to list every variable the tree reads, verified by a
  `process.env.` grep — was missing `DB_QUERY_TIMEOUT_MS`, `GID_BACKUP_DIR`,
  `PG_DUMP_PATH` and `PSQL_PATH`. The backup variables are invisible to that grep
  because the scripts read an injected `env` object; the table now says so
  explicitly. `PG_RESTORE_PATH` was *not* added: nothing calls `pg_restore`, so
  the name was dropped from `.env.example` rather than documented as a knob that
  does nothing (PM-03, README claims must be re-verifiable by `grep` at review
  time).
