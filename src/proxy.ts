import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const COOKIE_NAME = "stl_session";

function getSecret(): Uint8Array | null {
  const value = process.env.SESSION_SECRET;
  // Mirror session.ts: never fall back to a guessable secret. Fail closed instead.
  if (!value || value.length < 16) {
    return null;
  }
  return new TextEncoder().encode(value);
}

const publicPaths = ["/login", "/api/auth/login", "/api/health", "/_next", "/favicon.ico"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (publicPaths.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const secret = getSecret();
  if (!secret) {
    console.error("SESSION_SECRET must be set and at least 16 characters.");
    return NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    await jwtVerify(token, secret);
    return NextResponse.next();
  } catch {
    return NextResponse.redirect(new URL("/login", request.url));
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
