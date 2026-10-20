/**
 * AI-02 / AI-03: unit coverage for the extended limiter (token-keyed buckets,
 * the typed 429 and the shared client-IP reader). The fixed-window core itself
 * stays covered by tests/unit/rate-limit.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RateLimitModule = typeof import("@/lib/rate-limit");

async function loadRateLimit(): Promise<RateLimitModule> {
  vi.resetModules();
  return import("@/lib/rate-limit");
}

describe("preset-backed buckets (AI-02/AI-03)", () => {
  let rl: RateLimitModule;

  beforeEach(async () => {
    vi.useFakeTimers({ now: new Date("2026-10-08T12:00:00Z") });
    rl = await loadRateLimit();
    rl.resetRateLimits();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the human login budget at 5 per 5 minutes", () => {
    expect(rl.RATE_LIMIT_PRESETS.login).toEqual({ limit: 5, windowMs: 300_000 });
    for (let i = 1; i <= 5; i += 1) {
      expect(rl.checkBucketRateLimit({ ip: "1.1.1.1" }, "login").ok).toBe(true);
    }
    const blocked = rl.checkBucketRateLimit({ ip: "1.1.1.1" }, "login");
    expect(blocked).toEqual({ ok: false, retryAfterSeconds: 300 });
  });

  it("keys an agent bucket by token id, not by the IP it happens to share", () => {
    expect(rl.limiterKeyFor({ tokenId: 7, ip: "1.1.1.1" }, "api")).toBe("api:token:7");
    expect(rl.limiterKeyFor({ ip: "1.1.1.1" }, "api")).toBe("api:ip:1.1.1.1");
    // Two tokens from the same IP get independent budgets, so one looping agent
    // cannot starve the other.
    const limit = rl.RATE_LIMIT_PRESETS.api.limit;
    for (let i = 0; i < limit; i += 1) {
      expect(rl.checkBucketRateLimit({ tokenId: 1, ip: "9.9.9.9" }, "api").ok).toBe(true);
    }
    expect(rl.checkBucketRateLimit({ tokenId: 1, ip: "9.9.9.9" }, "api").ok).toBe(false);
    expect(rl.checkBucketRateLimit({ tokenId: 2, ip: "9.9.9.9" }, "api").ok).toBe(true);
  });

  it("assertBucketRateLimit throws a typed error carrying Retry-After", () => {
    expect(() => rl.assertBucketRateLimit({ tokenId: 5, ip: "1.1.1.1" }, "tokens-mint")).not.toThrow();

    let thrown: unknown;
    const mintLimit = rl.RATE_LIMIT_PRESETS["tokens-mint"].limit;
    for (let i = 0; i < mintLimit; i += 1) {
      rl.assertBucketRateLimit({ ip: "2.2.2.2" }, "tokens-mint");
    }
    try {
      rl.assertBucketRateLimit({ ip: "2.2.2.2" }, "tokens-mint");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(rl.RateLimitedError);
    const limited = thrown as InstanceType<typeof rl.RateLimitedError>;
    expect(limited.status).toBe(429);
    expect(limited.retryAfterSeconds).toBe(300);
    expect(limited.message).toMatch(/Retry in 300s/);
  });

  it("an unknown bucket name falls back to a generous default instead of failing open", () => {
    for (let i = 0; i < 60; i += 1) {
      expect(rl.checkBucketRateLimit({ ip: "3.3.3.3" }, "not-a-preset").ok).toBe(true);
    }
    expect(rl.checkBucketRateLimit({ ip: "3.3.3.3" }, "not-a-preset").ok).toBe(false);
  });

  it("reopens a preset bucket when its window elapses", () => {
    vi.advanceTimersByTime(61_000);
    expect(rl.checkBucketRateLimit({ tokenId: 11, ip: "4.4.4.4" }, "api").ok).toBe(true);
  });
});

describe("clientIp", () => {
  let rl: RateLimitModule;

  beforeEach(async () => {
    rl = await loadRateLimit();
  });

  const requestWith = (headers: Record<string, string>) =>
    ({ headers: new Headers(headers) }) as unknown as Request;

  it("takes the first X-Forwarded-For hop", async () => {
    expect(rl.clientIp(requestWith({ "x-forwarded-for": " 203.0.113.7, 10.0.0.1 " }))).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip and then to `unknown`", async () => {
    expect(rl.clientIp(requestWith({ "x-real-ip": "198.51.100.9" }))).toBe("198.51.100.9");
    expect(rl.clientIp(requestWith({ "x-forwarded-for": " , " }))).toBe("unknown");
    expect(rl.clientIp(requestWith({}))).toBe("unknown");
  });
});
