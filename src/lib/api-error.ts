import { NextResponse } from "next/server";
import { UnauthorizedError } from "@/lib/auth";

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
 * - HttpError         -> its status with the safe message
 * - everything else   -> 500 with a static message.
 *
 * Internal details are logged server-side only (SEC-13).
 */
export function toErrorResponse(error: unknown, fallbackMessage = "Internal server error.") {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error(`[api] ${fallbackMessage}`, error);
  return NextResponse.json({ error: fallbackMessage }, { status: 500 });
}
