import { NextResponse } from "next/server";
import { createSession } from "@/lib/session";
import { AuthNotConfiguredError, validateLogin } from "@/lib/auth";
import { loginSchema } from "@/lib/validators";
import { checkRateLimit, clientIp, RATE_LIMIT_PRESETS } from "@/lib/rate-limit";
import { logSecurityEvent } from "@/lib/security-events";
import { prisma } from "@/lib/prisma";

const { limit: LOGIN_LIMIT, windowMs: LOGIN_WINDOW_MS } = RATE_LIMIT_PRESETS.login;

export async function POST(request: Request) {
  const ip = clientIp(request);
  const limited = checkRateLimit(`login:${ip}`, LOGIN_LIMIT, LOGIN_WINDOW_MS);
  if (!limited.ok) {
    // MF-02: rate-limit hits are security events, not just responses.
    logSecurityEvent({ evt: "login.rate_limited", ip, detail: { retryAfterSeconds: limited.retryAfterSeconds } });
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
        // Structured instead of the old prose warn (MF-02): the attempted
        // username is diagnostic, the password never appears in the event.
        logSecurityEvent({
          evt: "login.failed",
          actor: parsed.data.username,
          ip,
          detail: "invalid_credentials",
        });
        return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
      }
    } catch (error) {
      if (error instanceof AuthNotConfiguredError) {
        logSecurityEvent({
          evt: "login.failed",
          actor: parsed.data.username,
          ip,
          detail: "no_credential_source_configured",
        });
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
