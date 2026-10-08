# Contributing

Process rules for GID Task Flow, written from the repository's actual state on
2026-10-08 (commit `9a46388`, single branch `master`, zero tags, ten commits not
yet pushed to `origin/master`). These documents are the fix for audit findings
**PM-01** (in-flight work invisible to any tracker) and **PM-02** (no changelog,
no tags, no licence).

## 1. Before you touch anything

| Gate | Command | Must be |
| --- | --- | --- |
| Lint | `npm run lint` | exit 0 |
| Types | `npm run typecheck` | exit 0 |
| Full local suite | `npm test` | exit 0 — it *is* `lint && typecheck && vitest run` |
| Unit only | `npm run test:unit` | exit 0 |
| Integration only | `npm run test:integration` | exit 0 (spins a temp SQLite DB) |
| Coverage ratchet | `npm run test:coverage` | over the thresholds in `vitest.config.ts` (60% lines/functions/statements, 50% branches, on `src/lib` + `src/app/api`) |
| Schema parity | `npm run db:parity` | exit 0 |
| Contract freshness | `npm run docs:openapi:check` | exit 0 after `npm run docs:openapi` if routes changed |
| Bundle budget | `npm run bundle:budget` | exit 0 |
| Build | `npm run build` | exit 0 |
| Browser matrix | `npm run test:e2e` | exit 0 (needs `npm run test:e2e:install` once) |
| Container | `docker build -t gid-task-flow .` then boot on SQLite **and** Postgres | `/api/health` returns ok, login works |

`AGENTS.md` is the canonical definition of done; `.github/workflows/ci.yml`
automates it (quality → docker-build → smoke on both databases). CI only means
anything once the commit is **pushed** — an unpushed `master` has never been
through any of it.

**Prisma generate order (AR-02).** `prisma/schema.sqlite.prisma` and
`prisma/postgres/schema.prisma` both emit into the same default
`node_modules/.prisma/client`, so only the last-generated client exists. If you
ran `npm run db:generate:postgres` for Postgres work, run
`npm run db:generate:sqlite` again **before** `npm run test:integration` or
`npm test`: the harness boots a SQLite database and a Postgres-built client
against it fails with an adapter/provider error that looks like a broken test
rather than a stale generate. The same ordering applies after
`npm run db:generate:postgres` in CI. `npm run db:parity` checks the two schemas
agree; it cannot check which client is on disk.

## 2. Branch and PR workflow (the repo does not do this yet)

Today: one branch (`master`), and features land as direct commits on it. That is
why audit finding PM-01 could not name a branch, issue or PR for the work in
progress. Move to:

1. `git switch -c feat/<short-slug>` off `master`.
2. Commit small, with the imperative style already in the history
   (`fix(api,tests): …`, `feat(export): …`, `test(e2e): …`). Reference an audit
   id in the body when a commit closes a finding (e.g. `MF-05`).
3. Push the branch and open a PR into `master`, even when you are the only
   reviewer. The PR is the tracking artefact; without it the work is invisible.
4. Wait for CI green on the PR, then merge. `master` stays pushable-at-any-moment.

**WIP visibility rule.** Uncommitted work must not outlive a day. Either
`git stash` is not an option here — instead commit the partial state to its
branch and push it as a **Draft** PR (`gh pr create --draft`) so the diff, the
intent and the failing test are visible to anyone reading the repo. If a branch
cannot be pushed, its state goes in `CHANGELOG.md` under `Unreleased` in the same
session, before you stop working.

Repos of this size do not need trunk-based development or release branches; they
need every change to have a name and a place to be discussed.

## 3. Release and tagging convention

SemVer (`MAJOR.MINOR.PATCH`) with annotated tags, one `CHANGELOG.md` section per
release. Currently `package.json` says `0.1.0` and `git tag -l` is empty, so
there is no release history to audit — that is the gap this section closes.

For every release:

1. Move the `Unreleased` block of `CHANGELOG.md` into a new `## [X.Y.Z] - YYYY-MM-DD`
   section and add a fresh empty `Unreleased` on top.
2. Bump `version` in `package.json` (and commit `package-lock.json` if npm
   rewrote it).
3. Commit, then tag the commit that carries both:

```bash
git add CHANGELOG.md package.json package-lock.json
git commit -m "chore(release): v0.2.0"
git tag -a v0.2.0 -m "GID Task Flow 0.2.0 - audit remediation campaign"
git push origin master v0.2.0
```

Rules
- Tag names are prefixed with `v`.
- Tags are annotated (`-a`/`-m`), never lightweight — `git tag -l -n99` must show
  a readable description.
- A release cut changes only `CHANGELOG.md` + `package.json` + lockfile. If you
  need a code fix, it belongs to the release's own PR, not this commit.
- `0.x` is honest about immaturity: breaking changes inside `0.x` bump MINOR
  (`0.1.0` → `0.2.0`), fixes bump PATCH (`0.2.0` → `0.2.1`). `1.0.0` is reserved
  for a release whose README, API contract and security posture are all
  simultaneously accurate and supported.
- Never rewrite or force-push a published tag; cut the next version instead.

The immediate step: the campaign work in the `Unreleased` block of
`CHANGELOG.md` is release-worthy content, so the next release should be
**`0.2.0`**. The version edit and the tag are the maintainer's action (agents
working this repo do not run git write commands).

## 4. Documentation duties

- Changing a route's zod schema → run `npm run docs:openapi` and commit
  `docs/openapi.yaml`; CI fails on staleness.
- Changing auth, rate limits, tokens, CSRF posture or secrets handling → update
  `docs/security.md` in the same PR.
- Adding a module, a provider, a table, or changing an invariant → update
  `docs/architecture.md`; if the change *is* a decision (e.g. how time is
  computed, whether the app goes multi-user), add an ADR section there rather
  than arguing in a commit message.
- Anything a user or operator can run or configure → `README.md` tables
  (Scripts, Configuration, API). A claim in `README.md` must be re-verifiable by
  `ls`/`grep` at review time; no aspirational features.
- Every user-visible change → a `CHANGELOG.md` bullet under `Unreleased`.
- `AGENTS.md` holds only the build/test/docker gate and Next-version warning;
  process detail belongs here.

## 5. Repository hygiene

Findings from the PM-01/PM-02 pass, each verified with the command shown.

| Item | State | Action |
| --- | --- | --- |
| `.gitignore` line `.env*` | Also ignores **`.env.example`**, which is therefore **untracked** (`git ls-files .env.example` is empty; `git check-ignore -v .env.example` matches) | Add a negation `!.env.example` so the template ships with the repo. Tracked `.env` has never existed (`git log --all -- .env` is empty) — keep it that way |
| `project-tasks-log.zip` at the repo root | 246,196 bytes, untracked, matched by `.gitignore:50:*.zip`; contains a `dev.db` snapshot (73,728 bytes) with real client/project/task names and a placeholder `.env.example` | Delete it from disk: `rm project-tasks-log.zip`. Nothing to purge from history (`git log --all --diff-filter=A -- project-tasks-log.zip` is empty) |
| Archives/scratch | `*.zip`, `*.tar.gz`, `.tmp-*` ignored; `audit-report/`, `coverage/`, `test-results/`, `.next-e2e/`, `.playwright-e2e/`, `e2e-playwright.db*`, `dev.db`, `*.tsbuildinfo`, `next-env.d.ts`, `/src/generated/prisma` ignored | Correct as-is; no tracked file is ignored (`git ls-files -i -c --exclude-standard` is empty) |
| Secrets in git | None: `git ls-files` shows no `.env`, `*.db`, `*.pem`, `*.key`; `*.pem` is ignored | Keep credential material out of the tree; `SESSION_SECRET` and hashes live in `.env` / Coolify env only |
| `LICENSE` | MIT, copyright "MUIS / GID Studio"; `package.json` has **no** `license` field and is `"private": true` | Add `"license": "MIT"` to `package.json` so tooling agrees with `LICENSE` |
| Default branch | `master`, remote `https://github.com/muisdevop/project-tasks-log` | Re-check push state before claiming CI ran: `git rev-list --count origin/master..master` |

## 6. Reviewer checklist

1. Does every command/file/env var named in the diff actually exist? (`ls`,
   `grep`, `npm run <name>`)
2. Did the invariant set in `docs/architecture.md` §4 still hold, or was it
   updated deliberately?
3. New mutating GET? There must not be one — `SameSite=Lax` is part of the CSRF
   mitigation (`docs/security.md` §2).
4. New query/credential path: is it scoped by `requireWriteAccess`, rate limited
   by bucket, and does it emit a security event where relevant?
5. Schema change: SQLite **and** Postgres migrations written, `npm run db:parity`
   green?
6. `CHANGELOG.md` updated, and does it claim anything the tests do not prove?
