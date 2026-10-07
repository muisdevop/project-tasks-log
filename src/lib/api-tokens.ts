/**
 * AI-02: API tokens — the machine-credential half of authentication.
 *
 * Design notes
 * - A token is `gid_<40 hex>` (20 random bytes). The plaintext is returned to
 *   the operator exactly once at creation and never stored anywhere: the
 *   database holds only its SHA-256 digest (`tokenHash`), so a database leak is
 *   not a credential leak.
 * - Verification is an indexed digest lookup followed by `timingSafeEqual`, so
 *   neither the comparison cost nor the failure mode depends on the token
 *   content, and a missing row cannot be distinguished from a wrong digest by
 *   timing (a dummy comparison burns the same work).
 * - `scope` is `read` (GET only) or `write` (GET/POST/PATCH/DELETE). Tokens
 *   never outlive `expiresAt` and stop working the moment `revokedAt` is set,
 *   which is the revocation path the session cookie never had.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { ApiToken } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logSecurityEvent } from "@/lib/security-events";

export type ApiScope = "read" | "write";

export const TOKEN_PREFIX = "gid_";

/** `lastUsedAt` is bookkeeping, not correctness: one write per token per minute at most. */
const LAST_USED_FLUSH_MS = 60_000;
const lastUsedFlushes = new Map<number, number>();

/** The two scopes, exported so validators/docs can share the vocabulary. */
export const API_SCOPES: readonly ApiScope[] = ["read", "write"] as const;

export function isApiScope(value: unknown): value is ApiScope {
  return value === "read" || value === "write";
}

export function hashApiToken(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

/**
 * Mint a fresh token. Returns the plaintext (for the one-time response body)
 * and the digest to persist.
 */
export function generateApiToken(): { plaintext: string; tokenHash: string } {
  const plaintext = `${TOKEN_PREFIX}${randomBytes(20).toString("hex")}`;
  return { plaintext, tokenHash: hashApiToken(plaintext) };
}

/**
 * Digest-vs-digest comparison that is constant time for equal-length inputs and
 * simply false for anything else (a truncated/corrupted stored digest must never
 * authenticate).
 */
export function tokenDigestMatches(candidateHash: string, storedHash: string): boolean {
  if (
    typeof candidateHash !== "string" ||
    typeof storedHash !== "string" ||
    candidateHash.length !== storedHash.length ||
    candidateHash.length === 0
  ) {
    return false;
  }
  return timingSafeEqual(Buffer.from(candidateHash, "utf8"), Buffer.from(storedHash, "utf8"));
}

/** Burns the same work as a real comparison when no row matched (anti-enumeration). */
function burnComparison(): void {
  const filler = "0".repeat(64);
  timingSafeEqual(Buffer.from(filler, "utf8"), Buffer.from(filler, "utf8"));
}

export type TokenRejection = "malformed" | "unknown" | "revoked" | "expired";

export type TokenVerification =
  | { ok: true; token: ApiToken }
  | { ok: false; reason: TokenRejection };

/** Well-formedness gate before touching the database at all. */
export function looksLikeApiToken(value: string): boolean {
  return new RegExp(`^${TOKEN_PREFIX}[a-f0-9]{40}$`).test(value);
}

/**
 * Resolve a Bearer token to a live row, or explain why it is not usable. The
 * reason is what feeds the security event — never the token itself.
 */
export async function verifyApiToken(plaintext: string, ip: string | null): Promise<TokenVerification> {
  if (!looksLikeApiToken(plaintext)) {
    logSecurityEvent({ evt: "token.rejected", ip, detail: "malformed" });
    return { ok: false, reason: "malformed" };
  }

  const candidateHash = hashApiToken(plaintext);
  const stored = await prisma.apiToken.findUnique({ where: { tokenHash: candidateHash } });

  if (!stored) {
    burnComparison();
    logSecurityEvent({ evt: "token.rejected", ip, detail: "unknown" });
    return { ok: false, reason: "unknown" };
  }
  if (!tokenDigestMatches(candidateHash, stored.tokenHash)) {
    logSecurityEvent({ evt: "token.rejected", ip, detail: "digest_mismatch" });
    return { ok: false, reason: "unknown" };
  }
  if (stored.revokedAt) {
    logSecurityEvent({
      evt: "token.revoked",
      actor: stored.name,
      ip,
      detail: { tokenId: stored.id },
    });
    return { ok: false, reason: "revoked" };
  }
  if (stored.expiresAt && stored.expiresAt.getTime() <= Date.now()) {
    logSecurityEvent({
      evt: "token.expired",
      actor: stored.name,
      ip,
      detail: { tokenId: stored.id },
    });
    return { ok: false, reason: "expired" };
  }

  await touchLastUsed(stored.id);
  return { ok: true, token: stored };
}

/**
 * Throttled `lastUsedAt` write: at most one UPDATE per token per minute, kept
 * off the critical path (a failed housekeeping write must not 500 an auth
 * request), and swallowed by `catch`.
 */
async function touchLastUsed(tokenId: number): Promise<void> {
  const now = Date.now();
  const last = lastUsedFlushes.get(tokenId) ?? 0;
  if (now - last < LAST_USED_FLUSH_MS) return;
  lastUsedFlushes.set(tokenId, now);
  try {
    await prisma.apiToken.update({ where: { id: tokenId }, data: { lastUsedAt: new Date(now) } });
  } catch {
    // Ignore: lastUsedAt is advisory. Drop the memo so the next call retries.
    lastUsedFlushes.delete(tokenId);
  }
}

/** Metadata view of a token (what `GET /api/tokens` returns — never the secret). */
export type ApiTokenView = {
  id: number;
  name: string;
  scope: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  active: boolean;
};

export function toApiTokenView(row: ApiToken, now = Date.now()): ApiTokenView {
  return {
    id: row.id,
    name: row.name,
    scope: row.scope,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    active: !row.revokedAt && (!row.expiresAt || row.expiresAt.getTime() > now),
  };
}

/** Test helper: forget the `lastUsedAt` throttle so each call writes again. */
export function resetTokenTouchThrottle(): void {
  lastUsedFlushes.clear();
}
