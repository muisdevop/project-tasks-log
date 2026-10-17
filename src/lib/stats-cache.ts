/**
 * PF-03: a tiny in-process, short-TTL cache for the `/api/stats` aggregation.
 *
 * Why this exists: the dashboard client refetches `/api/stats` on every mount,
 * so with several panels/tabs (or a fast navigation back to the dashboard) the
 * same expensive group-by ran against the database over and over. The cache is
 * deliberately minimal — one entry, plain module state, no external dependency
 * — and is made safe against staleness in two independent ways:
 *
 * 1. DATA WATERMARK (the important one). Before serving an entry we read a cheap
 *    fingerprint of the rows behind the numbers — `count` + `max(updatedAt)` for
 *    Task, SubTask, Project and Job. Any create/update bumps `max(updatedAt)`
 *    (every one of those models has `@updatedAt`) and any hard delete (subtasks
 *    and break cascades really are deleted) bumps `count`, so a change to the
 *    data shows up as a different watermark and the entry is recomputed. This is
 *    what keeps mutation routes OUTSIDE this codebase's own control honest:
 *    `/api/subtasks`, `/api/breaks`, `/api/breaks/log`, `/api/projects*` and
 *    `/api/jobs*` need no changes to invalidate the dashboard.
 * 2. EXPLICIT INVALIDATION on the routes we do own, which is also instant:
 *    `/api/tasks` POST and PATCH call {@link invalidateStatsCache} after their
 *    transaction commits.
 *
 * Ordering detail that makes (1) work: the watermark is read BEFORE the
 * aggregation runs, so a mutation that lands mid-compute leaves a stored
 * watermark older than the next request will read — i.e. it forces a recompute
 * instead of hiding a concurrent write.
 *
 * The TTL ({@link STATS_TTL_MS}) is only an upper bound on how long an entry can
 * live; it is what makes repeated mounts inside one burst of navigation free,
 * not what protects correctness.
 */

/** Seconds a stats payload may be reused when the data watermark is unchanged. */
export const STATS_TTL_MS = 5_000;

export type StatsCacheEntry<T> = {
  value: T;
  /** `Date.now()`-style deadline produced by the cache's own clock. */
  expiresAt: number;
  /** Watermark captured before this value was computed (null when unwatermarked). */
  watermark: string | null;
  /** Invalidations seen when the computation started. */
  generation: number;
};

export type StatsCacheOptions = {
  ttlMs?: number;
  /** Injectable clock, so TTL behaviour is testable without fake timers. */
  now?: () => number;
  /** Cheap fingerprint of the underlying rows; a change forces a recompute. */
  watermark?: () => Promise<string | null>;
};

export type StatsCache<T> = {
  /** Returns the cached payload when fresh, otherwise computes it (single-flight). */
  get: (compute: () => Promise<T>) => Promise<T>;
  /** Drops the entry and marks any in-flight computation as unpublishable. */
  invalidate: () => void;
  /** Read-only view of the live entry for tests/diagnostics. */
  snapshot: () => {
    cached: boolean;
    expiresAt: number | null;
    watermark: string | null;
    inFlight: boolean;
    generation: number;
  };
};

export function createStatsCache<T>(options: StatsCacheOptions = {}): StatsCache<T> {
  const ttlMs = options.ttlMs ?? STATS_TTL_MS;
  const now = options.now ?? (() => Date.now());
  const readWatermark = options.watermark;

  let entry: StatsCacheEntry<T> | null = null;
  let inflight: Promise<StatsCacheEntry<T>> | null = null;
  let generation = 0;

  function isFresh(watermark: string | null): boolean {
    if (!entry || entry.expiresAt <= now()) return false;
    return entry.watermark === watermark;
  }

  return {
    async get(compute) {
      // A flight already running is joined rather than duplicated: that is the
      // single-flight half of PF-03 (N simultaneous dashboard mounts = 1 set of
      // aggregates).
      if (inflight) {
        return (await inflight).value;
      }

      const startedAtGeneration = generation;
      const promise = (async (): Promise<StatsCacheEntry<T>> => {
        // Read the watermark BEFORE computing: see the ordering note in the
        // file header — it is what makes a mid-compute mutation visible.
        const watermark = readWatermark ? await readWatermark() : null;
        if (isFresh(watermark) && entry) {
          return entry;
        }
        const value = await compute();
        const published: StatsCacheEntry<T> = {
          value,
          expiresAt: now() + ttlMs,
          watermark,
          generation: startedAtGeneration,
        };
        // A mutation invalidated while we were computing: hand this caller the
        // value it asked for, but never publish a possibly-half-stale entry.
        if (published.generation === generation) {
          entry = published;
        }
        return published;
      })();

      // The awaiters below see the rejection; this handler only keeps a failed
      // fan-out from surfacing as an unhandled rejection in the server logs.
      promise.catch(() => undefined);
      inflight = promise;
      void promise
        .finally(() => {
          if (inflight === promise) inflight = null;
        })
        .catch(() => undefined);

      return (await promise).value;
    },

    invalidate() {
      generation += 1;
      entry = null;
    },

    snapshot() {
      return {
        cached: Boolean(entry && entry.expiresAt > now()),
        expiresAt: entry?.expiresAt ?? null,
        watermark: entry?.watermark ?? null,
        inFlight: inflight !== null,
        generation,
      };
    },
  };
}

/**
 * `count` + `max(updatedAt)` over the four models `/api/stats` aggregates.
 * Four indexed-ish single-row queries instead of the full job→project→task→
 * subtask graph, and provider-agnostic (Prisma 7 aggregate works the same on
 * SQLite and Postgres). Prisma is imported lazily so the cache itself stays
 * unit-testable without a database.
 */
export async function readStatsDataWatermark(): Promise<string> {
  const { prisma } = await import("@/lib/prisma");
  const [tasks, subtasks, projects, jobs] = await Promise.all([
    prisma.task.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }),
    prisma.subTask.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }),
    prisma.project.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }),
    prisma.job.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }),
  ]);
  const parts = [tasks, subtasks, projects, jobs].map(
    (row) => `${row._count._all}:${row._max.updatedAt ? row._max.updatedAt.getTime() : 0}`,
  );
  return parts.join("|");
}

/** Shape-free singleton used by `/api/stats` (the payload type lives in the route). */
export const dashboardStatsCache = createStatsCache<unknown>({
  ttlMs: STATS_TTL_MS,
  watermark: readStatsDataWatermark,
});

/**
 * Explicit invalidation for mutation routes we own. Call AFTER the write
 * transaction commits: `/api/tasks` POST (task created / active task banked on
 * hold) and `/api/tasks` PATCH (hold, resume, complete, cancel, log-notes).
 */
export function invalidateStatsCache(): void {
  dashboardStatsCache.invalidate();
}
