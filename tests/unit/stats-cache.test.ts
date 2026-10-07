/**
 * Unit: the short-TTL stats cache behind `/api/stats` (PF-03).
 *
 * Everything here runs against injected clocks and injected watermarks, so no
 * database and no fake timers are involved: the behaviours under test are TTL
 * expiry, watermark-driven recomputation, single-flight fan-out, explicit
 * invalidation, and "a mutation during a computation is not published".
 */
import { describe, expect, it, vi } from "vitest";
import { createStatsCache, invalidateStatsCache, STATS_TTL_MS } from "@/lib/stats-cache";

const CLOCK_START = 1_000_000;

/** Lets every microtask chain started so far settle (a macrotask boundary). */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

type Setup = {
  now: () => number;
  advance: (ms: number) => void;
  setWatermark: (value: string) => void;
  cache: ReturnType<typeof createStatsCache<{ n: number }>>;
  compute: () => Promise<{ n: number }>;
  calls: () => number;
};

function setup(options: { watermark?: boolean; ttlMs?: number } = {}): Setup {
  let clock = CLOCK_START;
  let watermark = "w1";
  let calls = 0;

  const cache = createStatsCache<{ n: number }>({
    ttlMs: options.ttlMs ?? 5_000,
    now: () => clock,
    watermark: options.watermark === false ? undefined : async () => watermark,
  });

  return {
    now: () => clock,
    advance: (ms) => {
      clock += ms;
    },
    setWatermark: (value) => {
      watermark = value;
    },
    cache,
    compute: async () => {
      calls += 1;
      return { n: calls };
    },
    calls: () => calls,
  };
}

describe("createStatsCache TTL", () => {
  it("serves the cached payload within the TTL without recomputing", async () => {
    const s = setup();
    expect(await s.cache.get(s.compute)).toEqual({ n: 1 });
    s.advance(1_000);
    expect(await s.cache.get(s.compute)).toEqual({ n: 1 });
    expect(s.calls()).toBe(1);
  });

  it("recomputes exactly once the TTL has elapsed", async () => {
    const s = setup();
    await s.cache.get(s.compute);
    s.advance(5_000);
    expect(await s.cache.get(s.compute)).toEqual({ n: 2 });
    s.advance(4_999);
    expect(await s.cache.get(s.compute)).toEqual({ n: 2 });
    expect(s.calls()).toBe(2);
  });

  it("treats the deadline as exclusive (expiresAt <= now is stale)", async () => {
    const s = setup({ ttlMs: 100 });
    await s.cache.get(s.compute);
    s.advance(99);
    expect(s.cache.snapshot().cached).toBe(true);
    s.advance(1);
    expect(s.cache.snapshot().cached).toBe(false);
    await s.cache.get(s.compute);
    expect(s.calls()).toBe(2);
  });

  it("keeps the production TTL short (it is a burst guard, not a correctness tool)", () => {
    expect(STATS_TTL_MS).toBeGreaterThan(0);
    expect(STATS_TTL_MS).toBeLessThanOrEqual(10_000);
  });
});

describe("createStatsCache data watermark", () => {
  it("recomputes inside the TTL when the watermark moves (a write happened)", async () => {
    const s = setup();
    await s.cache.get(s.compute);
    s.setWatermark("w2");
    expect(await s.cache.get(s.compute)).toEqual({ n: 2 });
    expect(s.cache.snapshot().watermark).toBe("w2");
  });

  it("an unchanged watermark plus an expired TTL still recomputes", async () => {
    const s = setup();
    await s.cache.get(s.compute);
    s.advance(5_001);
    expect(await s.cache.get(s.compute)).toEqual({ n: 2 });
  });

  it("records the watermark it computed against and exposes it via snapshot", async () => {
    const s = setup();
    expect(s.cache.snapshot()).toEqual({
      cached: false,
      expiresAt: null,
      watermark: null,
      inFlight: false,
      generation: 0,
    });
    await s.cache.get(s.compute);
    const snap = s.cache.snapshot();
    expect(snap.cached).toBe(true);
    expect(snap.watermark).toBe("w1");
    expect(snap.expiresAt).toBe(CLOCK_START + 5_000);
    expect(snap.inFlight).toBe(false);
  });

  it("without a watermark provider the TTL is the only freshness signal", async () => {
    const s = setup({ watermark: false });
    await s.cache.get(s.compute);
    s.setWatermark("ignored");
    expect(await s.cache.get(s.compute)).toEqual({ n: 1 });
    s.advance(5_001);
    expect(await s.cache.get(s.compute)).toEqual({ n: 2 });
  });
});

describe("createStatsCache single-flight", () => {
  it("collapses concurrent gets into one computation", async () => {
    const s = setup();
    const gate = deferred<{ n: number }>();
    let calls = 0;
    const slow = () => {
      calls += 1;
      return gate.promise;
    };

    const pending = [s.cache.get(slow), s.cache.get(slow), s.cache.get(slow)];
    expect(s.cache.snapshot().inFlight).toBe(true);
    await flush(); // the flight reads the watermark before it computes
    expect(calls).toBe(1);
    gate.resolve({ n: 42 });

    const results = await Promise.all(pending);
    expect(results).toEqual([
      { n: 42 },
      { n: 42 },
      { n: 42 },
    ]);
    expect(calls).toBe(1);
    expect(s.calls()).toBe(0);
    expect(s.cache.snapshot().inFlight).toBe(false);
  });

  it("a caller arriving during a flight gets the computed value, not a second query", async () => {
    const s = setup();
    let calls = 0;
    const counted = async () => {
      calls += 1;
      await Promise.resolve();
      return { n: calls };
    };
    const first = s.cache.get(counted);
    const second = s.cache.get(counted);
    expect(await Promise.all([first, second])).toEqual([{ n: 1 }, { n: 1 }]);
    expect(calls).toBe(1);
  });

  it("propagates a computation failure to every waiter and caches nothing", async () => {
    const s = setup();
    const boom = vi.fn(async () => {
      throw new Error("db down");
    });
    const attempts = [s.cache.get(boom), s.cache.get(boom)];
    await expect(Promise.all(attempts)).rejects.toThrow("db down");
    expect(s.cache.snapshot().cached).toBe(false);
    expect(boom).toHaveBeenCalledTimes(1);

    // The next request retries instead of being poisoned by the failure.
    await expect(s.cache.get(s.compute)).resolves.toEqual({ n: 1 });
  });
});

describe("createStatsCache invalidation", () => {
  it("invalidate() forces the next read to recompute", async () => {
    const s = setup();
    await s.cache.get(s.compute);
    s.cache.invalidate();
    expect(s.cache.snapshot().cached).toBe(false);
    expect(await s.cache.get(s.compute)).toEqual({ n: 2 });
  });

  it("bumps the generation so a value computed across an invalidation is never published", async () => {
    const s = setup();
    const gate = deferred<{ n: number }>();
    const slow = () => gate.promise;

    const pending = s.cache.get(slow);
    await flush(); // computation is running (and has already read its watermark)
    s.cache.invalidate(); // the mutation landed mid-computation
    gate.resolve({ n: 7 });

    expect(await pending).toEqual({ n: 7 }); // the caller is still answered
    expect(s.cache.snapshot().cached).toBe(false); // but nothing was cached
    expect(await s.cache.get(s.compute)).toEqual({ n: 1 });
  });

  it("invalidateStatsCache() drives the shared singleton the route uses", async () => {
    // The exported helper must invalidate the very instance `/api/stats` reads
    // from, otherwise the mutation routes would be clearing a different cache.
    // Deliberately no computation here: the singleton's watermark reader hits
    // Prisma, which has no place in a unit test.
    const { dashboardStatsCache } = await import("@/lib/stats-cache");
    const before = dashboardStatsCache.snapshot();
    expect(before.cached).toBe(false);
    invalidateStatsCache();
    const after = dashboardStatsCache.snapshot();
    expect(after.generation).toBe(before.generation + 1);
    expect(after.cached).toBe(false);
  });
});
