# Changelog

Notable changes to GID Task Flow, kept by hand in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
format. Versioning follows SemVer.

## [Unreleased]
- **RA-38: the register was re-derived from commits, so re-reading it against the files found
  five false citations and ten stale sentences.** A `Fixed` row is a claim about code, and
  RA-36's prose-only re-derivation had not checked a single citation. The consequential one:
  `RA-20` recorded that `scripts/check-migration-parity.mjs` is the guard keeping the operator's
  committed Postgres migrate config and the container's boot-config equivalent — it is not, that
  script compares the two migration *sets* and never reads either config, so what had been logged
  as "accepted design, parallel by construction" was an unguarded divergence. Fixed with code
  rather than wording: **rule F** of `npm run db:parity:migrations` resolves
  `prisma/postgres/migrate.config.mjs` relative to its own directory, reads the postgres branch of
  `docker-entrypoint.sh`, and fails when the two resolve to different schema or migrations paths,
  when the generated config stops being built from `$SCHEMA_REL`/`$MIGRATIONS_REL`, or when
  `db:migrate:postgres` stops passing `--config` — because a guard over a file nothing loads reads
  like coverage. Control measured: retargeting the operator config at `other.prisma` exits 1
  naming the mismatch; the shipped tree exits 0. The other four were mis-attributed mechanisms —
  `PAR-09` credited `prisma migrate deploy` to the postgres service container's entrypoint when it
  is the app container's (`docker-entrypoint.sh:80`), and described rule E as catching
  provider-specific branches when it requires a backfill above the `CREATE UNIQUE INDEX`
  (`check-migration-parity.mjs:121,329`); `RA-20` conflated the config's `/app`-vs-`/tmp`
  writability fallback (lines 40-45) with the schema marker's `/data`-vs-`/tmp` (60-63); `RA-10`
  cited `Dockerfile:13-16` for a sentence on 17. The stale numbers were the predictable half:
  `SEC-01`/`TC-01`/`RA-11` quoted 61 files / 843 tests and 128 selected, `PM-04` quoted 13/2
  migrations and 27/27 checks, `TC-01` quoted coverage digits the fresh run does not produce
  (measured 96.64 / 90.65 / 96.54 / 97.21), `TC-04` described `npm test` from before RA-28/RA-37
  changed it, and `RA-32` asserted that no test had ever applied a data migration in the same
  sentence citing the test that does. One thing deliberately not overwritten: `PM-04`'s 13 and 2
  is true of the run it recorded, so it now reads "13 and 2 at that run; 16 and 5 at f5a19f5" — a
  register that edits its own history cannot be audited.
- **The seventh re-audit pass turned six recorded gaps into measured ones.** It started by
  re-reading rows already marked `Fixed` whose own `gap` field still described an open defect,
  and it ends with none of them in that state.
  - **RA-30 — a CI step label that quietly stopped matching the step.** `ci.yml` announced
    "Matrix (128 scenarios, axe on the 3 desktop engines)" while the run selected 155 and axe
    had been scanning all three viewports since RA-27. A label nobody re-derives is a claim
    that decays: it had already been wrong for two pushes. The step is now named for what it
    asserts (`3 engines x 3 viewports, axe included`) with a comment saying why no scenario
    count belongs there — `playwright.config.ts` owns the number, and the uploaded report is
    the measurement.
  - **RA-31 — an evidence sentence describing a failure the transcript does not show.** The
    RA-27 control was recorded as "makes the mobile walk report the leaked stops". Re-running
    the control (`invisible` → `opacity-0`) fails one assertion earlier: at 375px the drawer is
    reported *visible*, so `expect(nav).toBeHidden()` at `tests/e2e/accessibility.spec.ts:217`
    stops the test before the tab-count line at 220. The control still does its job — the guard
    catches the deleted class — but a report that names the wrong line is the beginning of an
    untrustworthy audit, so the changelog and both registers now quote what was observed.
  - **RA-32 — legacy negative seconds were clamped on read, and read wrong.** FL-D fixed the
    reads and FL-08 stopped new negatives, but `GET /api/stats` sums `elapsedSeconds` with a
    Prisma `_sum` the *database* computes, so no JS clamp is in that path: a stored `-12` kept
    subtracting from a project total. Measured in `tests/integration/negative-seconds-repair.test.ts`
    before the repair — a project holding 600 + 300 of work reported **888**. Migration
    `20261011150000_clamp_negative_seconds` repairs the rows (`Task.elapsedSeconds`,
    `JobAttendance.totalWorkSeconds`) with one statement that is valid on both engines, and the
    test applies the shipped file to prove the aggregate then reads **900**, that no negative
    row survives, and that a second application changes nothing. Because the harness builds its
    schema with `db push`, no other test exercises a data migration, so the same file is also
    checked for byte-identity across the two provider sets. One subtlety the test had to learn:
    a migration does not move `updatedAt`, so the stats watermark is unchanged and `/api/stats`
    serves the pre-repair total for the whole TTL — invalidation, not the clamp, is what makes
    the repair visible.
  - **RA-33 — the projection FL-C changed had no test at all.** `tests/integration/task-list-elapsed-projection.test.ts`
    now pins it through the real route handler: a completed row banked `0` lists `0` even though
    its timestamps span three hours, a held-then-cancelled row lists the 45 seconds the engine
    banked and not the fifteen hours between its stamps, and a legacy `-12` lists `0`. A running
    row is left to the engine's own rule, which the test documents rather than duplicates.
  - **RA-34 — README stated a rule the engine deliberately breaks.** "Every task records real
    worked time against the job's business hours" reads as an absolute, while
    `applyTaskTransition` banks wall-clock time for a segment that holds zero business seconds —
    intentional, and pinned since the first pass by `tests/task-lifecycle.test.ts` ("uses
    wall-clock elapsed when business-time increment is zero", 21:00→23:00 = 7200 under a
    09:00–17:00 day). Nothing in the engine said so, which is exactly how a deliberate rule gets
    "fixed" into a regression. The branch now carries its reason and its test name, and README
    states the exception beside the rule.
  - **RA-35 — FL-H was fixed and untested at the boundary it exists for.** `validateBreakWindow`
    is module-private, and `breaks.test.ts` only ever probed one hour ahead — far outside the
    two-minute tolerance where the defect lived. The new case logs breaks whose clock is 90
    seconds *behind* and 90 seconds *ahead*, requires both to be written (201), and requires the
    stored row to hold non-negative seconds with no `endedAt` before its `startedAt`; the
    forward-skew row must read `Break duration: 00:00:00`. The control was measured, and it had
    to be the faithful one: removing only the `Math.max(0, …)` floor left the test green, because
    the current bound no longer tests for negatives — restoring the pre-fix
    `wallClockSeconds < 0 ||` rejection is what makes it fail, at **`offset 90000ms: expected 400
    to be 201`**. That is FL-H's original symptom (a just-started break answered "too old to
    log") seen from the other side, and it is why a control that passes is information, not a
    nuisance.
  - **RA-36 — eleven findings were marked `Fixed` while their own `gap` sentence still described
    the defect.** The register carries a residual column, and closing a finding in code does not
    close it in that column: after `998e60d` repaired PAR-03/04/06/08 and later passes moved CI to
    Node 22, put axe on every viewport and moved stale-image protection into
    `scripts/check-image-loaded.mjs`, eleven rows still asserted the pre-fix world ("the axe spec
    scans desktop viewports only", "the shipped column default is still wrong", "CI on Node 20
    remains the layer that catches behaviour", "this needs two new migrations"). A reader of the
    workbook — the deliverable — would have found a `Fixed` status arguing with its own evidence
    line. Every non-empty gap was re-checked against the current tree this pass, the stale ones
    were re-derived with the file:line that closes them (partial unique index in both migration
    sets, `export-data.ts:340` null placement, `breaks/route.ts:51` id tie-break, `ci.yml`
    `node-version: "22"`), and the ones that are genuinely accepted trade-offs were kept and
    stated as decisions rather than as unfinished work: `prisma generate` on every boot (PAR-01),
    unlocked `UserSettings` reads outside the route (PAR-05), `PGPASSWORD` visible in the child's
    environment (RA-15), the conservative clock floor that can drop worked seconds (FL-08), and the
    safety copy that cannot be taken from an unreachable target (RA-13).
  - **RA-37 — the lint row in the previous report claimed a clean tree, and its own transcript
    said otherwise.** The pass-6 gate entry read "Zero errors and zero warnings across src/, tests/
    and scripts/ at dc8fd49"; the transcript it was written from
    (`C:/tmp/gate-pass10-test.txt:35`) contains `tests/e2e/accessibility.spec.ts:213:11 warning
    'toggle' is assigned a value but never used` and `✖ 1 problem (0 errors, 1 warning)` — an
    unused locator this campaign's own RA-27 edit introduced. The chain stayed green because
    `eslint` exits 0 on warnings, so the number in the report was neither measured nor
    measurable. Two changes: the dead locator is gone, and `npm run lint` is now
    `eslint --max-warnings=0`, so a warning fails the gate locally and in CI instead of becoming a
    sentence someone has to re-check by hand. Same class as RA-31 and RA-24 — an evidence claim
    the artefact does not support.
  - **RA-11 stopped being a one-sided guard.** CI retries a failed spec once and local runs do not
    retry at all, which is correct for signal but leaves no way to reproduce a suspected flake
    where it was seen. `npm run test:e2e:repeat` now runs the matrix five times over
    (`--repeat-each=5`, proven against `tests/e2e/accessibility.spec.ts`), `playwright.config.ts`
    says so beside the `retries` line, and README and CONTRIBUTING list the command.
- **RA-27 stopped being a recorded gap, and the scan it replaced found a real violation
  (RA-29).** The axe browser gate had skipped every viewport below 1440px on the argument
  that contrast belongs to the design tokens rather than the viewport. That is true of the
  tokens and false of the page: below `md` the shell is different DOM — a fixed header with a
  disclosure trigger, an off-canvas drawer, an overlay — and none of it had ever been audited,
  which is also what made the closed drawer's tabbability an assumption rather than a test
  (RA-08's fix rests entirely on `invisible` doing the work `aria-hidden` used to claim). The
  skip is gone: seven routes are scanned at 375, 768 and 1440, the open drawer gets its own
  scan, and two tests walk the tab sequence — a closed drawer must leak zero stops into
  `#app-sidebar`, a docked sidebar must be reachable, Enter opens and Escape returns focus to
  the trigger. The control ran: swapping `invisible` for `opacity-0` in the sidebar class
  string makes the mobile walk fail — at 375px the drawer is then reported *visible*, so the
  assertion before the tab-count stops the test — *and* makes
  `tests/unit/components/sidebar-shell-a11y.test.tsx` fail on the missing CSS terms, so the
  class is now guarded twice. Scanning the never-scanned row paid for itself on the first run:
  `scrollable-region-focusable` (serious) on the dashboard's project table at chromium-tablet —
  768px is the narrowest case the desktop-shaped tables ever render (`md` turns them on while
  the docked sidebar takes 256px, so a 620px table sits in a 512px column) and every cell in
  that wrapper is text, so it scrolled with no keyboard access at all. Both `overflow-x-auto
  md:block` wrappers in `src/components/dashboard-stats.tsx` are now `role="region"`, named,
  and focusable.
- **RA-28: the local gate and CI's gate were not the same gate, and CI was right.** Push run
  38157949879 and PR run 38157952716 failed `OpenAPI document matches the routes` at `fa7571f`
  while the same tree passed 843 tests, lint, typecheck, build and the container smoke locally.
  The cause was measured rather than guessed: that commit's advisory work moved `zod` 4.3.6 →
  4.6.5, zod renders its `datetime()` and `email()` patterns differently, and `docs/openapi.yaml`
  — generated from the zod schemas — went stale with no test touching it. CI ran the check; `npm
  test` did not, so "green locally" had a hole in it. `npm test` now opens with the Prisma-client
  precheck, `db:parity`, `db:parity:migrations` and `docs:openapi:check` (about two seconds), which
  is the general rule this campaign keeps re-learning: a check that only CI runs is a check that
  reports the damage after the push. README's "There is no axe/pa11y CI job" and its `npm test`
  descriptions were stale in the same way and now describe the chain that exists.
- **The fifth re-audit pass found four more defects in this pass's own work, and disproved two
  of the things it had been told.** Reviewing the newest code rather than the newest commit
  produced FL-C, FL-D, RA-23, RA-25 and RA-26 — plus two claims that did not survive checking,
  recorded here because a clean audit is a measured thing, not an asserted one.
  - **FL-C — the list projection invented work time for a held-then-cancelled task.** When a
    terminal row banked `elapsedSeconds: 0`, `GET /api/tasks` fell back to measuring the wall
    clock between `startedAt` and `endedAt`. That was written for rows predating server-side
    banking, and it stayed plausible until FL-08's hold branch began moving `startedAt` to the
    hold checkpoint: a task held for three hours and cancelled without ever working then
    displayed three hours, and a row whose hold crossed the work-day boundary displayed
    `totalElapsedSeconds` of 54000 (fifteen hours) for zero recorded work. `Math.max(0, …)`
    cannot catch this because the number is positive. The fallback is gone — a terminal row
    shows exactly what the engine banked, floored at zero — because every write path has gone
    through `applyTaskTransition` since FL-02/03/05, so the banked column *is* the record, and
    "no work was recorded" is the honest display for a zero. Pinned by
    `tests/unit/terminal-elapsed-invention.test.ts`.
  - **FL-D — the report could read a legacy negative and print it as time.** `formatDuration`
    rendered `-12` as `-1:-1:-12` (measured), and `computeTaskTotals` summed raw values, so a
    set of rows displaying 600 + 0 + 300 totalled 888 — a total smaller than its own rows.
    Both now clamp at the read boundary; the control case is in the same new test file, which
    fails against the previous implementations.
  - **RA-23 — the RA-21 image gate failed a build that had actually succeeded.** It compared the
    tag's `Created` timestamp against the script's start, but a fully-cached build reuses the
    cached config, timestamp included. Measured: `npm run docker:build -- gid-task-flow:pass7-cache`
    exported, loaded and unpacked the tag in 0.2s and then exited 1 with
    `IMAGE_STALE … created at 2026-10-11T15:51:13Z`. A gate that produces false failures gets
    bypassed, which is the very defect RA-21 was raised for. The check is now identity-based:
    buildx writes a metadata file with the digests of the image it produced, and
    `scripts/check-image-loaded.mjs` requires the tag in the local store to carry one of them —
    true for a warm build and a cold one, false for a build that never landed. It accepts both
    the config digest and the descriptor digest because with provenance/SBOM attestations
    `docker image inspect .Id` reports the *manifest list*, not the config. Re-measured: the
    same cached rebuild now prints `IMAGE_LOADED` and exits 0, and three controls fail exactly
    as they must — mismatched digests `IMAGE_STALE` (1), unknown tag `IMAGE_MISSING` (2), absent
    metadata `IMAGE_UNVERIFIABLE` (3). The BSD `date -j -f` branch the same review flagged as
    broken is gone with the timestamp logic.
  - **RA-25 / RA-26 — the Prisma precheck was checking less than it claimed.** It read only the
    datasource provider, so a client generated from an older `prisma/schema.sqlite.prisma`
    passed and failed later at query time (a 500 from an API route, not a test failure); and
    `npm run db:generate:postgres` still clobbered the SQLite client with no notice. The check
    now also compares the generated schema text with the source it should have come from —
    normalising Prisma's reformatting and dropped comments, measured identical on the current
    tree — and `db:generate:postgres` prints `CLIENT_CLOBBER_NOTICE` first (`--expect=` makes
    the check usable in the other direction for the Postgres dev server). Controls run: an
    injected extra model in the generated schema → exit 1, restored → 0, notice → 0, postgres
    client on disk → 1, regenerate → 0.
  - **Checked and disproved:** *the auto-hold path crashes because its projection has no
    `startedAt`* — all four engine call sites (`tasks/route.ts:318/456/477`,
    `breaks/log/route.ts:192/210`) select or construct `startedAt`, the column is a non-nullable
    `DateTime` in both schemas, and `typecheck` is clean. *A shipped migration had been edited
    in place* — that migration was **added** by `998e60d` and is absent from the `v0.2.0` tree,
    so no database has ever recorded its checksum; reverting it would have restored the
    copy-and-swap form the previous pass measured deleting four tables under
    `foreign_keys=ON` inside a transaction. The file's own immutability note is corrected to
    state that provenance instead. *`.env.local` leaks credentials into the test run* — no
    `.env.local` exists in this repo, `.dockerignore` excludes `.env` and `.env.*`, the
    Dockerfile has no `COPY . .`, and the harness sets its own `DATABASE_URL` rather than
    inheriting one.
- **RA-21 and RA-22: two process defects that cost this pass real time are now gates, not
  reminders.** Both were things the docs already told you to be careful about, which is the
  proof that a warning is not a control.
  - **RA-21 (`scripts/docker-build.sh`, `npm run docker:build`).** This host builds with the
    docker-container/buildx driver, where `docker build -t …` exits 0 and writes only to the
    build cache: measured on 2026-10-11, the build reported success and `docker images` had
    never heard of the tag, so the container the gate then booted was an image from before the
    fix and its green belonged to old code. The script passes `--load` and then requires the tag
    to exist *and* to have been created after the script started — an existing-but-old tag is
    the same false green, so both halves are needed. Its controls were run, not assumed: with
    the build line skipped, an existing `pass7` tag fails with
    `IMAGE_STALE: … created at 2026-10-11T15:51:13Z, before this build started` (exit 1) and an
    unknown tag fails with `IMAGE_MISSING` (exit 1); the unparseable-timestamp case exits 1 as
    `IMAGE_UNVERIFIABLE` rather than comparing as zero. The real build on the final tree printed
    `IMAGE_OK gid-task-flow:pass7` and exited 0.
  - **RA-22 (`scripts/check-prisma-client.mjs`, `npm run db:client:check`).** Both Prisma
    schemas emit into the same `node_modules/.prisma/client`, so generating the Postgres client
    silently replaces the SQLite one the integration harness needs — and the suite then fails
    with an adapter/provider error that reads like a broken test. `npm test` and
    `npm test:integration` now open with a check that reads the `provider` out of the generated
    `schema.prisma`. Measured: clean state → `PRISMA_CLIENT_OK … targets sqlite` (0); after
    `npm run db:generate:postgres` → `PRISMA_CLIENT_CHECK_FAILED … Fix: npm run db:generate` (1);
    after `npm run db:generate` → back to 0. A missing client is exit 2 with the same remedy, so
    the check cannot pass on an absent artefact. CI is unaffected by construction: its quality
    job runs `npx vitest run` with its own pinned generate step, not `npm test`.
- **RA-08 stopped being an accepted risk and was fixed.** It had been recorded as the one
  re-audit finding carried as Risk accepted: the SSR shell ships the sidebar with
  `aria-hidden="true"` because `useMediaQuery` cannot know the viewport on the server, so the
  axe gate had to wait for hydration before scanning. The fix was already in the file and
  nobody had noticed — the class string carries the breakpoint in pure CSS
  (`invisible … md:visible … md:translate-x-0`), and `visibility: hidden` already removes a
  subtree from both the accessibility tree and the tab sequence. A media query is the one
  thing a server render can get right without JavaScript, so the viewport-derived attribute
  was redundant *and* the only part that could be wrong: a screen reader parsing the markup
  before hydration was told the navigation does not exist. `aria-hidden` and the now-unused
  `isDesktop` prop are gone from `Sidebar`; `tests/unit/components/sidebar-shell-a11y.test.tsx`
  renders the layout with `useMediaQuery` mocked to the server's answer (it fails against the
  old markup, which is how it was written first) and asserts both that the shell makes no such
  claim and that the CSS terms which replace it are present.
- **FL-08 (found by this pass's own docker gate): the task engine believed a clock that ran
  backwards.** The dual-provider boot on the new base failed one smoke check on SQLite and
  passed it on Postgres — `PATCH complete` banked `elapsedSeconds: -12`. It was not a provider
  defect: the Docker VM corrected its clock between two requests, and `now` in
  `src/app/api/tasks/route.ts:451` is that request clock, so `applyTaskTransition` happily
  computed `workingTimeDiffSeconds(startedAt, now)` (0, because its own `endedAt <= startedAt`
  guard fired), hit the `computed === 0` wall-clock fallback, and stored the negative — with an
  `endedAt` earlier than the row's `startedAt`. A reproduced probe against the live container
  showed `startedAt 14:36:20.577Z / endedAt 14:36:11.921Z`, and `date -u` in the same container
  was in step with the host minutes later: transient, and therefore exactly the kind of input a
  time-keeping product must not trust. `/api/attendance` already clamps (`secondsBetween` is
  `Math.max(0, …)`); the task side now does too — a transition instant is floored at the
  segment's own `startedAt`, which also stops a hold checkpoint from sliding backwards and
  re-counting the segment it had already banked, and banked seconds are never negative. The
  list projection in `GET /api/tasks` clamps what it displays, so a row written before this fix
  cannot show negative work time. Four tests in `tests/task-lifecycle.test.ts` pin it,
  including the resume-after-step-back case whose absence would report 9000s instead of 7200s,
  and the smoke check now asserts `endedAt >= startedAt` as well as `elapsed >= 0` — the ordering
  is what a task already holding banked time would otherwise hide.
- **SEC-01's runtime tree is now empty.** The previous pass reported 20 advisories against
  `--omit=dev` and recorded the rest as needing semver-majors that were "scheduled upgrade
  work". The majors were taken. Four `overrides` were needed because the flagged leaves are
  each pinned to an **exact** version by their parent — `chevrotain`→`lodash@4.17.21`,
  `@prisma/config`→`deepmerge-ts@7.1.5`, `prisma`→`mysql2@3.15.3`,
  `@tailwindcss/typography`→`postcss-selector-parser@6.0.10` — so `npm audit fix` could not
  move any of them, and the top-level `lodash@4.18.1` the earlier pass had installed was a
  *second* copy rather than a fix (measured: after overriding, no nested copies remain).
  Then `puppeteer` went 24.43.1 → **25.13.0**, which is the change the advisory chain
  actually required: `@puppeteer/browsers@3.2.4` depends on neither `extract-zip` nor
  `proxy-agent` any more (`node_modules/extract-zip` is now absent, not newer), clearing the
  last 8 runtime Highs. Puppeteer is a runtime dependency — `src/lib/pdf-render.ts` exports
  the PDFs — so it could not be reclassified as dev and counted as solved. Counts, in order:
  runtime 20 → 8 → **0**, full tree 26 → 14 → **6**. The 6 that remain are dev-only lint and
  build tooling with no upstream remedy: `eslint-config-next` is already at the version that
  matches `next@16.4.0` and npm proposes a two-major *downgrade* to 14.2.35, `braces`,
  `fast-glob` and `micromatch` are flagged across every published version, and the `esbuild`
  Low is pinned by `tsx` and `vite`.
- **The Node floor moved to `>=22.12.0`, and the base image with it, because puppeteer 25
  demands it** (`puppeteer/package.json` `engines.node`). This is the change an earlier pass
  of the same finding considered and explicitly declined "for a release cut"; once the
  advisory work required it, it was made properly: `node:20-alpine3.20@sha256:3bc9a4…` →
  `node:22-alpine3.23@sha256:baf676f7…` (the image reports `v22.23.3`), `node-version: "20"` →
  `"22"` in all three CI jobs, `engines`, `scripts/check-engines.mjs` and `engines:check`
  re-armed, and every apk pin re-**read** from the new base with `apk policy` rather than
  guessed: `python3=3.12.15-r0 make=4.4.1-r3 g++=15.2.0-r2`, `curl=8.22.0-r0`,
  `chromium=149.0.7827.53-r0`. `npm run engines:check` over 1261 installed manifests (426 of
  which declare `engines.node`) reports 0 excluding either 22.23.3 or 24.18.0.
  `scripts/engine-strict-probe.sh` now installs in the shipping image — `PROBE_EXIT=0 … accepts
  the manifest set on 22-alpine3.23` — and its falsification control was run too: the same
  probe with `ENGINES_PROBE_IMAGE=node:20-alpine3.20` exits 1 with `npm error code EBADENGINE …
  Not compatible with your version of node/npm: project-tasks-log@0.2.0`, which is now the
  intended outcome. Verified end to end on the final tree of this pass, on the new base:
  `npm run db:generate`, `npm test` (the client precheck, lint, typecheck, 61 files / 843
  tests), `npm run build`, `npm run test:e2e` (86 passed / 42 skipped on the 3×3 engine ×
  viewport matrix), `npm run docker:build -- gid-task-flow:pass7` (`--load` plus the landed-tag
  check), and both provider boots behind Coolify-style container names with `npm run
  smoke:container REQUIRE_PDF=1` — 28 checks, 0 failed on SQLite and the same on Postgres 16,
  each returning a real `application/pdf` from the image's Chromium (35316 and 34985 bytes).
  That gate is what surfaced FL-08 above.
- **PAR-03's repair was rewritten, because the guard the fourth pass added was too weak to
  catch what the repair itself could do.** Rule E only asked for *an* `UPDATE`/`DELETE` above
  the `CREATE UNIQUE INDEX`; a statement that writes a different table, or writes the right
  table without touching the predicate column, passed it while leaving the duplicates in
  place. Rule E is now per statement and requires the target to be the index's own table *and*
  the predicate column to appear where it changes rows — in the `SET` list of an `UPDATE`, in
  the `WHERE` of a `DELETE`. Six controls, all behaving as predicted: shipped file green; no
  backfill red; `UPDATE "Project" …` red; `UPDATE "JobAttendance" SET "totalWorkSeconds" = 0
  WHERE "checkOutTime" IS NULL` red (the shape the weak rule accepted); backfill below the
  `CREATE` red; a `DELETE`-form repair green, so a different valid fix is not failed for style.
- **The same pass found a data-loss condition in its own PAR-03 fix.** The repair used
  Prisma's copy-and-swap rebuild for a default change — `CREATE TABLE new_Job`, copy,
  `DROP TABLE "Job"`, rename. `PRAGMA foreign_keys` is a no-op inside a transaction, so on a
  connection that enabled the pragma *before* opening it the `DROP` does not fail: the
  `ON DELETE CASCADE` arms on Project, Task, JobAttendance and BreakType fire and those four
  tables are emptied while the migration still exits 0. Measured on a populated database
  through all three (pragma, transaction) conditions: `OFF/OFF lost=nothing`,
  `ON/OFF lost=nothing`, `ON/ON lost=Project,Task,JobAttendance,BreakType`. The repair is now
  additive — `ADD COLUMN` with a constant default, `UPDATE`, `DROP COLUMN`, `RENAME COLUMN` —
  which never destroys the table identity the children point at, and measures
  `lost=nothing` in all three conditions with the same resulting default, index, empty
  `PRAGMA foreign_key_check` and no orphans. `tests/unit/migration-job-workdays-repair.test.ts`
  (11 tests) pins that matrix and carries its own controls: the copy-and-swap form empties the
  same fixture, and an unrepaired database stores `1, 2, 3, 4, 5` where `JSON.parse` throws.
  Prisma's own `migrate deploy` was re-measured on a populated database both before and after
  the repair (rows preserved, default becomes `'[1, 2, 3, 4, 5]'`), and `migrate diff` reports
  no drift in either direction — the additive form reorders the column list, and SQLite, unlike
  Prisma, cares.
- The fourth re-audit pass looked at the code the third pass had just written and found a
  defect class nobody had tested: **PAR-09**. `20261010180500` can only create its unique
  index because the statement above it closes the rows the old race produced — but on a
  database that already holds two open check-ins, the `CREATE UNIQUE INDEX` alone fails
  (`UNIQUE constraint failed: JobAttendance.jobId`, measured), the migration aborts, and the
  deployment never boots. Nothing in the suite
  could see that: the integration tests build a clean schema with `db push`, and
  `db:parity:migrations` compared text. Two things now hold it. `scripts/check-migration-parity.mjs`
  gained rule E (a required partial index must be preceded in the same file by a statement that
  resolves existing violations, checked in **both** sets — measured: removing the backfill from
  one set or from both exits 1, and rule C still fires when only the predicate diverges).
  And `tests/unit/migration-attendance-backfill.test.ts` replays the *real* SQLite migration
  files in directory order onto a temp database with `better-sqlite3` (a declared dependency),
  plants three open rows on one job plus controls, applies the migration, and asserts the
  outcome row by row: one open row per job, the highest id keeps its seconds, the losers close
  at their own check-in time with zero, closed history untouched, a second open row refused, a
  second *closed* row allowed, the index still present after the `Job` rebuild in
  `20261010182000`, and that rebuild's default now parsing as JSON. Proven to fail: deleting the
  backfill from the migration turns 3 of its 4 tests red, restoring turns them green. The same
  fixture ran against Postgres 16 with the shipped files — `UPDATE 2`, `CREATE INDEX`,
  `duplicate key value violates unique constraint "JobAttendance_one_open_check_in"` for the
  open control, `INSERT 0 1` for the closed one. `POST /api/attendance`'s contract text in
  `docs/openapi.yaml` was regenerated to say the constraint is the database's now, not the
  transaction's, since both paths answer the same 409.
- The four provider-parity findings the previous pass deliberately left open are fixed,
  each one measured on both shipped engines rather than argued from the schema.
  **PAR-04** (High, the one-open-check-in race) is closed where it can be closed for both
  providers: a partial unique index `JobAttendance_one_open_check_in` on
  `("jobId") WHERE "checkOutTime" IS NULL`, written identically into both migration sets,
  backed by an in-migration backfill that closes orphaned open rows first so no existing
  deployment can fail at boot, and `src/app/api/attendance/route.ts` maps the resulting
  `P2002` to the same 409 its pre-check already returns. A Postgres-only `FOR UPDATE`
  would have left SQLite unprotected; this cannot. Proven on real data — Postgres answers
  `duplicate key value violates unique constraint "JobAttendance_one_open_check_in"`,
  SQLite answers `SQLITE_CONSTRAINT_UNIQUE` with `open rows = 1` — plus three integration
  tests including two concurrent requests that yield exactly `[200, 409]`.
  Because `db push` builds the test database from the schema alone and Prisma cannot
  express a partial index, `tests/integration/helpers/harness.ts` now applies the
  SQLite file through `RAW_SQL_OBJECT_MIGRATIONS`, and `npm run db:parity:migrations`
  pins all three halves (both sets declare it, the harness applies it).
  **PAR-03** (the unquoted `DEFAULT [1, 2, 3, 4, 5]`) is repaired by a new SQLite
  migration that rebuilds `Job` copy-and-swap with `DEFAULT '[1, 2, 3, 4, 5]'`; a fresh
  `migrate deploy` now stores `"[1, 2, 3, 4, 5]"` which parses as JSON, and Prisma's own
  `migrate diff` reports no drift in either direction, so the shipped schema files stayed
  truthful. The parity check's shrink-only exception list now requires a `repairedBy`
  migration that exists, quotes the default, and sorts after the defective version.
  **PAR-06** (NULL `endedAt` ordering) now requests `{ sort: "desc", nulls: "first" }`
  explicitly, which the generator resolves to `NULLS FIRST` on Postgres and an `IS NULL`
  ordering term on SQLite, so the same export rows come first on both. **PAR-08**
  (collation-dependent tie-break) replaces `name: "asc"` with `id: "asc"` in
  `src/app/api/breaks/route.ts`, and a test inserts `apple` then `Tea` in the same
  instant to prove adjacency by id rather than by collation.
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
  others reference — on data that is already shipped, so at that pass it was recorded as a
  tracked exception rather than fixed blind; the first bullet above is the repair. What is
  new is `scripts/check-migration-parity.mjs`
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
  collation-dependent text tie-breaks — were recorded as findings PAR-02/03/04/06/08 in the
  re-audit sheet instead of fixed blind: they need new migrations on *both* providers plus a
  locking decision, and editing already-applied migrations is not a remedy. All five are now
  fixed additively, in the first bullets of this section.
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
