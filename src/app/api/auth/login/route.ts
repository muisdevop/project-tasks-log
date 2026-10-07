import { NextResponse } from "next/server";
import { createSession } from "@/lib/session";
import { AuthNotConfiguredError, validateLogin } from "@/lib/auth";
import { loginSchema } from "@/lib/validators";
import { checkRateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";

const LOGIN_LIMIT = 5;
const LOGIN_WINDOW_MS = 5 * 60_000;

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return "unknown";
}

export async function POST(request: Request) {
  const ip = clientIp(request);
  const limited = checkRateLimit(`login:${ip}`, LOGIN_LIMIT, LOGIN_WINDOW_MS);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many login attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
    );
  }

  try {
    const json = await request.json();
    const parsed = loginSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    try {
      const ok = await validateLogin(parsed.data.username, parsed.data.password);
      if (!ok) {
        console.warn(`[auth] Failed login attempt for user '${parsed.data.username}' from ${ip}`);
        return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
      }
    } catch (error) {
      if (error instanceof AuthNotConfiguredError) {
        console.error("[auth] Login attempted but no credentials are configured.");
        return NextResponse.json(
          { error: "Login is not configured. Set APP_PASSWORD_HASH (see scripts/hash-password) or APP_PASSWORD." },
          { status: 500 },
        );
      }
      throw error;
    }

    const settings = await prisma.userSettings.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1 },
      select: { tokenVersion: true },
    });
    await createSession(parsed.data.username, settings.tokenVersion);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json({ error: "Unable to login." }, { status: 500 });
  }
}
