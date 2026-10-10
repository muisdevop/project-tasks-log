/**
 * MF-04: one structured JSON line per API request.
 *
 * Before this existed the only way to answer "what did the app just do?" was to
 * read prose `console.log` output, and a failed request left no trace at all.
 * Every route handler that has adopted `withRequestLogging` emits exactly one
 * machine-parsable line per call, so `docker logs` / a Coolify log drain can
 * filter it the same way as the security events in `src/lib/security-events.ts`:
 *
 *   {"evt":"api.request","at":"2026-10-08T09:00:00.000Z","rid":"9f3c…","method":"POST","path":"/api/breaks/log","status":201,"ms":12,"actor":"admin","via":"token","ip":"10.0.0.5"}
 *
 * Design notes:
 * - Wrapper, not middleware. Next.js' proxy layer (`src/proxy.ts`) only ever
 *   sees its own `NextResponse.next()` continuation, never the status the route
 *   handler finally returned, so request logging cannot live there. Each route
 *   calls `withRequestLogging` around its own body instead — a one-line change
 *   per handler that also leaves the handler's error mapping untouched.
 * - Redaction is inherited, not re-invented: `actor`, `ip` and `path` go through
 *   the same `redact()` used by security events, and only the URL *pathname* is
 *   logged (never the query string, which can carry ids, tokens or a payload
 *   fragment). Values are length-capped so a hostile path cannot grow a line.
 * - Logging is fire-and-forget and must never change an outcome: emitting is
 *   wrapped in try/catch, mirroring `logSecurityEvent`.
 * - The `X-Request-Id` response header ties a client-visible failure back to the
 *   line in the log; agents are told to send it in bug reports (see the
 *   "AI agent integration" section of docs/openapi.yaml).
 */
import { randomBytes } from "node:crypto";
import { clientIp } from "@/lib/rate-limit";
import { redact } from "@/lib/security-events";

/** Header carrying the correlation id on both the response and (optionally) the request. */
export const REQUEST_ID_HEADER = "X-Request-Id";

const MAX_FIELD_CHARS = 160;
const LOG_EVENT = "api.request";

/** How the caller authenticated, as observed from the request's own credentials. */
export type RequestVia = "session" | "token" | "anonymous";

export type RequestLogInput = {
  rid: string;
  method: string;
  path: string;
  status: number;
  ms: number;
  actor: string | null;
  via: RequestVia;
  ip: string;
};

export type RequestLogLine = {
  evt: typeof LOG_EVENT;
  at: string;
  rid: string;
  method: string;
  path: string;
  status: number;
  ms: number;
  actor: string | null;
  via: RequestVia;
  ip: string;
};

/** Mutable per-request scratch pad handed to the wrapped handler. */
export type RequestLogContext = {
  /** Correlation id for this call; also written to `X-Request-Id`. */
  readonly requestId: string;
  /** Resolved actor/via once the route's own auth guard has run. */
  identify(actor: string | null, via: RequestVia): void;
  readonly actor: string | null;
  readonly via: RequestVia;
};

/**
 * Short, URL-safe and collision-resistant enough for one container's log
 * stream. Not a UUID on purpose: the id appears in a header and in prose, and 16
 * hex chars are easier to read aloud in a bug report than 36.
 */
export function generateRequestId(): string {
  return randomBytes(8).toString("hex");
}

/**
 * Credential *shape* only — this never decides whether the caller is valid, it
 * labels the log line. A route that has already authenticated should overwrite
 * the guess with `ctx.identify()` from its `AuthContext`.
 */
export function detectVia(request?: Request): RequestVia {
  if (!request) return "anonymous";
  const authorization = request.headers.get("authorization") ?? "";
  if (/^Bearer\s+\S+/i.test(authorization.trim())) return "token";
  if (request.headers.get("cookie")?.includes("stl_session=")) return "session";
  return "anonymous";
}

function clip(value: string): string {
  return redact(value).slice(0, MAX_FIELD_CHARS);
}

/** Pathname only: a query string can carry ids, dates or payload fragments. */
export function pathOf(request?: Request): string {
  if (!request) return "unknown";
  try {
    return clip(new URL(request.url).pathname);
  } catch {
    // A malformed `request.url` must not take the log line (or the request) down.
    return "unknown";
  }
}

/** Pure so the unit tests can assert the wire shape without a console spy. */
export function buildRequestLogLine(input: RequestLogInput, now: Date = new Date()): RequestLogLine {
  return {
    evt: LOG_EVENT,
    at: now.toISOString(),
    rid: clip(input.rid),
    method: clip(input.method || "UNKNOWN").toUpperCase(),
    path: clip(input.path),
    status: Number.isFinite(input.status) ? input.status : 0,
    ms: Number.isFinite(input.ms) ? Math.max(0, Math.round(input.ms)) : 0,
    actor: input.actor ? clip(String(input.actor)) : null,
    via: input.via,
    ip: clip(input.ip),
  };
}

/** Emits one JSON line to stdout. Never throws. */
export function logRequestLine(input: RequestLogInput): void {
  try {
    console.info(JSON.stringify(buildRequestLogLine(input)));
  } catch {
    // A broken logger must not fail a request that already succeeded.
  }
}

function create(request: Request | undefined, requestId: string): RequestLogContext {
  let actor: string | null = null;
  let via = detectVia(request);
  return {
    requestId,
    get actor() {
      return actor;
    },
    get via() {
      return via;
    },
    identify(nextActor: string | null, nextVia: RequestVia) {
      actor = nextActor;
      via = nextVia;
    },
  };
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/**
 * Run a route handler and emit its request log line.
 *
 * The wrapped handler keeps owning its status codes — this only observes them,
 * stamps `X-Request-Id` and times the call. A handler that throws is logged as a
 * 500 and the error is rethrown unchanged, so the route's own
 * `toErrorResponse` mapping still wins when it catches closer to the inside.
 *
 * `request` is optional because some list handlers are still callable without
 * one (their integration tests invoke `GET()` directly); with no request there
 * is nothing to attribute, so the call is a plain pass-through.
 */
export async function withRequestLogging(
  request: Request | undefined,
  handler: (log: RequestLogContext) => Response | Promise<Response>,
): Promise<Response> {
  // Honour a caller-supplied id when present so an agent can correlate its own
  // retries; anything odd (too long, non-token characters) falls back to fresh.
  const provided = request?.headers.get(REQUEST_ID_HEADER)?.trim() ?? "";
  const requestId = /^[A-Za-z0-9_-]{8,64}$/.test(provided) ? provided : generateRequestId();
  if (!request) {
    return handler(create(undefined, requestId));
  }

  const log = create(request, requestId);
  const startedAt = nowMs();
  let status = 500;
  try {
    const response = await handler(log);
    status = response.status;
    try {
      response.headers.set(REQUEST_ID_HEADER, requestId);
    } catch {
      // Some responses (e.g. static ones) expose immutable headers; the log line
      // still carries the id, so losing the header is cosmetic, never fatal.
    }
    return response;
  } finally {
    logRequestLine({
      rid: requestId,
      method: request.method,
      path: pathOf(request),
      status,
      ms: nowMs() - startedAt,
      actor: log.actor,
      via: log.via,
      ip: clientIp(request),
    });
  }
}
