# Fix 93 Audit Findings + Re-audit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 93 findings from `C:\tmp\xlsx-gen\data.js` (GID Task Flow audit 2026-10-07), then re-audit until clean.

**Architecture:** Wave-based fixes, backend-first (data integrity/security), then frontend, then devops/docs. Shared helpers: `src/lib/api-error.ts` (401/500 mapping), `src/lib/rate-limit.ts`, `src/lib/startup-checks.ts` + `src/instrumentation.ts`. Schema changes (tokenVersion, isBreak, indexes) land in BOTH prisma schemas with a sqlite migration and a postgres baseline migration under `prisma/postgres/`.

**Tech Stack:** Next.js 16.4.0, React 19, Prisma 7 (sqlite/pg adapters), zod, vitest, Tailwind v4, Docker.

**Gate (AGENTS.md, before commit):** build → tests (lint+typecheck+vitest chained) → docker build → docker run sqlite AND postgres → coolify compat check.

---

## Wave 1 — Backend security core (task #6)

- [x] SEC-01: `next@16.4.0` + `eslint-config-next@16.4.0`, `@vitest/coverage-v8`, `npm audit fix`
- [x] ST-03: `src/lib/prisma.ts` — remove silent cross-DB fallback; construct client directly, errors propagate
- [x] SEC-03/BF-03: `src/lib/startup-checks.ts` + `src/instrumentation.ts` — production refuses default SESSION_SECRET and plaintext APP_PASSWORD; actionable login error (AuthNotConfiguredError → 500 with instructions)
- [x] SEC-06: `UserSettings.tokenVersion` (both schemas) — JWT carries `tv`, verified per request; password change/logout increment it
- [x] SEC-02/MF-02: `src/lib/rate-limit.ts` — in-memory fixed-window limiter; login 5 attempts/5min per IP → 429 + Retry-After; auth-failure audit log (console)
- [x] SEC-10: bcrypt cost 10 → 12; opportunistic rehash on login when stored cost < 12; timing equalization via dummy-hash compare
- [x] SEC-11: logout requires session (401 otherwise) + bumps tokenVersion
- [x] SEC-07/BF-02: `/api/health` public, minimal `{status}` only, 503 on DB failure (details server-side); `src/proxy.ts` whitelists `/api/health`
- [x] SEC-13/BG-06: `src/lib/api-error.ts` `toErrorResponse()` — UnauthorizedError→401, else 500 generic; applied to jobs, jobs/[jobId], projects, breaks, subtasks, report-titles, attendance, stats
- [x] SEC-08/RB-02: zod gaps — `jobCreateSchema`/`jobUpdateSchema` (HHMM regex `hhmmSchema`), `projectSchema.description`, `attendanceSchema` (notes ≤2000), `exportQuerySchema` enums; `toSlugKey` single-sourced in validators (AR-04 partial)
- [x] ST-01: report-titles read-modify-write wrapped in `prisma.$transaction`
- [x] MF-03: `next.config.ts` `headers()` — CSP, frame-ancestors, nosniff, Referrer-Policy, Permissions-Policy, HSTS (prod only)
- [x] TC-02/TC-04: `vitest.config.ts` (v8 coverage, thresholds lines/functions/statements 60, branches 50); package.json: `typecheck`, `test:coverage`, `test:unit`, `test:integration`; `test` chains lint+typecheck+vitest

## Wave 2 — Data integrity (task #7)

- [ ] FL-03: `applyTaskTransition` hold branch accumulates `workingTimeDiffSeconds(startedAt, now)` into elapsedSeconds; route auto-hold paths (break create, resume) accumulate before updateMany; hold unit tests first (TDD)
- [ ] SEC-05: tasks PATCH always persists server-computed `change.elapsedSeconds`; `elapsedSeconds` removed from `taskActionSchema`; client `startedAt` gated behind `ALLOW_CLIENT_START_TIME` env flag
- [ ] SEC-09: sanitize `notes`/`details` HTML server-side (isomorphic-dompurify) before storing logNotes/completionOutput/cancellationReason
- [ ] FL-02: resume flow in interactive `prisma.$transaction` — status re-check inside tx, guarded hold-others updateMany, task update + event create atomic
- [ ] FL-04: attendance check-in transaction — 409 if open row today, stale open rows (prior days) closed explicitly, missing job → 404
- [ ] FL-05: explicit `Task.isBreak` column (both schemas + migrations); tasks POST uses flag (suffix kept as legacy fallback); breaks route prayer-lockout matches isBreak tasks; break widget/overlay send `isBreak: true`
- [ ] FL-06: export zero-match → 404 "no tasks matched" (was 400)
- [ ] FL-07: export date grouping uses local calendar dates consistently (`localDateKey()` in export-helpers; no UTC string roundtrip); attendance/business-time already local
- [ ] SEC-04: export render mutex (max 1 concurrent), puppeteer launch/page timeouts (30s), non-root container (Dockerfile wave)
- [ ] PF-04: export max span 366 days → 400
- [ ] PF-01: indexes both schemas — Task(projectId,status), Task(status,endedAt), TaskEvent(taskId), SubTask(taskId); sqlite `migrate dev`; postgres baseline generated via `migrate diff` under `prisma/postgres/migrations/`
- [ ] AR-03: `docker-entrypoint.sh` PG branch → `prisma migrate deploy --schema prisma/postgres/schema.prisma` (schema moved to own dir for isolated migrations)

## Wave 3 — Frontend correctness (task #8)

- [ ] BG-01: subtasks.tsx — early return moved below hooks (gate render at parent)
- [ ] BG-02: task-board collapsed-state hydration in effect; sidebar sessionStorage seeding in effect
- [ ] BG-05: tailwind.config.ts ESM import (remove require)
- [ ] UI-01: globals.css `@config "../tailwind.config.ts";` (loads typography plugin under Tailwind v4)
- [ ] UI-02: body font → `var(--font-geist-sans)`
- [ ] UI-05: delete `settings-form.tsx`, `project-board.tsx`
- [ ] UI-07: namespace duplicate `project-name` ids
- [ ] UI-09: rich-text-display emptiness via parsed textContent
- [ ] UX-01: task-action-modal keeps modal open on mutation failure (error banner), resets state on open; task-board confirm handlers await mutation result
- [ ] UX-02: stable editor key (remove title-keyed remount)
- [ ] UX-03: break-end single server call (POST /api/breaks/end) + `router.refresh()` instead of `window.location.reload()`
- [ ] UX-04: jobs page distinct error state + retry
- [ ] UX-05: `?next=` deep-link capture on login (same-origin validated)
- [ ] UX-07: busy state as Set of task ids; sidebar logout pending/error handling
- [ ] UX-08: dashboard job rows link to /jobs/[id]; Task Status Distribution includes on_hold
- [ ] UI-08: confirm()/alert()/prompt() → ModalShell-based confirm/input (shared `useConfirm`/`ConfirmDialog`)
- [ ] BG-03: render attendance notes echo or remove dead state (render it)
- [ ] BG-04: covered by UX-07 Set-based busy state
- [ ] AR-04: global-break-widget imports `resolveActiveJobId` from `@/lib/navigation`

## Wave 4 — Design system, responsiveness, perf (task #9)

- [ ] UI-03: shared `Card`/`PageHeader` components; migrate pages
- [ ] UI-04: adopt `useApiMutation` in task-board/subtasks/job-attendance/jobs-page
- [ ] UI-06/RS-01: collapsible sidebar (off-canvas <md, hamburger), skip link
- [ ] RS-02: break widget repositioned on small screens (in-header dock)
- [ ] RS-03: dashboard tables → stacked cards below md
- [ ] UI-10/BF-04: dark mode — remove half-applied media query, remove README claim (honest single-theme + tokens)
- [ ] PF-05: `next/dynamic` for RichTextEditor and export page
- [ ] PF-06: subtasks fetched with tasks (include) — batch
- [ ] RS-04: Playwright smoke (chromium) login→dashboard→export at 3 viewports; `test:e2e` script

## Wave 5 — Testing (task #10)

- [ ] TC-01/TC-03: route integration tests (vitest, temp sqlite file DB): auth/login+rate limit, tasks create/hold/resume/complete (time accumulation!), attendance invariant, breaks, export filters, health; migration round-trip fixture test
- [ ] TC-02: verified by `npm run test:coverage` passing with thresholds

## Wave 6 — DevOps/docker (task #11)

- [ ] MF-01/PM-04: `.github/workflows/ci.yml` — install → lint → typecheck → test → build; docker image build job; dual-DB smoke (sqlite + postgres services)
- [ ] SEC-14/AR-06: Dockerfile — non-root user, HEALTHCHECK, runtime from `.next/standalone`, `PUPPETEER_SKIP_DOWNLOAD=1` builder, pinned base digest
- [ ] ST-02: builder stage build-base+python3
- [ ] AR-07: entrypoint — generate+migrate once per boot is kept (no read-only node_modules assumption), exec `node` server directly
- [ ] AR-08: compose — `restart: unless-stopped`, remove baked DATABASE_URL default from Dockerfile, document resource limits
- [ ] SEC-03 compose: remove default SESSION_SECRET/APP_PASSWORD defaults (require explicit), keep APP_USERNAME default with warning

## Wave 7 — Architecture/ops features (task #12)

- [ ] AR-01: extract export HTML generator to `src/lib/report-render.ts` (route stays auth+validate+orchestrate)
- [ ] AR-02: `scripts/check-schema-drift.mjs` (normalize provider line, diff, CI gate)
- [ ] AR-05: export types derived from Prisma query result (`satisfies`)
- [ ] MF-04: request logging helper + `/admin/events` page over TaskEvent
- [ ] MF-05: cursor pagination (`?cursor=&limit=`) + `?search=` on tasks/attendance lists; stats `_count` selects
- [ ] MF-06: `scripts/backup.mjs` (sqlite dump / PG pg_dump wrapper) + `GET /api/export/data` JSON dump
- [ ] MF-07: single-user decision documented in README + AGENTS.md (explicit non-goal)
- [ ] MF-08: dashboard reminder toasts (running task > workEnd, unchecked attendance, active break duration)

## Wave 8 — Docs/process (task #13)

- [ ] PM-03/BF-01: README rewrite — remove NextAuth/React Hook Form/Prettier/WCAG/dark-mode/caching/indexing/multi-user false claims; document real env vars, real export GET API, real scripts
- [ ] PM-02: LICENSE (MIT), CHANGELOG.md, git tag v0.2.0
- [ ] PM-01: `project-tasks-log.zip` → add to `.gitignore`, recommend deletion (contains dev.db snapshot, no secrets)

## Wave 9 — AI/MCP (task #14)

- [ ] AI-01: `docs/openapi.yaml` generated from zod schemas + `scripts/check-openapi.mjs` CI gate
- [ ] AI-02: API tokens — `ApiToken` model (sha256 hashed, scoped read/write, revocable), `Authorization: Bearer` support in requireAuth
- [ ] AI-03: idempotency — `Idempotency-Key` header on tasks POST/PATCH + breaks end (unique request log, replays return original response)

## Final gate (task #15)

- [ ] `npm run build` success; `npm test` (lint+typecheck+vitest) all pass; `npm run test:coverage` passes thresholds; `npm audit` re-run (next critical gone; document remainder)
- [ ] `docker build` success; run with sqlite AND postgres (smoke: health, login, task flow)
- [ ] Coolify compatibility note (container-name DNS, no hardcoded names)
- [ ] Regenerate `audit-report/` workbook with statuses → re-audit loop until clean
