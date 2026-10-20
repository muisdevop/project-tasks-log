import { HttpError } from "@/lib/api-error";

/**
 * RB-01: differentiated handling for database failures.
 *
 * Before this helper existed, every database problem — a locked SQLite file, a
 * Postgres container that is not up yet, a query that never returns — collapsed
 * into the same generic 500 string from each route's `catch`. That is the worst
 * possible answer for an operator *and* for an agent caller: a retryable outage
 * looked like a broken request, and nothing told the client how long to wait.
 *
 * Three separate concerns, kept honest about what is actually fixable:
 *
 * 1. BOUNDED WAITS. {@link withQueryTimeout} refuses to keep a request hanging
 *    forever. It is a truth-telling mechanism, not a magic one: better-sqlite3
 *    is synchronous and a JavaScript race cannot interrupt a statement that is
 *    already executing. What the deadline does buy is a *response* — the client
 *    stops holding an open request, the server logs which operation blew its
 *    budget, and the health probe keeps answering. The real cure for slow
 *    statements is what PF-01/PF-02/PF-04 did (indexes, bounded aggregations,
 *    capped export ranges, pagination); this is the safety net behind them.
 * 2. TRANSIENT-vs-PERMANENT. {@link isTransientDbError} recognises the errors
 *    that go away on their own (SQLITE_BUSY / "database is locked", connection
 *    refused/reset, Prisma P1001/P1002 engine connectivity). Reads that hit them
 *    get a couple of quick retries; writes never do, because a retried write
 *    without an idempotency key can double-apply (AI-03).
 * 3. A STATUS THE CLIENT CAN ACT ON. {@link DbUnavailableError} maps to 503 with
 *    `Retry-After`, and a deadline maps to 504, both through the single
 *    `toErrorResponse` boundary rather than ad-hoc strings in each route.
 */

/** Default deadline for a single database operation. */
export const DEFAULT_QUERY_TIMEOUT_MS = 8_000;
/** Floor/cap for the env override so a typo cannot disable the safety net. */
const MIN_QUERY_TIMEOUT_MS = 500;
const MAX_QUERY_TIMEOUT_MS = 30_000;

/**
 * `DB_QUERY_TIMEOUT_MS` overrides the default, clamped into a sane range.
 * Exported so tests (and the /api/health probe) can read the value actually in
 * force instead of re-deriving it.
 */
export function queryTimeoutMs(): number {
  const raw = Number(process.env.DB_QUERY_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_QUERY_TIMEOUT_MS;
  return Math.min(MAX_QUERY_TIMEOUT_MS, Math.max(MIN_QUERY_TIMEOUT_MS, Math.trunc(raw)));
}

/**
 * 503: the database is there but not answering right now — retry later.
 *
 * Extends HttpError (not a parallel hierarchy) so the existing route-boundary
 * mapping picks it up, and carries `retryAfterSeconds` structurally: this module
 * must not import api-error.ts for a class while api-error.ts recognises these
 * errors, because that pair of imports is a cycle whose classes resolve
 * half-initialised at load time.
 */
export class DbUnavailableError extends HttpError {
  readonly retryAfterSeconds: number;

  constructor(message = "Database temporarily unavailable. Please retry.", retryAfterSeconds = 2) {
    super(503, message);
    this.name = "DbUnavailableError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** 504: the operation exceeded its deadline. */
export class DbTimeoutError extends HttpError {
  constructor(label: string, budgetMs: number) {
    super(504, `The database query for ${label} exceeded its ${budgetMs}ms budget.`);
    this.name = "DbTimeoutError";
  }
}

/**
 * Codes Prisma reports when the *connection* failed rather than the statement:
 * P1001 can't reach the database, P1002 engine timed out, P1008 pool timeout,
 * P1017 connection lost. These are always safe to surface as 503.
 */
const CONNECTIVITY_ERROR_CODES = new Set(["P1001", "P1002", "P1008", "P1017"]);

/** Node-level syscall errors that mean "the socket did not work". */
const CONNECTIVITY_ERRNO = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
]);

/**
 * True for failures that a retry could clear. Deliberately narrow: an unknown
 * error is treated as permanent so we never silently re-run a broken statement.
 */
export function isTransientDbError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (typeof code === "string" && CONNECTIVITY_ERROR_CODES.has(code)) return true;
  const errno = (error as { errno?: string } | null)?.errno;
  if (typeof errno === "string" && CONNECTIVITY_ERRNO.has(errno)) return true;
  if (error instanceof DbUnavailableError) return true;

  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    /database is locked|database table is locked|SQLITE_BUSY|SQLITE_LOCKED/i.test(message) ||
    /connection terminated|server closed the connection|too many connections/i.test(message) ||
    /Can't reach database server/i.test(message)
  );
}

/** Turn any database failure into an error the route boundary can map. */
export function toDbHttpError(error: unknown): Error {
  if (error instanceof HttpError || error instanceof DbUnavailableError) return error as Error;
  if (isTransientDbError(error)) {
    console.error("[db] transient failure:", error instanceof Error ? error.message : error);
    return new DbUnavailableError();
  }
  return error instanceof Error ? error : new Error(String(error));
}

export type QueryTimeoutOptions = {
  /** Names the operation in the log and the 504 message. */
  label: string;
  /** Overrides {@link queryTimeoutMs} — use for the deliberately heavy paths. */
  timeoutMs?: number;
};

/**
 * Run a database operation under a deadline. `operation` is a thunk (not a
 * promise) so retries get a fresh statement instead of an already-settled one.
 *
 * On expiry we reject with {@link DbTimeoutError} (504) and log the label
 * server-side; the underlying statement is left to finish on its own, which is
 * the honest limitation described at the top of this file.
 */
export async function withQueryTimeout<T>(
  operation: () => Promise<T>,
  { label, timeoutMs }: QueryTimeoutOptions,
): Promise<T> {
  const budget = timeoutMs ?? queryTimeoutMs();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<T>((resolve, reject) => {
      timer = setTimeout(() => {
        console.error(`[db] ${label} exceeded its ${budget}ms budget`);
        reject(new DbTimeoutError(label, budget));
      }, budget);
      operation().then(resolve, reject);
    });
  } catch (error) {
    throw toDbHttpError(error);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type ReadRetryOptions = QueryTimeoutOptions & {
  /** Total attempts, including the first. */
  attempts?: number;
  /** First backoff step; doubles each attempt. */
  baseDelayMs?: number;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A read-only query with a deadline and bounded retries on transient failures.
 *
 * Reads only — a write retry needs the `Idempotency-Key` replay guarantee from
 * src/lib/idempotency.ts, and not every route has adopted it yet.
 */
export async function withReadRetry<T>(
  operation: () => Promise<T>,
  { label, timeoutMs, attempts = 3, baseDelayMs = 60 }: ReadRetryOptions,
): Promise<T> {
  const budget = timeoutMs ?? queryTimeoutMs();
  // Split the deadline so the retries cannot collectively exceed it.
  const perAttemptMs = Math.max(250, Math.floor(budget / Math.max(1, attempts)));
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await withQueryTimeout(operation, { label, timeoutMs: perAttemptMs });
    } catch (error) {
      lastError = error;
      const retryable = isTransientDbError(error) || error instanceof DbTimeoutError;
      if (!retryable || attempt === attempts) break;
      await delay(baseDelayMs * 2 ** (attempt - 1));
    }
  }

  throw toDbHttpError(lastError);
}

/**
 * Classify a failure for logging/metrics without ever leaking SQL or
 * credentials into a response body (SEC-13 keeps the mapping in api-error.ts).
 */
export function describeDbFailure(error: unknown): {
  kind: "timeout" | "unavailable" | "conflict" | "not-found" | "unknown";
  code?: string;
} {
  if (error instanceof DbTimeoutError) return { kind: "timeout" };
  if (error instanceof DbUnavailableError || isTransientDbError(error)) return { kind: "unavailable" };
  const code = (error as { code?: string } | null)?.code;
  if (code === "P2002") return { kind: "conflict", code };
  if (code === "P2025") return { kind: "not-found", code };
  return { kind: "unknown", code };
}
