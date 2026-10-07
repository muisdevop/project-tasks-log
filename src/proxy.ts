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

/**
 * Sends the visitor to the login page while remembering where they were headed
 * (UX-05). Only same-site relative paths are forwarded, and the login page is
 * never echoed back as a `next` target.
 */
function redirectToLogin(request: NextRequest): NextResponse {
  const loginUrl = new URL("/login", request.url);
  const { pathname, search } = request.nextUrl;
  const target = `${pathname}${search}`;
  if (target !== "/" && !pathname.startsWith("/login")) {
    loginUrl.searchParams.set("next", target);
  }
  return NextResponse.redirect(loginUrl);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (publicPaths.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  // AI-02: agent callers present `Authorization: Bearer <token>` and have no
  // cookie, so redirecting them to the HTML login page would make the API
  // unreachable for machines. Pass those requests to the route handler, where
  // `authenticate()` verifies the digest (and answers 401/403/429 as JSON).
  // Cookies are never consulted on this branch.
  const authorization = request.headers.get("authorization") ?? "";
  if (pathname.startsWith("/api/") && /^Bearer\s+\S+/i.test(authorization)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    return redirectToLogin(request);
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
    return redirectToLogin(request);
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
