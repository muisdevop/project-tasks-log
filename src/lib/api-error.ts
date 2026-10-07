import { NextResponse } from "next/server";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth";
import { RateLimitedError } from "@/lib/rate-limit";

/**
 * Application-level HTTP error carrying a response status. Throw from service
 * code (including inside prisma.$transaction callbacks) and map once at the
 * route boundary with toErrorResponse.
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * Maps thrown errors to consistent API responses:
 * - UnauthorizedError -> 401
 * - ForbiddenError    -> 403 (authenticated, wrong scope / wrong credential kind)
 * - RateLimitedError  -> 429 with `Retry-After` (AI-03 agent-loop guard)
 * - HttpError         -> its status with the safe message, plus `Retry-After`
 *                        when the error knows its backoff (RB-01: 503 database
 *                        unavailable, 504 query deadline)
 * - HttpError         -> its status with the safe message
 * - everything else   -> 500 with a static message.
 *
 * Internal details are logged server-side only (SEC-13).
 */
export function toErrorResponse(error: unknown, fallbackMessage = "Internal server error.") {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof RateLimitedError) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } },
    );
  }
  if (error instanceof HttpError) {
    // RB-01: a 503 DbUnavailableError (and anything else that knows how long to
    // wait) carries `retryAfterSeconds` structurally, so the client gets a
    // machine-readable backoff instead of a bare status. Checked by shape rather
    // than `instanceof` to keep this module free of an import cycle with
    // src/lib/db-resilience.ts.
    const retryAfter = (error as { retryAfterSeconds?: unknown }).retryAfterSeconds;
    const headers =
      typeof retryAfter === "number" && retryAfter > 0
        ? { headers: { "Retry-After": String(Math.ceil(retryAfter)) } }
        : undefined;
    return NextResponse.json({ error: error.message }, { status: error.status, ...headers });
  }
  console.error(`[api] ${fallbackMessage}`, error);
  return NextResponse.json({ error: fallbackMessage }, { status: 500 });
}
