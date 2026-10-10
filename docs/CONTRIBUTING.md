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
| Migration-set parity | `npm run db:parity:migrations` | exit 0 — it compares the two migration **sets** (the schema diff cannot see seeded rows), pins that every raw-SQL schema object (a partial unique index: `JobAttendance_one_open_check_in`) is declared identically in both sets, **backfilled before it is created** (PAR-09 — otherwise a deployment that already holds duplicate rows fails `migrate deploy`), **and** applied by `tests/integration/helpers/harness.ts`, and fails on any new `DEFAULT [` that stores a non-JSON string on SQLite. `tests/unit/migration-attendance-backfill.test.ts` replays the real SQLite migration files over planted duplicates to prove the backfill behaves |
| Contract freshness | `npm run docs:openapi:check` | exit 0 after `npm run docs:openapi` if routes changed |
| Bundle budget | `npm run bundle:budget` | exit 0 |
| Build | `npm run build` | exit 0 |
| Browser matrix | `npm run test:e2e` | exit 0 (needs `npm run test:e2e:install` once) |
| Container | `docker build -t gid-task-flow .`, boot on SQLite **and** Postgres, then `APP_USERNAME=… APP_PASSWORD=… REQUIRE_PDF=1 npm run smoke:container -- http://127.0.0.1:PORT` | `TOTAL 28 checks, 0 failed` on **both** providers. Health and login alone proved nothing: the 2026-10-09 pass found a container-only PDF degradation (AR-06) that every other gate passed over, so the gate is the script, not a checklist in someone's head. |
| Compose files | `docker compose -f docker-compose.yml config -q` (with `SESSION_SECRET` + `APP_PASSWORD_HASH` set) and the same for `docker-compose.prod.yml` | exit 0 — both files must parse, and `docker-compose.yml` must still **refuse** an empty `APP_PASSWORD_HASH`. CI runs this as its own step, because nothing else ever did and a broken dev file went unnoticed for a whole wave. |

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

## 2. Branch and PR workflow

This is the workflow the repository now uses: the whole `0.2.0` audit campaign
was executed on `chore/audit-remediation-2026-10` and reviewed through Draft PR
#2, with CI green on every pushed head. Before it, features landed as direct
commits on `master`, which is why audit finding PM-01 could not name a branch,
issue or PR for the work in progress. Keep doing:

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
release. Release history: **`v0.2.0` (2026-10-09)** — the audit remediation
campaign, cut on the branch `chore/audit-remediation-2026-10` (Draft PR #2), which
must be merged with a merge commit so the annotated tag stays reachable from
`master`. There was no tag before it; `0.1.0` was never released, it was just what
`package.json` happened to say.

Nothing in the suite may assert a literal version string. `docs/openapi.yaml`,
`readAppVersion()` in the backup CLIs, and the contract check all read
`package.json`, which is what makes a bump safe; a test that hardcodes `0.1.0`
fails the first release after it (and did exactly that on CI, 2026-10-09).

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
- **Never tag a commit whose pipeline is not green.** The tag is the claim that
  the artefact works, and CI at that exact SHA is the evidence — not the run on
  the commit before it. Check `gh run list --branch <sha-branch> --limit 1`
  shows `completed success` for the head you are about to tag.
- A release cut changes only `CHANGELOG.md` + `package.json` + lockfile. If you
  need a code fix, it belongs to the release's own PR, not this commit.
- `0.x` is honest about immaturity: breaking changes inside `0.x` bump MINOR
  (`0.1.0` → `0.2.0`), fixes bump PATCH (`0.2.0` → `0.2.1`). `1.0.0` is reserved
  for a release whose README, API contract and security posture are all
  simultaneously accurate and supported.
- Never rewrite or force-push a published tag; cut the next version instead.

`0.2.0` (2026-10-09) is the audit remediation campaign: the content was already
in `[0.2.0]` in `CHANGELOG.md` and `package.json` already said `0.2.0`, so the
release commit is the campaign's own tip rather than a separate version bump.
The version edit and the tag are the maintainer's *decision*; an agent may
execute them only under a recorded authorization for that specific action (the
2026-10-09 release and the `chore/audit-remediation-2026-10` push + Draft PR
were both approved that way). Merge this release with a **merge commit**, not
squash: `v0.2.0` is annotated onto the release commit on the branch, and a
squash would leave the tag unreachable from `master`.

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
| `.gitignore` line `.env*` | Resolved 2026-10-09: `.env.example` is now negated (`!.env.example`) and **tracked**; real `.env` files stay ignored (`git check-ignore -v .env` still matches) | Keep the template free of credential material — `APP_PASSWORD` / `APP_PASSWORD_HASH` are empty in it, on purpose. Tracked `.env` has never existed (`git log --all -- .env` is empty) |
| `project-tasks-log.zip` at the repo root | Resolved 2026-10-09: deleted with the operator's approval. It was 246,196 bytes, untracked, ignored, and held a `dev.db` snapshot with real client/project/task names | Nothing left to do; there was never anything to purge from history (`git log --all --diff-filter=A -- project-tasks-log.zip` is empty) |
| Archives/scratch | `*.zip`, `*.tar.gz`, `.tmp-*` ignored; `audit-report/`, `coverage/`, `test-results/`, `.next-e2e/`, `.playwright-e2e/`, `e2e-playwright.db*`, `dev.db`, `*.tsbuildinfo`, `next-env.d.ts`, `/src/generated/prisma` ignored | Correct as-is; no tracked file is ignored (`git ls-files -i -c --exclude-standard` is empty) |
| Secrets in git | None: `git ls-files` shows no `.env`, `*.db`, `*.pem`, `*.key`; `*.pem` is ignored | Keep credential material out of the tree; `SESSION_SECRET` and hashes live in `.env` / Coolify env only |
| `LICENSE` | Resolved: `package.json` now declares `"license": "MIT"`, matching `LICENSE` (copyright "MUIS / GID Studio"), while staying `"private": true` | Nothing to do; if the package is ever published, drop `private` in the same commit |
| Default branch | `master`, remote `https://github.com/muisdevop/project-tasks-log`. Since 2026-10-09 work lands on a branch and a Draft PR (`chore/audit-remediation-2026-10` → PR #2), and CI has actually executed | Re-check before claiming anything: `git rev-list --count origin/master..master`, `gh run list --limit 5`, and read the failed step (`gh run view <id> --log-failed`) rather than the badge |

## 6. Reviewer checklist

1. Does every command/file/env var named in the diff actually exist? (`ls`,
   `grep`, `npm run <name>`)
2. Did the invariant set in `docs/architecture.md` §4 still hold, or was it
   updated deliberately?
3. New mutating GET? There must not be one — `SameSite=Lax` is part of the CSRF
   mitigation (`docs/security.md` §2).
4. New query/credential path: is it scoped by `requireWriteAccess`, rate limited
   by bucket, and does it emit a security event where relevant?
5. Schema change: SQLite **and** Postgres migrations written, `npm run db:parity` **and** `npm run db:parity:migrations`
   green? If the migration creates something the Prisma schema cannot express (a partial
   unique index, a seeded row), it must be written into **both** migration sets *and* the
   SQLite file added to `RAW_SQL_OBJECT_MIGRATIONS` in `tests/integration/helpers/harness.ts`
   — `db push` builds the test database from the schema alone, so without that entry the
   constraint exists in production and is invisible to every integration test.
6. `CHANGELOG.md` updated, and does it claim anything the tests do not prove?
