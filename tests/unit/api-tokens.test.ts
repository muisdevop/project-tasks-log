import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaStub = vi.hoisted(() => ({
  apiToken: {
    findUnique: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaStub }));

async function loadTokens() {
  vi.resetModules();
  return import("@/lib/api-tokens");
}

/** Deterministic `gid_<40 chars>` plaintext + its digest, so stubs can match. */
function deterministicToken(fill: string) {
  const plaintext = `gid_${fill.repeat(40)}`;
  return { plaintext, tokenHash: createHash("sha256").update(plaintext, "utf8").digest("hex") };
}

function tokenRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    tokenHash: "a".repeat(64),
    name: "agent-read",
    scope: "read",
    createdAt: new Date("2026-10-08T09:00:00.000Z"),
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  };
}

function lastEvent(): Record<string, unknown> {
  const calls = (console.warn as unknown as { mock: { calls: string[][] } }).mock.calls;
  return JSON.parse(calls.at(-1)![0]) as Record<string, unknown>;
}

describe("generateApiToken / hashApiToken", () => {
  it("mints a prefixed 40-hex secret and derives only its SHA-256 digest", async () => {
    const { generateApiToken, hashApiToken, TOKEN_PREFIX } = await loadTokens();
    const { plaintext, tokenHash } = generateApiToken();

    expect(plaintext).toMatch(/^gid_[a-f0-9]{40}$/);
    expect(plaintext.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(tokenHash).not.toContain(plaintext.slice(4));
    // Stable for the same secret (that is what the indexed lookup needs) ...
    expect(hashApiToken(plaintext)).toBe(tokenHash);
    // ... and different for a different secret.
    expect(hashApiToken(generateApiToken().plaintext)).not.toBe(tokenHash);
  });

  it("produces distinct secrets across calls", async () => {
    const { generateApiToken } = await loadTokens();
    const seen = new Set(Array.from({ length: 200 }, () => generateApiToken().plaintext));
    expect(seen.size).toBe(200);
  });

  it("looks up the row by the digest alone", async () => {
    const { verifyApiToken, resetTokenTouchThrottle } = await loadTokens();
    resetTokenTouchThrottle();
    const { plaintext, tokenHash } = deterministicToken("0");
    prismaStub.apiToken.findUnique.mockReset().mockResolvedValue(tokenRow({ tokenHash }));
    prismaStub.apiToken.update.mockReset().mockResolvedValue(tokenRow({ tokenHash }));

    await expect(verifyApiToken(plaintext, "10.0.0.1")).resolves.toMatchObject({ ok: true });
    expect(prismaStub.apiToken.findUnique).toHaveBeenCalledWith({ where: { tokenHash } });
  });
});

describe("looksLikeApiToken", () => {
  it("accepts the minted shape and rejects anything else", async () => {
    const { looksLikeApiToken, generateApiToken } = await loadTokens();
    expect(looksLikeApiToken(generateApiToken().plaintext)).toBe(true);
    expect(looksLikeApiToken("gid_abc")).toBe(false);
    expect(looksLikeApiToken("nope_" + "a".repeat(40))).toBe(false);
    expect(looksLikeApiToken("gid_" + "A".repeat(40))).toBe(false);
    expect(looksLikeApiToken("gid_" + "a".repeat(39))).toBe(false);
    expect(looksLikeApiToken("gid_" + "a".repeat(41))).toBe(false);
  });
});

describe("tokenDigestMatches", () => {
  it("compares equal digests and refuses length/format surprises", async () => {
    const { tokenDigestMatches } = await loadTokens();
    const hash = "b".repeat(64);
    expect(tokenDigestMatches(hash, hash)).toBe(true);
    expect(tokenDigestMatches("c".repeat(64), hash)).toBe(false);
    expect(tokenDigestMatches("b".repeat(63), hash)).toBe(false);
    expect(tokenDigestMatches("", "")).toBe(false);
    expect(tokenDigestMatches(undefined as unknown as string, hash)).toBe(false);
  });

  it("compares digests with a constant-time primitive", async () => {
    const actual = await vi.importActual<typeof import("node:crypto")>("node:crypto");
    const spy = vi.fn(actual.timingSafeEqual);
    vi.doMock("node:crypto", () => ({ ...actual, timingSafeEqual: spy }));
    try {
      const { tokenDigestMatches } = await loadTokens();
      expect(tokenDigestMatches("d".repeat(64), "d".repeat(64))).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);
      // A length mismatch is refused before the buffer compare, which would throw.
      expect(tokenDigestMatches("d".repeat(10), "d".repeat(64))).toBe(false);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      vi.doUnmock("node:crypto");
    }
  });
});

describe("verifyApiToken", () => {
  beforeEach(() => {
    prismaStub.apiToken.findUnique.mockReset();
    prismaStub.apiToken.update.mockReset().mockResolvedValue(tokenRow());
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("rejects a malformed token without touching the database", async () => {
    const { verifyApiToken } = await loadTokens();
    await expect(verifyApiToken("not-a-token", "10.0.0.1")).resolves.toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(prismaStub.apiToken.findUnique).not.toHaveBeenCalled();
    expect(lastEvent()).toMatchObject({ evt: "token.rejected", detail: "malformed" });
  });

  it("rejects an unknown digest with the same reason as a mismatch", async () => {
    const { verifyApiToken } = await loadTokens();
    prismaStub.apiToken.findUnique.mockResolvedValue(null);
    await expect(verifyApiToken(`gid_${"1".repeat(40)}`, "10.0.0.1")).resolves.toEqual({
      ok: false,
      reason: "unknown",
    });
    expect(lastEvent()).toMatchObject({ evt: "token.rejected", detail: "unknown" });
  });

  it("rejects a revoked token and names the revocation", async () => {
    const { verifyApiToken } = await loadTokens();
    const { plaintext, tokenHash } = deterministicToken("2");
    prismaStub.apiToken.findUnique.mockResolvedValue(
      tokenRow({ tokenHash, revokedAt: new Date("2026-10-08T10:00:00.000Z") }),
    );
    await expect(verifyApiToken(plaintext, "10.0.0.1")).resolves.toEqual({
      ok: false,
      reason: "revoked",
    });
    expect(lastEvent()).toMatchObject({ evt: "token.revoked", actor: "agent-read" });
  });

  it("answers `unknown` when the stored digest does not match the candidate", async () => {
    const { verifyApiToken } = await loadTokens();
    const { plaintext } = deterministicToken("9");
    prismaStub.apiToken.findUnique.mockResolvedValue(tokenRow({ tokenHash: "f".repeat(64) }));
    await expect(verifyApiToken(plaintext, "10.0.0.1")).resolves.toEqual({
      ok: false,
      reason: "unknown",
    });
    expect(lastEvent()).toMatchObject({ evt: "token.rejected", detail: "digest_mismatch" });
  });

  it("rejects an expired token but accepts one that expires later", async () => {
    const { verifyApiToken, resetTokenTouchThrottle } = await loadTokens();
    resetTokenTouchThrottle();
    const expired = deterministicToken("3");
    const live = deterministicToken("4");

    prismaStub.apiToken.findUnique.mockResolvedValue(
      tokenRow({ tokenHash: expired.tokenHash, expiresAt: new Date(Date.now() - 1_000) }),
    );
    await expect(verifyApiToken(expired.plaintext, "10.0.0.1")).resolves.toEqual({
      ok: false,
      reason: "expired",
    });

    prismaStub.apiToken.findUnique.mockResolvedValue(
      tokenRow({ tokenHash: live.tokenHash, expiresAt: new Date(Date.now() + 60_000) }),
    );
    await expect(verifyApiToken(live.plaintext, "10.0.0.1")).resolves.toMatchObject({ ok: true });
  });

  it("throttles lastUsedAt to one write per minute per token", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-08T09:00:00Z") });
    const { verifyApiToken, resetTokenTouchThrottle } = await loadTokens();
    resetTokenTouchThrottle();
    const { plaintext, tokenHash } = deterministicToken("5");
    prismaStub.apiToken.findUnique.mockResolvedValue(tokenRow({ tokenHash }));

    await verifyApiToken(plaintext, "10.0.0.1");
    await verifyApiToken(plaintext, "10.0.0.1");
    await verifyApiToken(plaintext, "10.0.0.1");
    expect(prismaStub.apiToken.update).toHaveBeenCalledTimes(1);
    expect(prismaStub.apiToken.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { lastUsedAt: new Date("2026-10-08T09:00:00.000Z") },
    });

    vi.advanceTimersByTime(61_000);
    await verifyApiToken(plaintext, "10.0.0.1");
    expect(prismaStub.apiToken.update).toHaveBeenCalledTimes(2);
  });

  it("a failed lastUsedAt write never breaks authentication", async () => {
    const { verifyApiToken, resetTokenTouchThrottle } = await loadTokens();
    resetTokenTouchThrottle();
    const { plaintext, tokenHash } = deterministicToken("6");
    prismaStub.apiToken.findUnique.mockResolvedValue(tokenRow({ tokenHash }));
    prismaStub.apiToken.update.mockRejectedValue(new Error("database is locked"));

    await expect(verifyApiToken(plaintext, "10.0.0.1")).resolves.toMatchObject({ ok: true });
  });

  it("never puts token material into the security event", async () => {
    const { verifyApiToken } = await loadTokens();
    prismaStub.apiToken.findUnique.mockResolvedValue(null);
    const plaintext = `gid_${"abcdef1234567890abcdef1234567890".padEnd(40, "f")}`;
    await verifyApiToken(plaintext, "10.0.0.1");

    const line = (console.warn as unknown as { mock: { calls: string[][] } }).mock.calls.at(-1)![0];
    expect(line).not.toContain(plaintext);
    expect(line).not.toContain("abcdef1234567890");
    expect(line.split("\n")).toHaveLength(1);
  });
});

describe("toApiTokenView", () => {
  it("exposes metadata only and reports liveness", async () => {
    const { toApiTokenView } = await loadTokens();
    const view = toApiTokenView(tokenRow() as never, Date.parse("2026-10-08T12:00:00Z"));
    expect(view).toEqual({
      id: 7,
      name: "agent-read",
      scope: "read",
      createdAt: "2026-10-08T09:00:00.000Z",
      lastUsedAt: null,
      expiresAt: null,
      revokedAt: null,
      active: true,
    });
    expect(JSON.stringify(view)).not.toContain("a".repeat(64));

    const dead = toApiTokenView(
      tokenRow({ revokedAt: new Date("2026-10-08T11:00:00Z") }) as never,
      Date.parse("2026-10-08T12:00:00Z"),
    );
    expect(dead.active).toBe(false);
  });
});
