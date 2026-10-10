/**
 * AI-02 / AI-03 unit coverage for the credential resolution order in
 * `requireAuth`/`authenticate`, token scoping and the token rate limits.
 * The database and the session cookie layer are stubbed here; the real
 * end-to-end behaviour of the token routes is in
 * tests/integration/api-tokens.test.ts.
 */
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaStub = vi.hoisted(() => ({
  apiToken: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn(), findMany: vi.fn() },
  userSettings: { findUnique: vi.fn(), upsert: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaStub }));

const sessionStub = vi.hoisted(() => ({ getSessionUsername: vi.fn() }));
vi.mock("@/lib/session", () => ({ getSessionUsername: sessionStub.getSessionUsername }));

const TOKEN = `gid_${"1".repeat(40)}`;
const TOKEN_HASH = createHash("sha256").update(TOKEN, "utf8").digest("hex");

async function loadAuth() {
  vi.resetModules();
  const [auth, rate, tokens] = await Promise.all([
    import("@/lib/auth"),
    import("@/lib/rate-limit"),
    import("@/lib/api-tokens"),
  ]);
  rate.resetRateLimits();
  tokens.resetTokenTouchThrottle();
  return { auth, rate, tokens };
}

function tokenRequest(fill = "1", ip = "10.0.0.1"): Request {
  return new Request("http://localhost/api/settings", {
    headers: { authorization: `Bearer gid_${fill.repeat(40)}`, "x-forwarded-for": ip },
  });
}

/** The security lines emitted through console.warn, newest first available. */
function loggedLines(): string[] {
  const warn = console.warn as unknown as { mock?: { calls: unknown[][] } };
  return (warn.mock?.calls ?? []).map((call) => String(call[0]));
}

function lastLoggedLine(): string {
  const lines = loggedLines();
  return lines.at(-1) ?? "{}";
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 3,
    tokenHash: TOKEN_HASH,
    name: "ops-agent",
    scope: "read",
    createdAt: new Date("2026-10-08T09:00:00.000Z"),
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  prismaStub.apiToken.findUnique.mockReset().mockResolvedValue(null);
  prismaStub.apiToken.update.mockReset().mockResolvedValue(row());
  prismaStub.userSettings.findUnique.mockReset().mockResolvedValue({ tokenVersion: 1 });
  sessionStub.getSessionUsername.mockReset().mockResolvedValue(null);
  vi.stubEnv("APP_USERNAME", "admin");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("authenticate resolution order", () => {
  it("cookie path is untouched when no Request is forwarded", async () => {
    sessionStub.getSessionUsername.mockResolvedValue("admin");
    const { auth } = await loadAuth();
    await expect(auth.requireAuth()).resolves.toBe("admin");
    const ctx = await auth.authenticate();
    expect(ctx).toMatchObject({ actor: "admin", via: "session", scope: "write", tokenId: null });
  });

  it("prefers the Bearer credential over a session cookie on the same request", async () => {
    sessionStub.getSessionUsername.mockResolvedValue("admin");
    prismaStub.apiToken.findUnique.mockResolvedValue(row({ scope: "read" }));
    const { auth } = await loadAuth();

    const ctx = await auth.authenticate(tokenRequest());
    expect(ctx).toMatchObject({ via: "token", scope: "read", tokenId: 3, actor: "admin", ip: "10.0.0.1" });
    // The digest lookup, not the cookie jar, decided this.
    expect(prismaStub.apiToken.findUnique).toHaveBeenCalledWith({ where: { tokenHash: TOKEN_HASH } });
  });

  it("ignores a non-Bearer Authorization scheme and falls back to the cookie", async () => {
    sessionStub.getSessionUsername.mockResolvedValue("admin");
    const { auth } = await loadAuth();
    const basic = new Request("http://localhost/api/settings", {
      headers: { authorization: `Basic ${TOKEN}` },
    });
    const ctx = await auth.authenticate(basic);
    expect(ctx?.via).toBe("session");
    expect(prismaStub.apiToken.findUnique).not.toHaveBeenCalled();
  });

  it("401s on an unknown token even with a valid cookie absent", async () => {
    const { auth } = await loadAuth();
    await expect(auth.requireAuth(tokenRequest("2"))).rejects.toBeInstanceOf(auth.UnauthorizedError);
  });

  it("401s on a revoked or expired token and records which", async () => {
    const { auth } = await loadAuth();
    prismaStub.apiToken.findUnique.mockResolvedValue(row({ revokedAt: new Date("2026-10-08T10:00:00Z") }));
    await expect(auth.requireAuth(tokenRequest())).rejects.toBeInstanceOf(auth.UnauthorizedError);
    let evt = JSON.parse(lastLoggedLine());
    expect(evt.evt).toBe("token.revoked");

    prismaStub.apiToken.findUnique.mockResolvedValue(row({ expiresAt: new Date(Date.now() - 1_000) }));
    await expect(auth.requireAuth(tokenRequest())).rejects.toBeInstanceOf(auth.UnauthorizedError);
    evt = JSON.parse(lastLoggedLine());
    expect(evt.evt).toBe("token.expired");
  });

  it("never leaks the token through requireAuth's return value", async () => {
    prismaStub.apiToken.findUnique.mockResolvedValue(row({ scope: "write" }));
    const { auth } = await loadAuth();
    const actor = await auth.requireAuth(tokenRequest());
    expect(actor).toBe("admin");
    expect(JSON.stringify(loggedLines())).not.toContain(TOKEN);
  });
});

describe("scope enforcement", () => {
  it("requireWriteAccess refuses a read token with 403", async () => {
    prismaStub.apiToken.findUnique.mockResolvedValue(row({ scope: "read" }));
    const { auth } = await loadAuth();
    await expect(auth.requireWriteAccess(tokenRequest())).rejects.toBeInstanceOf(auth.ForbiddenError);
    await expect(auth.requireWriteAccess(tokenRequest())).rejects.toThrow(/read-only/);
  });

  it("requireWriteAccess accepts a write token and a cookie session", async () => {
    prismaStub.apiToken.findUnique.mockResolvedValue(row({ scope: "write" }));
    const { auth } = await loadAuth();
    const ctx = await auth.requireWriteAccess(tokenRequest());
    expect(ctx.scope).toBe("write");

    sessionStub.getSessionUsername.mockResolvedValue("admin");
    await expect(auth.requireWriteAccess()).resolves.toMatchObject({ via: "session" });
  });

  it("requireSessionAuth refuses any token credential on the token manager", async () => {
    prismaStub.apiToken.findUnique.mockResolvedValue(row({ scope: "write" }));
    const { auth } = await loadAuth();
    await expect(auth.requireSessionAuth(tokenRequest())).rejects.toBeInstanceOf(auth.ForbiddenError);
    const evt = JSON.parse(lastLoggedLine());
    expect(evt.evt).toBe("token.mint_denied");
    expect(evt.detail).toBe("token_used_on_session_only_route");
    // and a cookie session still works
    sessionStub.getSessionUsername.mockResolvedValue("admin");
    await expect(auth.requireSessionAuth(new Request("http://localhost/api/tokens"))).resolves.toBe("admin");
  });

  it("an un-prefixed or truncated scope string degrades to read, never write", async () => {
    prismaStub.apiToken.findUnique.mockResolvedValue(row({ scope: "supervisor" }));
    const { auth } = await loadAuth();
    const ctx = await auth.authenticate(tokenRequest());
    expect(ctx?.scope).toBe("read");
  });
});

describe("agent rate limits reached through authenticate", () => {
  it("blocks a looping token past its per-minute budget", async () => {
    prismaStub.apiToken.findUnique.mockResolvedValue(row({ scope: "read" }));
    const { auth, rate } = await loadAuth();
    const request = tokenRequest("1", "10.1.1.1");

    for (let i = 0; i < rate.RATE_LIMIT_PRESETS.api.limit; i += 1) {
      await expect(auth.authenticate(request)).resolves.toMatchObject({ via: "token" });
    }
    await expect(auth.authenticate(request)).rejects.toBeInstanceOf(rate.RateLimitedError);
    await expect(auth.authenticate(request)).rejects.toThrow(/Retry in/);
  });

  it("does not let one token exhaust another token's budget", async () => {
    const { auth, rate, tokens } = await loadAuth();
    const hashFor = (fill: string) =>
      createHash("sha256").update(`gid_${fill.repeat(40)}`, "utf8").digest("hex");

    // Token 1 is id 3, token 2 is id 4; both are otherwise valid.
    prismaStub.apiToken.findUnique.mockImplementation(
      async ({ where }: { where: { tokenHash: string } }) =>
        where.tokenHash === hashFor("2")
          ? row({ id: 4, tokenHash: hashFor("2") })
          : row({ tokenHash: hashFor("1") }),
    );

    for (let i = 0; i < rate.RATE_LIMIT_PRESETS.api.limit; i += 1) {
      await auth.authenticate(tokenRequest("1", "10.2.2.2"));
    }
    // Same IP, different token id: a separate bucket, so the loop cannot starve it.
    const other = await auth.authenticate(tokenRequest("2", "10.2.2.2"));
    expect(other).toMatchObject({ tokenId: 4 });
    expect(tokens.looksLikeApiToken(`gid_${"2".repeat(40)}`)).toBe(true);
    // ... while token 1 is now over its own budget.
    await expect(auth.authenticate(tokenRequest("1", "10.2.2.2"))).rejects.toBeInstanceOf(
      rate.RateLimitedError,
    );
  });

  it("escalates repeated token rejections from one IP to 429", async () => {
    const { auth, rate } = await loadAuth();
    prismaStub.apiToken.findUnique.mockResolvedValue(null);
    const request = tokenRequest("7", "10.3.3.3");

    for (let i = 0; i < 30; i += 1) {
      await expect(auth.authenticate(request)).resolves.toBeNull();
    }
    await expect(auth.authenticate(request)).rejects.toBeInstanceOf(rate.RateLimitedError);
    const evt = JSON.parse(lastLoggedLine());
    expect(evt.evt).toBe("token.rate_limited");
    expect(JSON.stringify(evt)).not.toContain(`gid_${"7".repeat(40)}`);
  });

  it("a rejected credential from one IP does not throttle a different IP", async () => {
    const { auth } = await loadAuth();
    prismaStub.apiToken.findUnique.mockResolvedValue(null);
    for (let i = 0; i < 30; i += 1) {
      await expect(auth.authenticate(tokenRequest("7", "10.4.4.4"))).resolves.toBeNull();
    }
    await expect(auth.authenticate(tokenRequest("7", "10.5.5.5"))).resolves.toBeNull();
  });
});
