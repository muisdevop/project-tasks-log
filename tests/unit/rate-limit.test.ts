import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RateLimitModule = typeof import("@/lib/rate-limit");

// Import under fake timers so the module's 60s cleanup interval is also faked.
async function loadRateLimit(): Promise<RateLimitModule> {
  vi.resetModules();
  return import("@/lib/rate-limit");
}

describe("checkRateLimit (fixed window)", () => {
  let rl: RateLimitModule;

  beforeEach(async () => {
    vi.useFakeTimers({ now: new Date("2026-03-30T12:00:00Z") });
    rl = await loadRateLimit();
    rl.resetRateLimits();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const checkRateLimit = (key: string, limit: number, windowMs: number) =>
    rl.checkRateLimit(key, limit, windowMs);
  const resetRateLimits = () => rl.resetRateLimits();

  it("allows up to the limit and blocks the next request", () => {
    for (let i = 1; i <= 3; i += 1) {
      expect(checkRateLimit("login:ip", 3, 60_000)).toEqual({ ok: true });
    }
    const blocked = checkRateLimit("login:ip", 3, 60_000);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.retryAfterSeconds).toBe(60);
    }
  });

  it("counts a full window for a limit of 1", () => {
    expect(checkRateLimit("k", 1, 10_000)).toEqual({ ok: true });
    expect(checkRateLimit("k", 1, 10_000)).toEqual({ ok: false, retryAfterSeconds: 10 });
  });

  it("decrements retryAfterSeconds as the window runs down", () => {
    checkRateLimit("k", 1, 60_000);
    vi.advanceTimersByTime(45_000);
    const blocked = checkRateLimit("k", 1, 60_000);
    expect(blocked).toEqual({ ok: false, retryAfterSeconds: 15 });
  });

  it("rounds a partially elapsed second up to 1", () => {
    checkRateLimit("k", 1, 60_000);
    vi.advanceTimersByTime(59_500);
    expect(checkRateLimit("k", 1, 60_000)).toEqual({ ok: false, retryAfterSeconds: 1 });
  });

  it("reopens the bucket once the window has elapsed", () => {
    expect(checkRateLimit("k", 2, 30_000)).toEqual({ ok: true });
    expect(checkRateLimit("k", 2, 30_000)).toEqual({ ok: true });
    expect(checkRateLimit("k", 2, 30_000).ok).toBe(false);
    vi.advanceTimersByTime(30_000);
    expect(checkRateLimit("k", 2, 30_000)).toEqual({ ok: true });
    // count reset with the new window: one more is still allowed under limit 2
    expect(checkRateLimit("k", 2, 30_000)).toEqual({ ok: true });
    expect(checkRateLimit("k", 2, 30_000).ok).toBe(false);
  });

  it("tracks keys independently", () => {
    expect(checkRateLimit("a", 1, 60_000)).toEqual({ ok: true });
    expect(checkRateLimit("a", 1, 60_000).ok).toBe(false);
    expect(checkRateLimit("b", 1, 60_000)).toEqual({ ok: true });
  });

  it("resetRateLimits clears all buckets", () => {
    checkRateLimit("a", 1, 60_000);
    checkRateLimit("a", 1, 60_000);
    resetRateLimits();
    expect(checkRateLimit("a", 1, 60_000)).toEqual({ ok: true });
  });

  it("the janitor tick drops expired buckets but keeps live ones", () => {
    expect(checkRateLimit("old", 1, 5_000)).toEqual({ ok: true });
    expect(checkRateLimit("old", 1, 5_000).ok).toBe(false);
    // Expire the window, then cross the 60s cleanup interval.
    vi.advanceTimersByTime(70_000);
    expect(checkRateLimit("old", 1, 5_000)).toEqual({ ok: true });

    // A bucket still inside its window survives a cleanup tick.
    checkRateLimit("fresh", 1, 120_000);
    vi.advanceTimersByTime(60_000);
    expect(checkRateLimit("fresh", 1, 120_000).ok).toBe(false);
  });
});
