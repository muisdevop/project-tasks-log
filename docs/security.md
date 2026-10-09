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

## 8. Dependency advisories (SEC-01) — accepted, measured, and reported every run

`npm audit --omit=dev` on the `0.2.0` tip reports **32 advisories in the runtime
tree (9 moderate, 23 high)**; the full tree including dev tooling reports 44.
None has a fix that can be taken without breaking the product, so they are
recorded here rather than "resolved" by a downgrade nobody reviewed:

- **The Prisma 7 chain dominates** (`prisma`, `@prisma/config`, `@prisma/dev`,
  `@mrleebo/prisma-ast`, `chevrotain`/`@chevrotain/*`, `deepmerge-ts`, `effect`,
  `valibot`, `lodash`, `mysql2`, `hono`/`@hono/node-server`). npm's proposed fix
  is a **semver-major downgrade to `prisma@6.19.3`**, which removes driver-adapter
  support and breaks the dual SQLite/Postgres schema setup and `npm run db:parity`
  — a worse security posture, not a better one.
- **The Puppeteer chain** (`puppeteer`, `puppeteer-core`, `@puppeteer/browsers`,
  `extract-zip`) needs `puppeteer@25`, another major. Mitigating context: the
  browser loads only locally generated report HTML through `page.setContent`,
  navigates to no remote origin, runs `headless: true` with a 60-second protocol
  timeout, and it runs inside a digest-pinned Alpine image whose Chromium package
  comes from that pinned base. The launch uses
  `--no-sandbox`/`--disable-setuid-sandbox`, which is the honest trade-off for
  running Chromium as the non-root `node` user in a container and is why an
  upstream Chromium advisory here is treated as materially exploitable rather
  than academic.
- **The rich-text chain** (`@tiptap/*`, `prosemirror-view`, `markdown-it`,
  `linkify-it`, `dompurify`, `js-yaml`, `undici`, `ws`, `ip-address`, `basic-ftp`,
  `defu`, `source-map-js`) is largely transitive under `@tiptap@3`. Note
  `prosemirror-view <1.42.3` (paste-handling XSS): this app sanitises note HTML
  with `isomorphic-dompurify` before it is stored or rendered, and the editor is
  driven by the authenticated operator's own paste, so the practical exposure is
  self-XSS in a single-user tool — not the multi-user stored-XSS the advisory
  assumes.

One consequence of SEC-14's pinning is worth stating plainly: the base image is
digest-pinned (`node:20-alpine3.20@sha256:3bc9a4…`) and Chromium is apk-pinned to
`131.0.6778.108-r0`, so the browser in the shipped image does **not** receive
security updates until the pins are deliberately moved. Reproducibility was
chosen over auto-updating; the price is that Chromium CVEs land here as a
reviewed maintenance task rather than as an automatic patch, and the `--disable-gpu`
PDF regression test plus a container smoke run are what make that review safe.

What is being done instead of a fake green: CI reports both counts on every run
(`Dependency advisory posture (SEC-01)`, non-blocking by design so a new
upstream advisory is visible in the log rather than silently tolerated). The
full-tree line asks for `npm audit --include=dev` explicitly, because the
quality job exports `NODE_ENV=production` and npm then hides dev dependencies
from a plain `npm audit` too — the same trap that once hollowed out the whole
toolchain install. The upgrade itself is a scheduled work item — `prisma` 7.x
patch line, then `puppeteer` 25, then `@tiptap` — each requiring
`npm run db:parity`, the export integration tests and
`npm run smoke:container` (which asserts the real PDF) to pass before it lands.
The critical Next.js DoS advisory that the original audit found is genuinely
gone: `next@16.4.0` is above the fixed version.
