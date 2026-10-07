/**
 * AI-03: idempotency keys for mutating endpoints.
 *
 * An agent that retries a `POST /api/breaks/log` after a timeout must not log the
 * break twice. The client sends `Idempotency-Key: <client-generated uuid>`; the
 * first request runs and its response is remembered, any later request with the
 * same key and the same body gets the stored response replayed, and the same key
 * with a *different* body is rejected with 409 instead of silently doing new work.
 *
 * Storage: a short-TTL in-process Map, not a database table.
 * Why: the limiter in `src/lib/rate-limit.ts` already accepts this trade-off for
 * this deployment shape (one user, one container — see the Dockerfile/Coolify
 * setup), and it keeps the guarantee exactly where it matters — a retry within
 * seconds or minutes of the original. The costs are stated honestly:
 *   - a process restart (or a redeploy) clears the store, so a retry that arrives
 *     after a restart is treated as a new request;
 *   - it does not work across replicas. If this app ever runs more than one
 *     container, move the same `key -> {status, body}` map behind a `unique(key)`
 *     table or Redis and keep this module's public API unchanged.
 * Entries expire after `ttlMs` (default 1 h) and the store is capped at
 * `MAX_ENTRIES`, oldest-first, so a looping agent cannot grow memory without
 * bound.
 *
 * --- How to adopt in a route -----------------------------------------------
 * Wrap the work, after auth and rate limiting have already passed:
 *
 *   import { withIdempotency } from "@/lib/idempotency";
 *
 *   export async function POST(request: Request) {
 *     try {
 *       const context = await requireWriteAccess(request);   // or requireAuth(request)
 *       const parsed = breakLogSchema.safeParse(await request.json().catch(() => null));
 *       if (!parsed.success) {
 *         return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
 *       }
 *       return await withIdempotency(request, parsed.data, async () => {
 *         // ...the real work; return the route's normal NextResponse.json(...)
 *         return NextResponse.json({ ok: true }, { status: 201 });
 *       }, { actor: context.actor, ip: context.ip });
 *     } catch (error) {
 *       return toErrorResponse(error, "Unable to complete request.");
 *     }
 *   }
 *
 * Rules of the road:
 * - Only wrap mutating handlers (POST/PATCH/DELETE). GETs are already idempotent.
 * - Pass the *validated* payload as the second argument — that is what gets
 *   fingerprinted, so `Idempotency-Key` reuse with a different body is detected.
 * - Call it after the auth/rate-limit gates: a 401/429 must never be stored and
 *   replayed as if it had succeeded.
 * - A replay returns the original status and body plus `Idempotency-Replayed: true`.
 * - Responses that contain a secret (e.g. `POST /api/tokens`) live in this map for
 *   the whole TTL: pass a short `ttlMs` there, as that route does.
 * - If the wrapped work throws, the slot is released so a retry can run again
 *   rather than being stuck behind a failed first attempt.
 * ---------------------------------------------------------------------------
 */
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { logSecurityEvent } from "@/lib/security-events";

export const IDEMPOTENCY_HEADER = "Idempotency-Key";

const DEFAULT_TTL_MS = 60 * 60_000;
const MAX_ENTRIES = 500;
/** Keys are client-chosen: bound their length and character set before they become map keys. */
const KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

type StoredResponse = {
  fingerprint: string;
  status: number;
  body: unknown;
  expiresAt: number;
  inFlight: boolean;
};

const store = new Map<string, StoredResponse>();

let janitor: ReturnType<typeof setInterval> | undefined;
if (typeof setInterval !== "undefined") {
  janitor = setInterval(() => prune(Date.now()), 60_000);
  // Mirrors rate-limit.ts: housekeeping must never keep the process alive.
  (janitor as { unref?: () => void }).unref?.();
}

function prune(now: number): void {
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
  // Cap: evict the entries that expire soonest (i.e. were written first).
  if (store.size > MAX_ENTRIES) {
    const ordered = [...store.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    for (const [key] of ordered.slice(0, store.size - MAX_ENTRIES)) store.delete(key);
  }
}

/**
 * Canonical JSON (recursively sorted keys) so `{a:1,b:2}` and `{b:2,a:1}` get the
 * same fingerprint — the client's key ordering must not look like a new request.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key])}`);
  return `{${entries.join(",")}}`;
}

export function bodyFingerprint(payload: unknown): string {
  return createHash("sha256").update(canonicalize(payload), "utf8").digest("hex");
}

/** The validated key, `null` when the header is absent, or an error to answer with. */
export type KeyRead =
  | { present: false; key: null }
  | { present: true; valid: true; key: string }
  | { present: true; valid: false; reason: "format" };

export function readIdempotencyKey(request: Request): KeyRead {
  const raw = request.headers.get(IDEMPOTENCY_HEADER);
  if (raw === null || raw.trim() === "") return { present: false, key: null };
  const key = raw.trim();
  if (!KEY_PATTERN.test(key)) return { present: true, valid: false, reason: "format" };
  return { present: true, valid: true, key };
}

export type IdempotencyBegin =
  | { kind: "absent" }
  | { kind: "invalid"; response: NextResponse }
  | { kind: "replay"; response: NextResponse }
  | { kind: "conflict"; response: NextResponse }
  | { kind: "in-progress"; response: NextResponse }
  | { kind: "execute"; key: string; fingerprint: string };

/**
 * Low-level half of the API, for routes that cannot express their work as one
 * callback. `withIdempotency` below is the normal adoption path.
 */
export function beginIdempotency(
  request: Request,
  payload: unknown,
  options: { actor?: string | null; ip?: string | null } = {},
): IdempotencyBegin {
  const read = readIdempotencyKey(request);
  if (!read.present) return { kind: "absent" };
  if (!read.valid) {
    return {
      kind: "invalid",
      response: NextResponse.json(
        {
          error:
            "Idempotency-Key must be 16-128 characters of letters, digits, dash or underscore.",
        },
        { status: 400 },
      ),
    };
  }

  const now = Date.now();
  const fingerprint = bodyFingerprint(payload);
  const existing = store.get(read.key);

  if (existing && existing.expiresAt > now) {
    if (existing.fingerprint !== fingerprint) {
      // Same key, different body: one of the two callers is confused. Never
      // guess — refuse and let the client mint a fresh key.
      logSecurityEvent({
        evt: "idempotency.conflict",
        actor: options.actor ?? null,
        ip: options.ip ?? null,
        detail: { keyPrefix: read.key.slice(0, 8) },
      });
      return {
        kind: "conflict",
        response: NextResponse.json(
          { error: "Idempotency-Key was already used with a different request body." },
          { status: 409 },
        ),
      };
    }
    if (existing.inFlight) {
      return {
        kind: "in-progress",
        response: NextResponse.json(
          { error: "A request with this Idempotency-Key is still running." },
          { status: 425, headers: { "Retry-After": "2" } },
        ),
      };
    }
    return {
      kind: "replay",
      response: NextResponse.json(existing.body, {
        status: existing.status,
        headers: { "Idempotency-Replayed": "true", [IDEMPOTENCY_HEADER]: read.key },
      }),
    };
  }

  store.set(read.key, { fingerprint, status: 0, body: null, expiresAt: now + DEFAULT_TTL_MS, inFlight: true });
  prune(now);
  return { kind: "execute", key: read.key, fingerprint };
}

/**
 * Low-level counterpart of `withIdempotency` for routes that cannot express their
 * work as one callback: call `beginIdempotency`, do the work, then hand the
 * response and the body object it was built from to `rememberResponse`. Passing
 * the body explicitly avoids re-reading a response stream.
 */
export function rememberResponse(
  begin: Extract<IdempotencyBegin, { kind: "execute" }>,
  response: NextResponse,
  body: unknown,
  ttlMs: number = DEFAULT_TTL_MS,
): NextResponse {
  const entry = store.get(begin.key);
  if (entry) {
    entry.fingerprint = begin.fingerprint;
    entry.status = response.status;
    entry.body = body ?? null;
    entry.inFlight = false;
    entry.expiresAt = Date.now() + ttlMs;
  }
  response.headers.set(IDEMPOTENCY_HEADER, begin.key);
  return response;
}

/** Drop a slot after the work failed, so a legitimate retry is not blocked. */
export function releaseIdempotency(begin: Extract<IdempotencyBegin, { kind: "execute" }>): void {
  store.delete(begin.key);
}

export type IdempotencyOptions = {
  /** How long the replay window stays open. Shorten it for secret-bearing responses. */
  ttlMs?: number;
  actor?: string | null;
  ip?: string | null;
};

/**
 * Run `execute` exactly once per `Idempotency-Key` + body combination.
 * Without the header the call is a plain pass-through, so existing browser
 * traffic is completely unaffected.
 */
export async function withIdempotency(
  request: Request,
  payload: unknown,
  execute: () => NextResponse | Promise<NextResponse>,
  options: IdempotencyOptions = {},
): Promise<NextResponse> {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const begin = beginIdempotency(request, payload, { actor: options.actor, ip: options.ip });

  switch (begin.kind) {
    case "absent":
      return execute();
    case "invalid":
    case "replay":
    case "conflict":
    case "in-progress":
      return begin.response;
    case "execute": {
      try {
        const response = await execute();
        return await captureIntoStore(begin, response, ttlMs);
      } catch (error) {
        releaseIdempotency(begin);
        throw error;
      }
    }
  }
}

/**
 * NextResponse bodies are streams, so the object handed to `NextResponse.json`
 * is remembered alongside the response instead of being re-read from it. Routes
 * that need that behaviour should call `beginIdempotency` + `rememberResponse`.
 */
async function captureIntoStore(
  begin: Extract<IdempotencyBegin, { kind: "execute" }>,
  response: NextResponse,
  ttlMs: number,
): Promise<NextResponse> {
  const entry = store.get(begin.key);
  const text = await response.clone().text();
  let body: unknown = null;
  try {
    body = text === "" ? null : JSON.parse(text);
  } catch {
    body = text;
  }
  if (entry) {
    entry.fingerprint = begin.fingerprint;
    entry.status = response.status;
    entry.body = body;
    entry.inFlight = false;
    entry.expiresAt = Date.now() + ttlMs;
  }
  response.headers.set(IDEMPOTENCY_HEADER, begin.key);
  return response;
}

/** Test helper: clears every stored key. */
export function resetIdempotencyStore(): void {
  store.clear();
}
