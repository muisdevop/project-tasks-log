import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";

// In-memory cookie jar standing in for next/headers, so no request context is needed.
const jar = vi.hoisted(() => {
  const store = new Map<string, { value: string; options?: Record<string, unknown> }>();
  return {
    store,
    get(name: string) {
      const entry = store.get(name);
      return entry ? { name, value: entry.value } : undefined;
    },
    set(name: string, value: string, options?: Record<string, unknown>) {
      store.set(name, { value, options });
    },
  };
});

vi.mock("next/headers", () => ({
  cookies: async () => jar,
}));

// Stable reference to the mocked prisma stub handed out by the factory below.
// The real prisma client is deliberately never loaded.
const prismaStub = { userSettings: { findUnique: vi.fn() } };
vi.mock("@/lib/prisma", () => ({ prisma: prismaStub }));

const SECRET = "unit-test-secret-value-1234";

type SessionModule = typeof import("@/lib/session");

async function loadSession(): Promise<SessionModule> {
  vi.resetModules();
  return import("@/lib/session");
}

describe("session cookie name", () => {
  it("is stl_session", async () => {
    const session = await loadSession();
    expect(session.COOKIE_NAME).toBe("stl_session");
  });
});

describe("createSession / getSessionUsername round trip", () => {
  beforeEach(() => {
    jar.store.clear();
    vi.stubEnv("SESSION_SECRET", SECRET);
    prismaStub.userSettings.findUnique.mockReset();
  });

  it("signs a JWT into an httpOnly cookie and verifies it back to the username", async () => {
    const session = await loadSession();
    await session.createSession("admin", 3);

    const stored = jar.store.get("stl_session");
    expect(stored?.value).toBeTruthy();
    expect(stored?.options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

    prismaStub.userSettings.findUnique.mockResolvedValue({ tokenVersion: 3 });
    await expect(session.getSessionUsername()).resolves.toBe("admin");
    expect(prismaStub.userSettings.findUnique).toHaveBeenCalledWith({
      where: { id: 1 },
      select: { tokenVersion: true },
    });
  });

  it("rejects a tampered token", async () => {
    const session = await loadSession();
    await session.createSession("admin", 1);
    prismaStub.userSettings.findUnique.mockResolvedValue({ tokenVersion: 1 });

    const entry = jar.store.get("stl_session");
    const [header, , sig] = (entry?.value ?? "").split(".");
    const forgedPayload = btoa(JSON.stringify({ sub: "attacker", tv: 1 })).replace(/=+$/, "");
    jar.store.set("stl_session", { value: `${header}.${forgedPayload}.${sig}` });

    await expect(session.getSessionUsername()).resolves.toBeNull();
  });

  it("rejects a token whose version no longer matches the settings row", async () => {
    const session = await loadSession();
    await session.createSession("admin", 2);
    prismaStub.userSettings.findUnique.mockResolvedValue({ tokenVersion: 99 });
    await expect(session.getSessionUsername()).resolves.toBeNull();
  });

  it("rejects when no settings row exists", async () => {
    const session = await loadSession();
    await session.createSession("admin", 1);
    prismaStub.userSettings.findUnique.mockResolvedValue(null);
    await expect(session.getSessionUsername()).resolves.toBeNull();
  });

  it("rejects an expired token", async () => {
    const session = await loadSession();
    const expired = await new SignJWT({ sub: "admin", tv: 1 })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("-30s")
      .sign(new TextEncoder().encode(SECRET));
    jar.store.set("stl_session", { value: expired });

    await expect(session.getSessionUsername()).resolves.toBeNull();
    // The expiry failure happens before the settings lookup.
    expect(prismaStub.userSettings.findUnique).not.toHaveBeenCalled();
  });

  it("returns null with no cookie at all", async () => {
    const session = await loadSession();
    await expect(session.getSessionUsername()).resolves.toBeNull();
  });

  it("returns null when the token has no string subject", async () => {
    const session = await loadSession();
    const noSub = await new SignJWT({ tv: 1 })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("60s")
      .sign(new TextEncoder().encode(SECRET));
    jar.store.set("stl_session", { value: noSub });
    await expect(session.getSessionUsername()).resolves.toBeNull();
  });

  it("clearSession empties the cookie with maxAge 0", async () => {
    const session = await loadSession();
    await session.createSession("admin", 1);
    await session.clearSession();

    const entry = jar.store.get("stl_session");
    expect(entry?.value).toBe("");
    expect(entry?.options).toMatchObject({ maxAge: 0, httpOnly: true });
    await expect(session.getSessionUsername()).resolves.toBeNull();
  });
});

describe("SESSION_SECRET fail-closed behaviour", () => {
  beforeEach(() => {
    jar.store.clear();
  });

  it("createSession rejects when the secret is missing or shorter than 16 chars", async () => {
    vi.stubEnv("SESSION_SECRET", "");
    const session = await loadSession();
    await expect(session.createSession("admin", 1)).rejects.toThrow(
      "SESSION_SECRET must be set and at least 16 characters.",
    );

    vi.stubEnv("SESSION_SECRET", "short-secret");
    const session2 = await loadSession();
    await expect(session2.createSession("admin", 1)).rejects.toThrow(/at least 16 characters/);
    vi.unstubAllEnvs();
  });

  it("getSessionUsername returns null (never throws) when the secret is invalid", async () => {
    // A token signed under the old secret must not verify under a broken one.
    const validSecret = "another-valid-secret-value";
    const token = await new SignJWT({ sub: "admin", tv: 1 })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("60s")
      .sign(new TextEncoder().encode(validSecret));
    jar.store.set("stl_session", { value: token });

    vi.stubEnv("SESSION_SECRET", "too-short");
    const session = await loadSession();
    await expect(session.getSessionUsername()).resolves.toBeNull();
    vi.unstubAllEnvs();
  });
});
