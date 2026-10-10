type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

const CLEANUP_INTERVAL_MS = 60_000;

if (typeof setInterval !== "undefined") {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, CLEANUP_INTERVAL_MS);
  // Never keep the process alive just for bucket cleanup.
  timer.unref?.();
}

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

/**
 * Fixed-window in-memory rate limiter. Suitable for the single-instance
 * self-hosted deployment this app targets; scale out would need a shared store.
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return { ok: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { ok: true };
}

/**
 * AI-03 / MF-02: fixed-window limiters for humans (by IP) and for agents
 * (by API-token id), plus the shared client-IP reader the routes used to
 * duplicate. Same in-process trade-offs as `checkRateLimit` below.
 */
export type RateLimitPreset = { limit: number; windowMs: number };

/**
 * Tuned for a single-user, single-container deployment. `api` is the agent-loop
 * guard: one runaway token gets throttled on its own id, so it cannot exhaust
 * Chromium (exports) or the database connection pool.
 */
export const RATE_LIMIT_PRESETS: Record<string, RateLimitPreset> = {
  /** Existing human login budget (unchanged). */
  login: { limit: 5, windowMs: 5 * 60_000 },
  /** Any authenticated API call made with a Bearer token, per token. */
  api: { limit: 120, windowMs: 60_000 },
  /** Unauthenticated API noise, per IP. */
  anonymous: { limit: 30, windowMs: 60_000 },
  /** Minting API tokens is rare and destructive — a tight per-session budget. */
  "tokens-mint": { limit: 10, windowMs: 5 * 60_000 },
  "tokens-list": { limit: 60, windowMs: 60_000 },
  /** MF-04: the admin feed is a whole-database read; polling loops are a bug. */
  "admin-events": { limit: 120, windowMs: 60_000 },
};

/** Thrown by `assertApiRateLimit`; `toErrorResponse` maps it to 429 + Retry-After. */
export class RateLimitedError extends Error {
  readonly status = 429;
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number, message = "Too many requests.") {
    super(`${message} Retry in ${retryAfterSeconds}s.`);
    this.name = "RateLimitedError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export type LimiterSubject = {
  /** Set for token-authenticated callers: the limiter keys on the token id. */
  tokenId?: number | null;
  /** Fallback key for cookie/unauthenticated callers. */
  ip: string;
};

/**
 * `login:1.2.3.4` / `api:token:7` / `tokens-mint:ip:1.2.3.4`. The token-id form
 * keeps one compromised token's loop from burning the budget of another.
 */
export function limiterKeyFor(subject: LimiterSubject, bucket: string): string {
  const who = subject.tokenId ? `token:${subject.tokenId}` : `ip:${subject.ip}`;
  return `${bucket}:${who}`;
}

export function checkBucketRateLimit(
  subject: LimiterSubject,
  bucket: keyof typeof RATE_LIMIT_PRESETS | string,
): RateLimitResult {
  const preset = RATE_LIMIT_PRESETS[bucket] ?? { limit: 60, windowMs: 60_000 };
  return checkRateLimit(limiterKeyFor(subject, bucket), preset.limit, preset.windowMs);
}

/** Rate-limit hits are security-relevant (AI-03), so they carry a typed error. */
export function assertBucketRateLimit(subject: LimiterSubject, bucket: string): void {
  const result = checkBucketRateLimit(subject, bucket);
  if (!result.ok) {
    throw new RateLimitedError(result.retryAfterSeconds);
  }
}

/**
 * Best available client IP behind Docker/Coolify reverse proxies. X-Forwarded-For
 * is attacker-controlled on a bare install, so this is only ever a limiter key —
 * never an authorisation input.
 */
export function clientIp(request: { headers: Headers }): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Test helper: clears all buckets. */
export function resetRateLimits(): void {
  buckets.clear();
}
