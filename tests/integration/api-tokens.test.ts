/**
 * Integration: API tokens, idempotency and the agent rate limits (AI-02, AI-03,
 * MF-02). Runs the real `/api/tokens` handlers and the real `authenticate()`
 * against a throwaway SQLite file created by the shared harness, so the digest
 * lookup, revocation, replay and 429 paths are exercised end to end.
 */
import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  apiRequest,
  clearAuthCookie,
  freshIp,
  issueAuthCookie,
  loadPrisma,
  resetLoginRateLimits,
  setupTestDatabase,
  silenceConsole,
  teardownTestDatabase,
  TEST_USERNAME,
  type TestDbContext,
} from "./helpers/harness";
import type { PrismaClient } from "@prisma/client";

let ctxDb: TestDbContext;
let prisma: PrismaClient;
let tokensRoute: typeof import("@/app/api/tokens/route");
let authenticate: (typeof import("@/lib/auth"))["authenticate"];
let requireWriteAccess: (typeof import("@/lib/auth"))["requireWriteAccess"];
let resetIdempotencyStore: () => void;
let resetTokenTouchThrottle: () => void;

beforeAll(async () => {
  ctxDb = await setupTestDatabase("tokens");
  prisma = await loadPrisma();
  tokensRoute = await import("@/app/api/tokens/route");
  const auth = await import("@/lib/auth");
  authenticate = auth.authenticate;
  requireWriteAccess = auth.requireWriteAccess;
  resetIdempotencyStore = (await import("@/lib/idempotency")).resetIdempotencyStore;
  resetTokenTouchThrottle = (await import("@/lib/api-tokens")).resetTokenTouchThrottle;
}, 240_000);

beforeEach(async () => {
  silenceConsole();
  await prisma.apiToken.deleteMany();
  resetIdempotencyStore();
  resetTokenTouchThrottle();
  await resetLoginRateLimits();
  await issueAuthCookie(prisma);
});

afterEach(() => {
  clearAuthCookie();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await teardownTestDatabase(ctxDb, prisma);
});

function tokenRequest(plaintext: string, path = "/api/settings", ip?: string): Request {
  const headers = new Headers({ authorization: `Bearer ${plaintext}` });
  if (ip) headers.set("x-forwarded-for", ip);
  return new Request(`http://localhost${path}`, { headers });
}

async function mintToken(body: Record<string, unknown> = { name: "ops agent", scope: "read" }) {
  const res = await tokensRoute.POST(
    apiRequest("/api/tokens", { method: "POST", body, headers: { "x-forwarded-for": freshIp() } }),
  );
  return res;
}

describe("POST /api/tokens", () => {
  it("needs the browser session", async () => {
    clearAuthCookie();
    const res = await tokensRoute.POST(
      apiRequest("/api/tokens", { method: "POST", body: { name: "ops agent" } }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns the plaintext once and persists only its SHA-256 digest", async () => {
    const res = await mintToken({ name: "ops agent", scope: "write" });
    expect(res.status).toBe(201);
    const payload = (await res.json()) as { token: Record<string, unknown>; plaintext: string };

    expect(payload.plaintext).toMatch(/^gid_[a-f0-9]{40}$/);
    expect(payload.token).toMatchObject({ name: "ops agent", scope: "write", active: true });
    expect(payload.token.tokenHash).toBeUndefined();

    const rows = await prisma.apiToken.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(createHash("sha256").update(payload.plaintext).digest("hex"));
    expect(JSON.stringify(rows[0].tokenHash)).not.toContain(payload.plaintext.slice(4));
  });

  it("defaults the scope to read and validates the payload", async () => {
    const created = await mintToken({ name: "reader" });
    expect(((await created.json()) as { token: { scope: string } }).token.scope).toBe("read");

    const badName = await mintToken({ name: "x" });
    expect(badName.status).toBe(400);

    const badScope = await mintToken({ name: "ops agent", scope: "superuser" });
    expect(badScope.status).toBe(400);

    const pastExpiry = await mintToken({
      name: "ops agent",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(pastExpiry.status).toBe(400);
    expect(((await pastExpiry.json()) as { error: string }).error).toMatch(/future/);
  });

  it("never lets a token mint, list or revoke tokens", async () => {
    const created = await mintToken({ name: "ops agent", scope: "write" });
    const { plaintext } = (await created.json()) as { plaintext: string };

    const viaToken = await tokensRoute.POST(tokenRequest(plaintext, "/api/tokens"));
    expect(viaToken.status).toBe(403);
    expect(((await viaToken.json()) as { error: string }).error).toMatch(/cannot manage API tokens/);

    clearAuthCookie();
    const listed = await tokensRoute.GET(tokenRequest(plaintext, "/api/tokens"));
    expect(listed.status).toBe(403);
  });

  it("rate-limits token minting per caller with 429 + Retry-After", async () => {
    const ip = freshIp();
    let lastStatus = 0;
    for (let i = 0; i < 12; i += 1) {
      const res = await tokensRoute.POST(
        apiRequest("/api/tokens", {
          method: "POST",
          body: { name: `agent ${i}` },
          headers: { "x-forwarded-for": ip },
        }),
      );
      lastStatus = res.status;
      if (lastStatus === 429) break;
    }
    expect(lastStatus).toBe(429);
    const blocked = await tokensRoute.POST(
      apiRequest("/api/tokens", {
        method: "POST",
        body: { name: "agent blocked" },
        headers: { "x-forwarded-for": ip },
      }),
    );
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});

describe("GET /api/tokens", () => {
  it("lists metadata only, newest first, and 401s without a session", async () => {
    await mintToken({ name: "first agent" });
    await mintToken({ name: "second agent" });

    const res = await tokensRoute.GET(apiRequest("/api/tokens"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tokens: Record<string, unknown>[] };
    expect(body.tokens).toHaveLength(2);
    expect(body.tokens[0].name).toBe("second agent");
    expect(Object.keys(body.tokens[0]).sort()).toEqual(
      ["active", "createdAt", "expiresAt", "id", "lastUsedAt", "name", "revokedAt", "scope"].sort(),
    );

    const serialised = JSON.stringify(body);
    const rows = await prisma.apiToken.findMany();
    for (const row of rows) {
      expect(serialised).not.toContain(row.tokenHash);
    }

    clearAuthCookie();
    expect((await tokensRoute.GET(apiRequest("/api/tokens"))).status).toBe(401);
  });
});

describe("Bearer authentication through authenticate()", () => {
  it("resolves a live token to its scope and stamps lastUsedAt once per minute", async () => {
    const created = await mintToken({ name: "ops agent", scope: "write" });
    const { plaintext } = (await created.json()) as { plaintext: string };

    const context = await authenticate(tokenRequest(plaintext, "/api/stats", freshIp()));
    expect(context).toMatchObject({ via: "token", scope: "write", actor: TEST_USERNAME });

    const first = await prisma.apiToken.findFirst();
    expect(first?.lastUsedAt).not.toBeNull();

    await authenticate(tokenRequest(plaintext, "/api/stats", freshIp()));
    const second = await prisma.apiToken.findFirst();
    // Throttled: the second call inside the same minute reuses the stamp.
    expect(second?.lastUsedAt?.getTime()).toBe(first?.lastUsedAt?.getTime());
  });

  it("refuses a read token on a mutating guard with 403", async () => {
    const created = await mintToken({ name: "reader" });
    const { plaintext } = (await created.json()) as { plaintext: string };

    await expect(requireWriteAccess(tokenRequest(plaintext, "/api/tasks", freshIp()))).rejects.toThrow(
      /read-only/,
    );
  });

  it("treats a revoked token as unauthenticated and logs the revocation", async () => {
    const created = await mintToken();
    const { token, plaintext } = (await created.json()) as { token: { id: number }; plaintext: string };

    const revoked = await tokensRoute.DELETE(
      apiRequest(`/api/tokens?id=${token.id}`, {
        method: "DELETE",
        headers: { "x-forwarded-for": freshIp() },
      }),
    );
    expect(revoked.status).toBe(200);
    expect(((await revoked.json()) as { token: { active: boolean } }).token.active).toBe(false);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(authenticate(tokenRequest(plaintext, "/api/stats", freshIp()))).resolves.toBeNull();
    const events = warnSpy.mock.calls.map((call) => String(call[0]));
    expect(events.some((line) => line.includes('"evt":"token.revoked"'))).toBe(true);
    expect(JSON.stringify(events)).not.toContain(plaintext);
  });

  it("refuses an expired token without touching revocation state", async () => {
    const created = await mintToken({ name: "timeboxed", scope: "write" });
    const { token, plaintext } = (await created.json()) as { token: { id: number }; plaintext: string };
    await prisma.apiToken.update({
      where: { id: token.id },
      data: { expiresAt: new Date(Date.now() - 5_000) },
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(authenticate(tokenRequest(plaintext, "/api/stats", freshIp()))).resolves.toBeNull();
    expect(
      warnSpy.mock.calls.some((call) => String(call[0]).includes('"evt":"token.expired"')),
    ).toBe(true);
  });

  it("escalates a stream of unknown tokens from one IP to 429", async () => {
    const ip = freshIp();
    const bogus = `gid_${"a".repeat(40)}`;
    for (let i = 0; i < 30; i += 1) {
      await expect(authenticate(tokenRequest(bogus, "/api/stats", ip))).resolves.toBeNull();
    }
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(authenticate(tokenRequest(bogus, "/api/stats", ip))).rejects.toThrow(/Retry in/);
    expect(
      warnSpy.mock.calls.some((call) => String(call[0]).includes('"evt":"token.rate_limited"')),
    ).toBe(true);
  });

  it("applies the per-token agent budget independently of the cookie session", async () => {
    const created = await mintToken({ name: "looping agent" });
    const { plaintext } = (await created.json()) as { plaintext: string };
    const ip = freshIp();
    const request = tokenRequest(plaintext, "/api/stats", ip);

    // 120 calls inside the window: the browser session is not affected because
    // cookie callers are keyed by IP, not by token id.
    for (let i = 0; i < 120; i += 1) {
      const context = await authenticate(request);
      expect(context?.via).toBe("token");
    }
    await expect(authenticate(request)).rejects.toThrow(/Retry in/);
  });
});

describe("Idempotency-Key on POST /api/tokens", () => {
  it("replays the original mint instead of creating a second token", async () => {
    const key = "1234567890abcdef-AGENT-retry";
    const body = { name: "ops agent", scope: "read" };
    const first = await tokensRoute.POST(
      apiRequest("/api/tokens", {
        method: "POST",
        body,
        headers: { "idempotency-key": key, "x-forwarded-for": freshIp() },
      }),
    );
    const replay = await tokensRoute.POST(
      apiRequest("/api/tokens", {
        method: "POST",
        body,
        headers: { "idempotency-key": key, "x-forwarded-for": freshIp() },
      }),
    );

    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await replay.json()).toEqual(await first.clone().json());
    expect(await prisma.apiToken.count()).toBe(1);
  });

  it("rejects the same key with a different body (409) and a malformed key (400)", async () => {
    const key = "aaaa1111bbbb2222cccc3333";
    await tokensRoute.POST(
      apiRequest("/api/tokens", {
        method: "POST",
        body: { name: "ops agent" },
        headers: { "idempotency-key": key, "x-forwarded-for": freshIp() },
      }),
    );

    const conflict = await tokensRoute.POST(
      apiRequest("/api/tokens", {
        method: "POST",
        body: { name: "different agent" },
        headers: { "idempotency-key": key, "x-forwarded-for": freshIp() },
      }),
    );
    expect(conflict.status).toBe(409);
    expect(await prisma.apiToken.count()).toBe(1);

    const invalid = await tokensRoute.POST(
      apiRequest("/api/tokens", {
        method: "POST",
        body: { name: "ops agent" },
        headers: { "idempotency-key": "nope", "x-forwarded-for": freshIp() },
      }),
    );
    expect(invalid.status).toBe(400);
    expect(((await invalid.json()) as { error: string }).error).toMatch(/Idempotency-Key/);
  });

  it("leaves a plain (unkeyed) mint untouched", async () => {
    const first = await mintToken();
    const second = await mintToken();
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const a = (await first.json()) as { plaintext: string };
    const b = (await second.json()) as { plaintext: string };
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(await prisma.apiToken.count()).toBe(2);
  });
});

describe("PATCH /api/tokens", () => {
  it("renames and revokes; an already revoked token stays revoked", async () => {
    const created = await mintToken({ name: "ops agent" });
    const { token, plaintext } = (await created.json()) as {
      token: { id: number };
      plaintext: string;
    };

    const renamed = await tokensRoute.PATCH(
      apiRequest("/api/tokens", {
        method: "PATCH",
        body: { id: token.id, name: "renamed agent" },
        headers: { "x-forwarded-for": freshIp() },
      }),
    );
    expect(renamed.status).toBe(200);
    expect(((await renamed.json()) as { token: { name: string } }).token.name).toBe("renamed agent");

    // Still usable before the revoke.
    expect(await authenticate(tokenRequest(plaintext, "/api/stats", freshIp()))).not.toBeNull();

    const revoked = await tokensRoute.PATCH(
      apiRequest("/api/tokens", {
        method: "PATCH",
        body: { id: token.id, revoke: true },
        headers: { "x-forwarded-for": freshIp() },
      }),
    );
    expect(revoked.status).toBe(200);
    const revokedBody = (await revoked.json()) as { token: { active: boolean; revokedAt: string | null } };
    expect(revokedBody.token.active).toBe(false);
    expect(revokedBody.token.revokedAt).not.toBeNull();
    expect(await authenticate(tokenRequest(plaintext, "/api/stats", freshIp()))).toBeNull();

    const noop = await tokensRoute.PATCH(
      apiRequest("/api/tokens", {
        method: "PATCH",
        body: { id: token.id },
        headers: { "x-forwarded-for": freshIp() },
      }),
    );
    expect(noop.status).toBe(400);

    const missing = await tokensRoute.PATCH(
      apiRequest("/api/tokens", {
        method: "PATCH",
        body: { id: 9999, revoke: true },
        headers: { "x-forwarded-for": freshIp() },
      }),
    );
    expect(missing.status).toBe(404);
  });

  it("DELETE without a valid id is a 400", async () => {
    const res = await tokensRoute.DELETE(
      apiRequest("/api/tokens?id=abc", { method: "DELETE", headers: { "x-forwarded-for": freshIp() } }),
    );
    expect(res.status).toBe(400);
  });
});

describe("cookie session regressions", () => {
  it("the existing session path still authenticates routes without a forwarded Request", async () => {
    const settingsGet = (await import("@/app/api/settings/route")).GET;
    const res = await settingsGet(apiRequest("/api/settings"));
    expect(res.status).toBe(200);
    clearAuthCookie();
    expect((await settingsGet(apiRequest("/api/settings"))).status).toBe(401);
  });

  it("an invalid Bearer token does not fall back to the session cookie", async () => {
    const created = await mintToken();
    await prisma.apiToken.update({
      where: { id: ((await created.json()) as { token: { id: number } }).token.id },
      data: { revokedAt: new Date() },
    });
    const settingsGet = (await import("@/app/api/settings/route")).GET;
    // settings forwards its Request, so the cookie path is still honoured ...
    expect((await settingsGet(apiRequest("/api/settings"))).status).toBe(200);
    // ... and a token-only call is judged on the token alone.
    expect(await authenticate(tokenRequest(`gid_${"f".repeat(40)}`, "/api/stats", freshIp()))).toBeNull();
    // A request carrying both credentials is judged as the token it presents:
    // an agent must never inherit the browser's full-power session.
    clearAuthCookie();
    await issueAuthCookie(prisma);
    const both = apiRequest("/api/settings", {
      headers: { authorization: `Bearer gid_${"f".repeat(40)}`, "x-forwarded-for": freshIp() },
    });
    expect((await settingsGet(both)).status).toBe(401);
  });
});

describe("token scope on a real wired route (/api/breaks)", () => {
  let breaksRoute: typeof import("@/app/api/breaks/route");
  let created = 0;

  async function fixtureJob(): Promise<number> {
    breaksRoute = breaksRoute ?? (await import("@/app/api/breaks/route"));
    created += 1;
    const slug = `${ctxDb.tempDir.replace(/[^a-z0-9]/gi, "")}-${created}`;
    const job = await prisma.job.create({
      data: { name: `Token Job ${slug}`, nameKey: `tj-${slug}`, workStart: "09:00", workEnd: "17:00" },
    });
    await prisma.project.create({
      data: { name: `Token Project ${slug}`, nameKey: `tp-${slug}`, jobId: job.id },
    });
    return job.id;
  }

  async function writePlaintext(): Promise<string> {
    const res = await mintToken({ name: "writer", scope: "write" });
    return ((await res.json()) as { plaintext: string }).plaintext;
  }

  it("lets a read token list breaks but not create one", async () => {
    const jobId = await fixtureJob();
    const minted = await mintToken({ name: "reader", scope: "read" });
    const { plaintext } = (await minted.json()) as { plaintext: string };

    const list = await breaksRoute.GET(
      tokenRequest(plaintext, `/api/breaks?jobId=${jobId}`, freshIp()),
    );
    expect(list.status).toBe(200);
    expect(((await list.json()) as { breaks: unknown[] }).breaks).toEqual([]);

    const make = await breaksRoute.POST(
      apiRequest("/api/breaks", {
        method: "POST",
        body: { jobId, name: "Tea", type: "recurring" },
        headers: { authorization: `Bearer ${plaintext}`, "x-forwarded-for": freshIp() },
      }),
    );
    expect(make.status).toBe(403);
    expect(((await make.json()) as { error: string }).error).toMatch(/read-only/);
    expect(await prisma.breakType.count({ where: { jobId } })).toBe(0);
  });

  it("lets a write token create the break, and the cookie session still can", async () => {
    const jobId = await fixtureJob();
    const plaintext = await writePlaintext();

    const make = await breaksRoute.POST(
      apiRequest("/api/breaks", {
        method: "POST",
        body: { jobId, name: "Coffee", type: "recurring" },
        headers: { authorization: `Bearer ${plaintext}`, "x-forwarded-for": freshIp() },
      }),
    );
    expect(make.status).toBe(201);

    const viaCookie = await breaksRoute.POST(
      apiRequest("/api/breaks", { method: "POST", body: { jobId, name: "Dhuhr", type: "prayer" } }),
    );
    expect(viaCookie.status).toBe(201);
    expect(await prisma.breakType.count({ where: { jobId } })).toBe(2);
  });

  it("answers 401 for a mutating call with no credential at all", async () => {
    const jobId = await fixtureJob();
    clearAuthCookie();
    const res = await breaksRoute.POST(
      apiRequest("/api/breaks", { method: "POST", body: { jobId, name: "Ghost", type: "other" } }),
    );
    expect(res.status).toBe(401);
  });
});
