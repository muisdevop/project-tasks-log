import bcrypt from "bcryptjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaStub = vi.hoisted(() => ({
  userSettings: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaStub }));

const sessionStub = vi.hoisted(() => ({ getSessionUsername: vi.fn() }));
vi.mock("@/lib/session", () => ({ getSessionUsername: sessionStub.getSessionUsername }));

async function loadAuth() {
  vi.resetModules();
  // Re-register the mocks for the freshly reset module graph.
  return import("@/lib/auth");
}

beforeEach(() => {
  prismaStub.userSettings.findUnique.mockReset();
  prismaStub.userSettings.upsert.mockReset().mockResolvedValue({ id: 1 });
  sessionStub.getSessionUsername.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("validateLogin with a stored (db) hash", () => {
  beforeEach(() => {
    vi.stubEnv("APP_USERNAME", undefined);
  });

  it("accepts the right password and rejects a wrong one", async () => {
    const hash = await bcrypt.hash("correct horse", 4);
    prismaStub.userSettings.findUnique.mockResolvedValue({ passwordHash: hash });

    const auth = await loadAuth();
    await expect(auth.validateLogin("admin", "correct horse")).resolves.toBe(true);
    await expect(auth.validateLogin("admin", "nope")).resolves.toBe(false);
    await expect(auth.validateLogin("attacker", "correct horse")).resolves.toBe(false);
  });

  it("opportunistically upgrades a low-cost hash and bumps the token version", async () => {
    const hash = await bcrypt.hash("pw123", 4);
    prismaStub.userSettings.findUnique.mockResolvedValue({ passwordHash: hash });

    const auth = await loadAuth();
    await expect(auth.validateLogin("admin", "pw123")).resolves.toBe(true);
    expect(prismaStub.userSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        update: expect.objectContaining({ tokenVersion: { increment: 1 } }),
      }),
    );
    const stored: string = prismaStub.userSettings.upsert.mock.calls[0][0].update.passwordHash;
    expect(await bcrypt.compare("pw123", stored)).toBe(true);
    expect(Number(stored.split("$")[2])).toBeGreaterThanOrEqual(12);
  });

  it("does not rewrite a hash already at the current cost", async () => {
    const hash = await bcrypt.hash("pw123", 12);
    prismaStub.userSettings.findUnique.mockResolvedValue({ passwordHash: hash });

    const auth = await loadAuth();
    await expect(auth.validateLogin("admin", "pw123")).resolves.toBe(true);
    expect(prismaStub.userSettings.upsert).not.toHaveBeenCalled();
  });

  it("honours a custom APP_USERNAME", async () => {
    vi.stubEnv("APP_USERNAME", "ops-admin");
    const hash = await bcrypt.hash("pw123", 4);
    prismaStub.userSettings.findUnique.mockResolvedValue({ passwordHash: hash });

    const auth = await loadAuth();
    await expect(auth.validateLogin("ops-admin", "pw123")).resolves.toBe(true);
    await expect(auth.validateLogin("admin", "pw123")).resolves.toBe(false);
  });
});

describe("validateLogin with env-provided credentials", () => {
  it("uses APP_PASSWORD_HASH, tolerating surrounding quotes", async () => {
    const hash = await bcrypt.hash("envpw", 4);
    prismaStub.userSettings.findUnique.mockResolvedValue({ passwordHash: null });
    // Quotes are stripped before the inner value is trimmed, so both the tight
    // form and the padded form ("' $2b$… $'") resolve to the same hash.
    vi.stubEnv("APP_PASSWORD_HASH", `'${hash}'`);

    const auth = await loadAuth();
    await expect(auth.validateLogin("admin", "envpw")).resolves.toBe(true);
    await expect(auth.validateLogin("admin", "wrong")).resolves.toBe(false);

    vi.stubEnv("APP_PASSWORD_HASH", `' ${hash} '`);
    await expect(auth.validateLogin("admin", "envpw")).resolves.toBe(true);
  });

  it("ignores an APP_PASSWORD_HASH that is not a bcrypt hash and falls back to APP_PASSWORD", async () => {
    prismaStub.userSettings.findUnique.mockResolvedValue(null);
    vi.stubEnv("APP_PASSWORD_HASH", "definitely-not-a-hash");
    vi.stubEnv("APP_PASSWORD", "plain-pw");

    const auth = await loadAuth();
    await expect(auth.validateLogin("admin", "plain-pw")).resolves.toBe(true);
  });

  it("throws AuthNotConfiguredError when no credential source exists", async () => {
    prismaStub.userSettings.findUnique.mockResolvedValue(null);
    vi.stubEnv("APP_PASSWORD_HASH", undefined);
    vi.stubEnv("APP_PASSWORD", undefined);

    const auth = await loadAuth();
    await expect(auth.validateLogin("admin", "whatever")).rejects.toBeInstanceOf(
      auth.AuthNotConfiguredError,
    );
    await expect(auth.validateLogin("admin", "whatever")).rejects.toThrow(
      /No APP_PASSWORD_HASH/,
    );
  });

  it("treats a whitespace-only APP_PASSWORD as unconfigured", async () => {
    prismaStub.userSettings.findUnique.mockResolvedValue(null);
    vi.stubEnv("APP_PASSWORD_HASH", undefined);
    vi.stubEnv("APP_PASSWORD", "   ");

    const auth = await loadAuth();
    await expect(auth.validateLogin("admin", "whatever")).rejects.toThrow(
      auth.AuthNotConfiguredError,
    );
    await expect(auth.isLoginConfigured()).resolves.toBe(false);
  });

  it("still burns a bcrypt comparison for a wrong username (timing equaliser, SEC-02)", async () => {
    const hash = await bcrypt.hash("pw123", 4);
    prismaStub.userSettings.findUnique.mockResolvedValue({ passwordHash: hash });
    const compareSpy = vi.spyOn(bcrypt, "compare");

    const auth = await loadAuth();
    await expect(auth.validateLogin("not-the-user", "pw123")).resolves.toBe(false);
    expect(compareSpy).toHaveBeenCalled();
    compareSpy.mockRestore();
  });
});

describe("verifyCurrentPassword", () => {
  it("checks against the configured username", async () => {
    const hash = await bcrypt.hash("cur-pw", 4);
    prismaStub.userSettings.findUnique.mockResolvedValue({ passwordHash: hash });

    const auth = await loadAuth();
    await expect(auth.verifyCurrentPassword("cur-pw")).resolves.toBe(true);
    await expect(auth.verifyCurrentPassword("bad")).resolves.toBe(false);
  });
});

describe("updateDbPassword", () => {
  it("upserts a fresh bcrypt hash at the current cost with a token bump", async () => {
    prismaStub.userSettings.findUnique.mockResolvedValue({ passwordHash: null });
    const auth = await loadAuth();
    await auth.updateDbPassword("brand-new-pw");

    const arg = prismaStub.userSettings.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 1 });
    expect(arg.update.tokenVersion).toEqual({ increment: 1 });
    await expect(bcrypt.compare("brand-new-pw", arg.update.passwordHash)).resolves.toBe(true);
  });
});

describe("requireAuth", () => {
  it("returns the session username when present", async () => {
    sessionStub.getSessionUsername.mockResolvedValue("admin");
    const auth = await loadAuth();
    await expect(auth.requireAuth()).resolves.toBe("admin");
  });

  it("throws UnauthorizedError when the session is missing", async () => {
    sessionStub.getSessionUsername.mockResolvedValue(null);
    const auth = await loadAuth();
    await expect(auth.requireAuth()).rejects.toBeInstanceOf(auth.UnauthorizedError);
    await expect(auth.requireAuth()).rejects.toThrow("Unauthorized");
  });
});

describe("isLoginConfigured", () => {
  it("true when the settings row holds a hash", async () => {
    prismaStub.userSettings.findUnique.mockResolvedValue({ passwordHash: "$2b$12$whatever" });
    const auth = await loadAuth();
    await expect(auth.isLoginConfigured()).resolves.toBe(true);
  });

  it("true from env when the database is unreachable", async () => {
    prismaStub.userSettings.findUnique.mockRejectedValue(new Error("db down"));
    vi.stubEnv("APP_PASSWORD", "  typed  ");
    const auth = await loadAuth();
    await expect(auth.isLoginConfigured()).resolves.toBe(true);
  });

  it("true from a usable APP_PASSWORD_HASH", async () => {
    prismaStub.userSettings.findUnique.mockResolvedValue(null);
    vi.stubEnv("APP_PASSWORD_HASH", await bcrypt.hash("x", 4));
    const auth = await loadAuth();
    await expect(auth.isLoginConfigured()).resolves.toBe(true);
  });

  it("false when nothing is configured", async () => {
    prismaStub.userSettings.findUnique.mockResolvedValue(null);
    vi.stubEnv("APP_PASSWORD_HASH", undefined);
    vi.stubEnv("APP_PASSWORD", "");
    const auth = await loadAuth();
    await expect(auth.isLoginConfigured()).resolves.toBe(false);
  });
});

describe("ensureSettingsRow", () => {
  it("idempotently upserts the singleton row", async () => {
    const auth = await loadAuth();
    await auth.ensureSettingsRow();
    expect(prismaStub.userSettings.upsert).toHaveBeenCalledWith({
      where: { id: 1 },
      update: {},
      create: { id: 1 },
    });
  });
});

describe("error classes", () => {
  it("UnauthorizedError and AuthNotConfiguredError carry stable names", async () => {
    const auth = await loadAuth();
    const unauth = new auth.UnauthorizedError();
    expect(unauth).toBeInstanceOf(Error);
    expect(unauth.name).toBe("UnauthorizedError");
    expect(unauth.message).toBe("Unauthorized");

    const notConfigured = new auth.AuthNotConfiguredError();
    expect(notConfigured.name).toBe("AuthNotConfiguredError");
    expect(notConfigured.message).toMatch(/APP_PASSWORD_HASH/);
  });

  it("exposes the OWASP cost floor", async () => {
    const auth = await loadAuth();
    expect(auth.BCRYPT_COST).toBe(12);
  });
});
