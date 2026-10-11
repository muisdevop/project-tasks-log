# Security posture (honest)

This file is the detailed version of the short list in `README.md`. It describes
what the code actually enforces today — including the parts that are a documented
residual risk rather than a feature. Written up for audit finding **MF-02**
(“CSRF posture undocumented, security events not logged”) together with **AI-02**
(API tokens) and **AI-03** (idempotency + rate limiting).

Source of truth for each claim is named so it can be re-checked:
`src/proxy.ts`, `next.config.ts`, `src/lib/session.ts`, `src/lib/auth.ts`,
`src/lib/api-tokens.ts`, `src/lib/idempotency.ts`, `src/lib/rate-limit.ts`,
`src/lib/security-events.ts`.

---

## 1. Credentials

Two kinds of credential are accepted, and the resolution order is fixed
(`authenticate()` in `src/lib/auth.ts`):

1. **`Authorization: Bearer <token>`** — only when the route handler forwards its
   `Request` object to `requireAuth(request)`.
2. **`stl_session` cookie** — the pre-existing human session. A handler that does
   not forward a `Request` behaves exactly as it did before tokens existed.
3. **Nothing** → `UnauthorizedError` → 401 (`toErrorResponse`).

A request presenting both is judged on the Bearer credential alone. That is
deliberate: an agent must never inherit the browser's full-power session by
accident.

### 1.1 Session cookie (human)

- `jose` HS256 JWT carrying `{ sub, tv }`, `HttpOnly`, `SameSite=Lax`, `Secure` in
  production, `Path=/`, 7-day `Max-Age` (`src/lib/session.ts`).
- `tv` is `UserSettings.tokenVersion`; logout and password change bump it, which
  invalidates every previously issued cookie (`src/app/api/auth/logout/route.ts`).
- `SESSION_SECRET` shorter than 16 characters fails closed: `src/proxy.ts`
  redirects instead of accepting, and `createSession` throws before writing.

### 1.2 API tokens (machine, AI-02)

- Format `gid_<40 lowercase hex>` (20 random bytes, `node:crypto`).
- **Only the SHA-256 digest is stored** (`ApiToken.tokenHash`, unique index). The
  plaintext is returned in the body of the one `POST /api/tokens` response that
  created it and is never persisted, listed, or logged.
- Verification: digest lookup by unique index, then
  `crypto.timingSafeEqual` on the digests. A miss burns an equivalent dummy
  comparison so “no such token” and “wrong token” are not separable by timing.
- `scope` is an enum-ish string, `read` | `write`, enforced by
  `apiTokenCreateSchema` in `src/lib/validators.ts` and kept as `TEXT` in both
  Prisma schemas so `npm run db:parity` stays green:
  - `read` → `requireAuth(request)` / GET handlers.
  - `write` → mutating routes guarded with `requireWriteAccess(request)`; a `read`
    token there gets **403** (`ForbiddenError`).
  - Anything unrecognized in the database degrades to `read`, never to `write`.
- `expiresAt` (optional) and `revokedAt` are checked on every call; a revoked or
  expired token is a 401 and emits a security event naming which.
- `lastUsedAt` is written at most once per token per minute (throttled, failure
  swallowed) so telemetry cannot become a write-per-request hotspot.
- **Revocation is per token** (`PATCH {"id":n,"revoke":true}` or
  `DELETE /api/tokens?id=n`, which stamps `revokedAt` and keeps the row for the
  audit trail). This is the path the session cookie never had.
- The token manager itself is **cookie-only** (`requireSessionAuth`): a token can
  never mint, list or revoke another token — presenting one there is a 403 plus a
  `token.mint_denied` event.
- Rotating the password does **not** revoke API tokens (they are independent
  credentials by design). If a token may be compromised, revoke it at
  `/api/tokens`.

### 1.3 Reaching the API as a machine

`src/proxy.ts` is the gatekeeper for pages and APIs. It now lets a
`Bearer`-presented `/api/*` request through to the route handler — without a
cookie it would otherwise be redirected to the HTML login page, which is
unhelpful to a client that has no browser. Verification still happens in the
route (`requireAuth(request)`), never in the proxy, so the proxy stays
database-free and the answer is JSON (`401`/`403`/`429`) rather than a redirect.
Requests with neither credential keep the pre-existing redirect behaviour.

### 1.4 Operator quickstart

```sh
# 1. mint a token (browser session cookie only — never from a token)
curl -s -X POST https://app.example.com/api/tokens \
  -b "stl_session=$SESSION_COOKIE" -H 'content-type: application/json' \
  -H 'Idempotency-Key: 0f1e2d3c4b5a6978' \
  -d '{"name":"nightly reporter","scope":"read","expiresAt":"2026-12-31T23:59:59Z"}'
# -> {"token":{...metadata...},"plaintext":"gid_…","warning":"Copy this token now…"}

# 2. use it
curl -s -H "Authorization: Bearer gid_…" https://app.example.com/api/stats

# 3. inspect / revoke
curl -s -b "stl_session=$SESSION_COOKIE" https://app.example.com/api/tokens
curl -s -X DELETE -b "stl_session=$SESSION_COOKIE" 'https://app.example.com/api/tokens?id=3'
```

## 2. CSRF posture — what is actually enforced

**There are no CSRF tokens anywhere in this app, and no route checks the
`Origin` or `Referer` header.** Nothing in `src/proxy.ts` or `next.config.ts`
does an origin comparison; `allowedDevOrigins` in `next.config.ts` is a
dev-bundling allowance, not a CSRF control. What protects state-changing requests
is:

- `SameSite=Lax` on the session cookie. A cross-site `<form method="post">` or
  `fetch(..., { credentials: "include" })` does **not** carry the cookie, so the
  route sees no credential and answers 401. Lax does attach the cookie to
  top-level cross-site **GET** navigations, which is safe here only because every
  mutation is POST/PATCH/DELETE — no GET route writes.
- `Content-Security-Policy: frame-ancestors 'none'` and
  `X-Frame-Options: DENY` (`next.config.ts`), which remove the clickjacking route
  to a mutating request.
- Bearer-token requests are structurally immune to classic CSRF: a browser never
  attaches an `Authorization` header on its own.

Residual risks, stated plainly:

- A same-origin XSS defeats all of the above (the CSP needs `unsafe-inline` for
  App Router hydration payloads, so it is not a hard XSS boundary).
- Any future state-changing **GET** would be cross-site triggerable.
- If `SameSite` is ever weakened (or the app is served over plain HTTP in
  production, where a `Secure` attribute makes the cookie vanish — which fails
  closed, not open), the mitigation disappears.
- The right fix if any of those stops being acceptable is a double-submit or
  synchroniser token plus an `Origin` allow-list in `src/proxy.ts`; that is a
  deliberate non-goal for this single-user, self-hosted deployment today.

## 3. Rate limiting (AI-03)

`src/lib/rate-limit.ts` is a fixed-window in-process limiter (one container,
single user; scale-out needs a shared store — said out loud in the code too).
Presets:

| Bucket          | Key          | Budget            | Why |
| --------------- | ------------ | ----------------- | --- |
| `login`         | IP           | 5 / 5 min         | password guessing |
| `api`           | token id     | 120 / min         | agent-loop guard; enforced inside `authenticate()` |
| `anonymous`     | IP           | 30 / min          | reserved for unauthenticated API noise |
| `tokens-mint`   | IP/session   | 10 / 5 min        | `POST`/`PATCH`/`DELETE /api/tokens` |
| `tokens-list`   | IP/session   | 60 / min          | `GET /api/tokens` |
| rejection lock  | IP           | 30 rejections / 5 min | a brute-force stream of bad Bearer tokens stops costing DB lookups |

Keying the agent budget on the **token id** means one runaway integration cannot
starve another, and cookie sessions are unaffected by it. A breach throws
`RateLimitedError`, which `toErrorResponse` renders as **429 + `Retry-After`**.

## 4. Idempotency (AI-03)

`src/lib/idempotency.ts` implements `Idempotency-Key` for mutating requests:
first request runs and its status/body are remembered; the same key with the same
body replays that stored response (`Idempotency-Replayed: true`); the same key
with a **different** body is a **409**, a malformed key is a **400**, and a key
whose first request is still running is **425 + `Retry-After: 2`**. If the work
throws, the slot is released so a legitimate retry can run.

Storage is a short-TTL in-process map (default 1 h, capped at 500 entries), not a
database table — the same trade-off shape as the rate limiter: it covers retries
seconds-to-minutes after the original, it does not survive a restart or a second
replica. The header, the rules and a worked adoption snippet are in the module's
JSDoc. `POST /api/tokens` uses it today with a 5-minute window, because the
replayed body contains a secret.

## 5. Security events (MF-02)

`src/lib/security-events.ts` writes **one JSON object per line** to
`console.warn` (stderr, so `docker logs` / Coolify captures it):

```json
{"evt":"login.failed","at":"2026-10-08T09:00:00.000Z","actor":"admin","ip":"203.0.113.7","detail":"invalid_credentials"}
```

The shape is fixed (`evt`, `at`, `actor`, `ip`, `detail`; unused fields are
`null`), and `detail` accepts a short reason string or a flat object of
primitives. Emitted kinds: `login.failed`, `login.rate_limited`, `token.rejected`,
`token.revoked`, `token.expired`, `token.rate_limited`, `token.created`,
`token.revoked_by_operator`, `token.mint_denied`, `idempotency.conflict`.

Redaction is enforced in code, not by convention: sensitive key names
(`password`, `tokenHash`, `authorization`, `cookie`, `secret`, …) are replaced,
`Bearer …` / `password=…` fragments are masked, long hex runs and any
`gid_<40 hex>` token material become `[redacted]`, values are length-capped, and
`logSecurityEvent` swallows its own failures so logging can never change an
authentication decision. Full request headers are never logged. `ip` comes from
`X-Forwarded-For`, which a caller can forge: it is a diagnostic and a limiter key,
never an authorisation input.

## 6. Transport / platform headers

From `next.config.ts` on every response: `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy: camera=(), microphone=(), geolocation=()`, a CSP
(`default-src 'self'`, `object-src 'none'`, `base-uri 'self'`,
`frame-ancestors 'none'`; `unsafe-inline` for styles and hydration scripts,
`unsafe-eval` in development only), and `Strict-Transport-Security` in production.

## 7. Known gaps left open on purpose

Rewritten during the 2026-10-09 re-audit because four of its bullets had gone
stale while the section still claimed them — which is worse than an open gap.

- No CSRF tokens and no `Origin` allow-list (section 2).
- The limiter and idempotency stores are per-process; multi-replica deployments
  need a shared store.
- Token use is metered and logged, but there is no per-token route allow-list:
  a `write` token can reach every wired route.
- `POST /api/auth/logout` calls `requireAuth()` without forwarding the `Request`,
  so it is cookie-only. Deliberate: a Bearer token is scoped to the machine that
  owns it and must not be able to revoke the browser session it was minted from.
- `docs/openapi.yaml` generates object schemas with `additionalProperties: false`
  while the routes use zod's default object behaviour (unknown keys ignored, not
  rejected). The spec states this in its `info.description`; tightening it would
  break existing clients, so it is documented rather than fixed.

Closed since the original writing, and now gated: `withIdempotency(...)` wraps the
POSTs on jobs, projects, tasks, breaks, `breaks/log`, attendance and tokens;
`/api/tokens` and `/api/admin/events` are in the generated contract, so
`npm run docs:openapi:check` proves them (21 paths).

## 8. Dependency advisories (SEC-01) — remediated as far as the runtime allows, measured, reported every run

This section used to say that none of the advisories had "a fix that can be taken
without breaking the product". **That was wrong, and the 2026-10-10 re-audit caught
it**: the claim had been measured against `npm audit fix --force` (which does offer
only the breaking downgrades) and then written as if it described `npm audit fix`.
The non-major path was there all along and is now taken:

| | runtime tree (`--omit=dev`) | full tree (`--include=dev`) |
| --- | --- | --- |
| before, at `2f1dd67` | 31 (9 moderate, 22 high) | 43 (1 low, 13 moderate, 29 high) |
| after | **20 (7 moderate, 13 high)** | **26 (1 low, 7 moderate, 18 high)** |

Same-major upgrades applied by `npm audit fix`: `prisma` 7.5.0 → **7.10.0**,
`puppeteer`/`puppeteer-core` 24.40.0 → **24.43.1**, `@tiptap/*` 3.21.0 → **3.31.4**,
`prosemirror-view` 1.41.7 → **1.42.6** (above the 1.42.3 paste-handling fix the old
text had argued was impractical rather than available), plus `ws`, `lodash`,
`effect`, `dompurify`, `valibot` and the `@prisma/*` chain. `package.json`'s declared
ranges did not move; only the lockfile did.

Two consequences had to be handled in code or config, not prose:

- **`prisma@7.10.0` could not simply be taken — at the Node 20 floor this project ran
  then.** Its newer `@prisma/dev` depends on `@prisma/streams-local`, and *every*
  published version of that package declares `engines.node >=22.0.0` — including the one
  before it. On the Node 20.19.2 that the digest-pinned image and CI ran,
  `.npmrc`'s `engine-strict=true` turned that into a refusal at install time (RA-09's
  whole point). The fix was an `overrides` entry pinning `@prisma/dev` back to `0.20.0` —
  the version this project already shipped with, which does not pull that package.
  `@prisma/dev` backs the `prisma dev` command, which this product never invokes; the
  sweep over every installed `package.json` reported 0 ranges excluding the shipped
  runtime. The floor has since moved to `>=22.12.0` (SEC-01 fix round 2, below), which
  removes the *reason* for that pin; the pin stays because it is the version the product
  was verified against, and dropping it is an upgrade in its own right, not a cleanup.
- **`puppeteer@24.43.1` removed `networkidle0`** from `setContent`'s `waitUntil`
  union, which `npm run typecheck` caught in `src/lib/pdf-render.ts`. It now waits for
  `load`: for a document handed over whole by `setContent()`, `load` already means
  every referenced resource has finished, so the idle window was waiting for nothing.
  The unit test that pins that call was updated with it.

What genuinely remains needs a semver-major and is accepted with rationale — npm's own
`fixAvailable` data now says so per package rather than being inferred:

### SEC-01 fix round 2: the runtime tree is empty

The pass above left 20 advisories in the runtime tree and argued the rest needed a
semver-major. It did — so the major was taken. Two changes, measured in order:

1. **`overrides` for four exactly-pinned leaves.** `chevrotain` pins `lodash@4.17.21`,
   `@prisma/config` pins `deepmerge-ts@7.1.5`, `prisma` pins `mysql2@3.15.3` and
   `@tailwindcss/typography` pins `postcss-selector-parser@6.0.10` — all exact, so
   `npm audit fix` could not move them and the top-level `lodash@4.18.1` was a *second*
   copy, not a fix. Pinning the four clears 12 advisories, including the whole Prisma
   chain (`prisma`, `@prisma/config`, `@prisma/dev`, `@mrleebo/prisma-ast`,
   `chevrotain`/`@chevrotain/*`). `deepmerge-ts` 7 → 8 and `postcss-selector-parser`
   6 → 7 are major bumps against an exact pin, so they are held by evidence rather than
   by trust: `prisma generate` on both schemas, the Tailwind build, and the full suite.
2. **`puppeteer` 24.43.1 → 25.13.0, and the Node floor with it.** The remaining 8 runtime
   advisories were all the Puppeteer chain (`@puppeteer/browsers`, `extract-zip`,
   `proxy-agent`, `pac-proxy-agent`, `get-uri`, `basic-ftp`), and the only remedy npm
   reports is the 25 line. `@puppeteer/browsers@3.2.4` no longer depends on `extract-zip`
   or `proxy-agent` at all — measured by resolving the installed tree, where
   `node_modules/extract-zip` is now absent rather than newer. Puppeteer is a *runtime*
   dependency (the PDF export, `src/lib/pdf-render.ts`), so it cannot be moved to dev and
   counted as solved; and `puppeteer@25.13.0` declares `engines.node >= 22.12.0`, which
   the product's own floor had to follow.

| | runtime tree (`--omit=dev`) | full tree (`--include=dev`) |
| --- | --- | --- |
| before this round | 20 (7 moderate, 13 high) | 26 (1 low, 7 moderate, 18 high) |
| after the four overrides | 8 (8 high) | 14 (1 low, 13 high) |
| after `puppeteer@25.13.0` | **0** | **6 (1 low, 5 high)** |

The Node floor is `>=22.12.0` in `package.json`, `node:22-alpine3.23`
(`@sha256:baf676f7…`, reports `v22.23.3`) in the Dockerfile, `node-version: "22"` in all
three CI jobs, and the apk pins moved with the base as SEC-14 requires:
`python3=3.12.15-r0 make=4.4.1-r3 g++=15.2.0-r2`, `curl=8.22.0-r0`,
`chromium=149.0.7827.53-r0` — each read from `apk policy` inside the pinned image rather
than guessed. `npm run engines:check` sweeps 1261 installed manifests, 426 of which
declare `engines.node`, and reports 0 that exclude either 22.23.3 or 24.18.0.

What is left is dev-only and has no upstream fix to take:

- **The ESLint/Next lint chain** (`eslint-config-next`, `@next/eslint-plugin-next`,
  `fast-glob`, `micromatch`, `braces`) — 5 High. `eslint-config-next` is already at
  `16.4.0`, matching `next@16.4.0`; the version npm's `fixAvailable` proposes is
  **14.2.35**, a two-major downgrade that would lint against a different Next than the
  one that builds. `braces`/`fast-glob`/`micromatch` are flagged with `*` / `>=0.2.0`,
  i.e. every published version: an unbounded-recursion DoS in a glob matcher that, here,
  only ever sees patterns from `src/**` in a CI container. The remediation is upstream.
- **`esbuild`** (1 Low, dev-only): flagged across `0.27.3 - 0.28.0` for the *dev server*
  arbitrary-file-read issue, and the installed `0.27.4` is pinned by `tsx@4.21.0` and by
  `vitest → vite@8.3.4`, not by this project. `npm audit fix` was run and moved nothing
  (measured: version and count identical before and after), so the only route is a major
  in one of those two dev tools. The advisory's precondition — an esbuild dev server
  listening — is a code path neither `tsx` nor Vitest starts here.

Mitigating context that still applies to the browser itself: it loads only locally
generated report HTML through `page.setContent`, navigates to no remote origin, runs
`headless: true` with a 60-second protocol timeout, and runs inside a digest-pinned
Alpine image whose Chromium comes from that pinned base. The launch uses
`--no-sandbox`/`--disable-setuid-sandbox`, which is the honest trade-off for running
Chromium as the non-root `node` user in a container and is why an upstream Chromium
advisory here is treated as materially exploitable rather than academic.

One consequence of SEC-14's pinning is worth stating plainly: the base image is
digest-pinned (`node:22-alpine3.23@sha256:baf676f7…`) and Chromium is apk-pinned to
`149.0.7827.53-r0`, so the browser in the shipped image does **not** receive
security updates until the pins are deliberately moved. Reproducibility was
chosen over auto-updating; the price is that Chromium CVEs land here as a
reviewed maintenance task rather than as an automatic patch, and the `--disable-gpu`
PDF regression test plus a container smoke run are what make that review safe.
An earlier pass of this remediation considered moving the image to Node 22 and rejected
it *for a release cut*, because it re-pins the base digest and the apk Chromium version
together and both are what the PDF path is verified against. That objection was about
timing, not about the change: once the advisory work actually required the 25 line of
puppeteer, the move was made, both pins were re-read from the new image, and the PDF path
was re-verified on it rather than assumed (SEC-01 fix round 2, above).

What is being done instead of a fake green: CI reports both counts on every run
(`Dependency advisory posture (SEC-01)`, non-blocking by design so a new upstream
advisory is visible in the log rather than silently tolerated). The full-tree line asks
for `npm audit --include=dev` explicitly, because the quality job exports
`NODE_ENV=production` and npm then hides dev dependencies from a plain `npm audit` too
— the same trap that once hollowed out the whole toolchain install. Two gates now guard
the class rather than the individual case: the engines sweep over every installed
`package.json`, and `npm ci --include=dev` executed *inside the pinned base image*, so
an `engines` violation is caught as an install refusal on the runtime it applies to
instead of as a red build minutes later. That probe installs into the image's own
filesystem with the manifests mounted read-only rather than onto a bind mount: writing
`node_modules` back as the container's root leaves the CI runner unable to delete the
temp directory its own cleanup trap points at, and a host `/tmp` is not the daemon's
`/tmp`, so the source path has to be normalised before Git Bash can see the input at
all. Both were found by running the gate on two platforms instead of trusting one. The probe also
carries its own control case, re-run on this base: the same script with
`ENGINES_PROBE_IMAGE=node:20-alpine3.20` exits 1 with `npm error code EBADENGINE … Not
compatible with your version of node/npm: project-tasks-log@0.2.0`, while on `22-alpine3.23`
it prints `PROBE_EXIT=0`. The refusal moved from a single transitive fixture to the project
manifest itself now that `>=22.12.0` is the declared floor — which is the gate doing its job
on the thing it actually protects. So it is demonstrably a gate, not a formality.
Nothing in the runtime tree is left waiting on a major; what remains is the dev-only pair
named above, and its remedy is upstream. Any future major that does land — in `next`,
`@tiptap` or the Prisma chain — has to pass `npm run db:parity`, the export integration tests
and `npm run smoke:container` (which asserts the real PDF, on both providers) first.
The critical Next.js DoS advisory that the original audit found is genuinely gone:
`next@16.4.0` is above the fixed version.

