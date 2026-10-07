import bcrypt from "bcryptjs";
import { getSessionUsername } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  assertBucketRateLimit,
  checkRateLimit,
  clientIp,
  RateLimitedError,
} from "@/lib/rate-limit";
import { logSecurityEvent } from "@/lib/security-events";
import { verifyApiToken, type ApiScope } from "@/lib/api-tokens";

/** Thrown by requireAuth so route handlers can map auth failures to 401 precisely. */
export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

/**
 * Authenticated, but not allowed to do this (a `read` token calling a mutating
 * route, or a token touching the cookie-only token manager). Defined here, not
 * in api-error.ts, because api-error.ts already imports this module: a reverse
 * import would make the two files a cycle that resolves classes at load time.
 */
export class ForbiddenError extends Error {
  readonly status = 403;

  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** Thrown when no usable credential source is configured (BF-03). */
export class AuthNotConfiguredError extends Error {
  constructor() {
    super("No APP_PASSWORD_HASH (usable) or APP_PASSWORD provided.");
    this.name = "AuthNotConfiguredError";
  }
}

/** Current OWASP-recommended cost floor (SEC-10). */
export const BCRYPT_COST = 12;

/** A `Bearer` token is presented this many times from one IP in 5 minutes. */
const TOKEN_REJECT_LIMIT = 30;
const TOKEN_REJECT_WINDOW_MS = 5 * 60_000;

function getExpectedUsername(): string {
  return process.env.APP_USERNAME ?? "admin";
}

/** The acting identity for every credential: this app has exactly one owner. */
export function expectedUsername(): string {
  return getExpectedUsername();
}

/**
 * Strips surrounding quotes that dotenv/Compose examples leave on a value, then
 * trims. Order matters: trimming first made `"'  $2b$12$…  '"` (whitespace
 * inside the quotes) fail the bcrypt shape check and be silently treated as
 * "no password configured".
 */
function normalizePossibleQuotedEnv(value: string): string {
  return value.replace(/^\s*['"]|['"]\s*$/g, "").trim();
}

function looksLikeBcryptHash(value: string): boolean {
  const v = normalizePossibleQuotedEnv(value);
  // Example: $2b$10$<60chars>
  return /^\$2[aby]\$\d{2}\$/.test(v) && v.length >= 50;
}

function getPasswordHashIfAvailable(): string | null {
  const raw = process.env.APP_PASSWORD_HASH;
  if (!raw) return null;
  const normalized = normalizePossibleQuotedEnv(raw);
  if (!looksLikeBcryptHash(normalized)) return null;
  return normalized;
}

let computedHashPromise: Promise<string> | null = null;
async function getPasswordHashFromPlaintextIfAvailable(): Promise<string | null> {
  const plaintext = process.env.APP_PASSWORD;
  if (!plaintext) return null;
  const rawPlain = plaintext.trim();
  if (!rawPlain) return null;

  if (!computedHashPromise) {
    computedHashPromise = bcrypt.hash(rawPlain, BCRYPT_COST);
  }
  return computedHashPromise;
}

let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = bcrypt.hash("timing-equalizer", BCRYPT_COST);
  }
  return dummyHashPromise;
}

function hashCost(hash: string): number {
  const cost = Number(hash.split("$")[2]);
  return Number.isNaN(cost) ? 0 : cost;
}

export async function validateLogin(username: string, password: string): Promise<boolean> {
  const dbSettings = await prisma.userSettings.findUnique({
    where: { id: 1 },
    select: { passwordHash: true },
  });
  const envHash = getPasswordHashIfAvailable();
  const computedHash = await getPasswordHashFromPlaintextIfAvailable();
  const configuredHash = dbSettings?.passwordHash ?? envHash ?? computedHash;

  // Always run a bcrypt comparison (against a dummy hash when the login can
  // never succeed) so response time does not reveal valid usernames (SEC-02).
  if (username !== getExpectedUsername() || !configuredHash) {
    const dummy = await getDummyHash();
    await bcrypt.compare(password, dummy);
    if (!configuredHash) {
      throw new AuthNotConfiguredError();
    }
    return false;
  }

  const ok = await bcrypt.compare(password, configuredHash);
  if (!ok) {
    return false;
  }

  // Opportunistically upgrade legacy low-cost hashes (SEC-10). Also bumps
  // tokenVersion, which evicts any other live sessions.
  if (hashCost(configuredHash) < BCRYPT_COST) {
    await updateDbPassword(password);
  }
  return true;
}

export async function verifyCurrentPassword(currentPassword: string): Promise<boolean> {
  const username = getExpectedUsername();
  return validateLogin(username, currentPassword);
}

export async function updateDbPassword(newPassword: string): Promise<void> {
  const newHash = await bcrypt.hash(newPassword, BCRYPT_COST);
  await prisma.userSettings.upsert({
    where: { id: 1 },
    update: { passwordHash: newHash, tokenVersion: { increment: 1 } },
    create: {
      id: 1,
      passwordHash: newHash,
    },
  });
}

/** Who (or what) authenticated a request. */
export type AuthContext = {
  /** The single-user owner's username, for both credential kinds. */
  actor: string;
  /** `session` = browser cookie, `token` = `Authorization: Bearer` (AI-02). */
  via: "session" | "token";
  /** Cookie sessions keep full power; tokens are capped by their stored scope. */
  scope: ApiScope;
  /** ApiToken row id for Bearer callers, null for the cookie path. */
  tokenId: number | null;
  ip: string;
};

/** Reads `Authorization: Bearer <token>` without ever echoing it onward. */
export function bearerTokenOf(request?: Request): string | null {
  if (!request) return null;
  const header = request.headers.get("authorization");
  if (!header) return null;
  const [scheme, ...rest] = header.trim().split(/\s+/);
  if (!scheme || scheme.toLowerCase() !== "bearer") return null;
  const value = rest.join(" ").trim();
  return value || null;
}

/**
 * Authentication resolution order (AI-02) — the first match wins:
 *
 * 1. `Authorization: Bearer <token>` (when the handler forwarded its `Request`)
 *    → SHA-256 digest lookup + constant-time compare, then revoked/expired
 *    checks, then a throttled `lastUsedAt`, then the per-token rate limiter.
 *    Rejections are security events; repeated rejections from one IP escalate
 *    to 429 rather than burning more database lookups.
 * 2. The `stl_session` cookie, verified exactly as before (`getSessionUsername`,
 *    token-version revocation). Unchanged and Bearer-independent, so a handler
 *    that does not forward its `Request` behaves precisely as it did before.
 * 3. Nothing → `null` (callers map it to 401).
 *
 * A request carrying both is treated as the token it presents: machine
 * credentials win so an agent cannot inherit the browser's full-power session.
 */
export async function authenticate(request?: Request): Promise<AuthContext | null> {
  const ip = request ? clientIp(request) : "unknown";
  const bearer = bearerTokenOf(request);

  if (bearer) {
    const verified = await verifyApiToken(bearer, ip);
    if (!verified.ok) {
      // Count the rejection; past the budget, stop burning database lookups on
      // this IP and answer 429 instead of an endless stream of 401s (AI-03).
      const blocked = checkRateLimit(
        `token-reject:ip:${ip}`,
        TOKEN_REJECT_LIMIT,
        TOKEN_REJECT_WINDOW_MS,
      );
      if (!blocked.ok) {
        logSecurityEvent({ evt: "token.rate_limited", ip, detail: "too_many_rejections" });
        throw new RateLimitedError(blocked.retryAfterSeconds, "Too many rejected tokens.");
      }
      return null;
    }
    const tokenId = verified.token.id;
    const scope: ApiScope = verified.token.scope === "write" ? "write" : "read";
    assertBucketRateLimit({ tokenId, ip }, "api");
    return { actor: getExpectedUsername(), via: "token", scope, tokenId, ip };
  }

  const username = await getSessionUsername();
  if (!username) {
    return null;
  }
  return { actor: username, via: "session", scope: "write", tokenId: null, ip };
}

/**
 * House guard for every protected route. Returns the acting username, so the
 * existing `await requireAuth()` / `const username = await requireAuth()` call
 * sites keep working; pass the handler's `Request` to also accept Bearer tokens.
 */
export async function requireAuth(request?: Request): Promise<string> {
  const context = await requireAuthContext(request);
  return context.actor;
}

export async function requireAuthContext(request?: Request): Promise<AuthContext> {
  const context = await authenticate(request);
  if (!context) {
    throw new UnauthorizedError();
  }
  return context;
}

/** Guard for mutating routes: a `read` token gets 403, a cookie session passes. */
export async function requireWriteAccess(request?: Request): Promise<AuthContext> {
  const context = await requireAuthContext(request);
  if (context.scope !== "write") {
    logSecurityEvent({
      evt: "token.rejected",
      actor: context.actor,
      ip: context.ip,
      detail: { reason: "read_scope_on_write_route", tokenId: context.tokenId },
    });
    throw new ForbiddenError("This API token is read-only.");
  }
  return context;
}

/**
 * Cookie-only guard (AI-02): an API token must never reach the surfaces that
 * would let it escalate — minting, listing or revoking tokens, and the admin
 * audit feed. Otherwise one leaked read token turns into full control, and a
 * long-lived token in an agent config can harvest every task title in the
 * database. `usage` names the refused action so the 403 explains itself instead
 * of quoting the token manager at an unrelated route.
 */
export async function requireSessionAuth(
  request?: Request,
  usage = "manage API tokens",
): Promise<string> {
  if (bearerTokenOf(request)) {
    logSecurityEvent({
      evt: "token.mint_denied",
      ip: request ? clientIp(request) : "unknown",
      detail: "token_used_on_session_only_route",
    });
    throw new ForbiddenError(
      `API tokens cannot ${usage}. Use the browser session cookie.`,
    );
  }
  return requireAuth();
}

/**
 * True when at least one credential source could authenticate a login: a stored
 * hash, APP_PASSWORD_HASH, or APP_PASSWORD. Used for the first-run setup banner
 * so a fresh install explains itself instead of returning a bare 500 (UX-06).
 */
export async function isLoginConfigured(): Promise<boolean> {
  try {
    const settings = await prisma.userSettings.findUnique({
      where: { id: 1 },
      select: { passwordHash: true },
    });
    if (settings?.passwordHash) return true;
  } catch {
    // Database unreachable: fall through to the env check so callers still get
    // an answer instead of throwing during render.
  }

  return Boolean(
    getPasswordHashIfAvailable() || process.env.APP_PASSWORD?.trim(),
  );
}

/**
 * Idempotent bootstrap step: the app keeps exactly one settings row (id 1) and
 * several flows assume it exists. Creating it at startup means a fresh volume on
 * either database provider never starts out "missing its own configuration".
 */
export async function ensureSettingsRow(): Promise<void> {
  await prisma.userSettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
}
