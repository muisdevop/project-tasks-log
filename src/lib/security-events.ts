/**
 * MF-02 (remainder): a single place that emits machine-readable security events.
 *
 * Every event is ONE line of JSON on stderr with a fixed shape, so `docker logs`
 * / Coolify log drains can grep it without parsing prose:
 *
 *   {"evt":"login.failed","at":"2026-10-08T09:00:00.000Z","actor":"admin","ip":"10.0.0.5","detail":"invalid_credentials"}
 *
 * Secrets never make it into a line: values are filtered through `redact()`,
 * sensitive key names are dropped, and `detail` is length-capped. Call sites are
 * still expected to pass only non-sensitive descriptors (a username, an IP, a
 * reason code) — never a password, token, hash, or header value.
 */

export type SecurityEventKind =
  | "login.failed"
  | "login.rate_limited"
  | "token.rejected"
  | "token.revoked"
  | "token.expired"
  | "token.rate_limited"
  | "token.created"
  | "token.revoked_by_operator"
  | "token.mint_denied"
  | "idempotency.conflict";

export type SecurityEventInput = {
  evt: SecurityEventKind;
  /** Acting identity: the session username, a token name, or an attempted username. */
  actor?: string | null;
  ip?: string | null;
  /** Short reason code. Anything secret-bearing is dropped or masked. */
  detail?: string | Record<string, unknown> | null;
};

export type SecurityEvent = {
  evt: SecurityEventKind;
  at: string;
  actor: string | null;
  ip: string | null;
  detail: string | null;
};

const MAX_DETAIL_CHARS = 200;
/** Object details are bounded by entry count and per-value length instead of a
 * final slice: cutting a serialised object mid-string would produce a log line
 * that no longer parses. */
const MAX_DETAIL_ENTRIES = 8;
const MAX_DETAIL_VALUE_CHARS = 80;

/** Key names that must never be serialised into a log line. */
const SENSITIVE_KEY =
  /^(password|passwd|currentpassword|newpassword|confirmpassword|secret|sessionsecret|token|tokenmaterial|plaintext|apiToken|apikey|authorization|cookie|setcookie|hash|tokenhash|passwordhash|idempotencykey)$/i;

/** `password=…`, "Authorization: Bearer …" style pairs inside a free-text detail. Values already masked by an earlier pass are skipped. */
const SENSITIVE_PAIR =
  /(password|passwd|secret|token|hash|authorization|cookie|api[-_]?key)\s*["']?\s*[:=]\s*(?!\[redacted\])\S+/gi;

/** `Bearer xyz` fragments. */
const BEARER_FRAGMENT = /bearer\s+[a-z0-9._~+/=-]+/gi;

/** Long hex/base64 runs: SHA-256 digests, bcrypt hashes and generated token bodies all look like this. */
const SECRETISH_RUN = /\b[a-f0-9]{20,}\b/gi;

/** A minted API token (`gid_<40 hex>`); `_` is a word character, so the generic digest pattern above cannot reach it. */
const TOKEN_MATERIAL = /gid_[a-f0-9]{40}/gi;

/**
 * Best-effort redaction of anything that looks like credential material. Applied
 * to the final string so a caller cannot smuggle a secret in through a reason
 * code; a dropped value becomes `[redacted]` rather than being silently omitted.
 */
export function redact(value: string): string {
  return value
    .replace(SENSITIVE_PAIR, (match) => {
      const separator = match.includes("=") ? "=" : ":";
      return `${match.split(/[:=]/)[0].trim()}${separator}[redacted]`;
    })
    .replace(BEARER_FRAGMENT, "bearer [redacted]")
    .replace(TOKEN_MATERIAL, "[redacted]")
    .replace(SECRETISH_RUN, "[redacted]");
}

/**
 * Masking that is safe to apply to an already-serialised JSON object: both
 * patterns only ever replace characters *inside* a quoted value, so the result
 * stays parseable. The `key: value` form is handled by {@link SENSITIVE_KEY}
 * dropping in `detailToString`.
 */
function maskEmbeddedSecrets(value: string): string {
  return value.replace(TOKEN_MATERIAL, "[redacted]").replace(SECRETISH_RUN, "[redacted]");
}

function detailToString(detail: string | Record<string, unknown> | null | undefined): string | null {
  if (detail === null || detail === undefined) return null;
  if (typeof detail === "string") {
    return redact(detail).slice(0, MAX_DETAIL_CHARS);
  }
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail).slice(0, MAX_DETAIL_ENTRIES)) {
    if (SENSITIVE_KEY.test(key)) {
      safe[key] = "[redacted]";
      continue;
    }
    if (value === null || typeof value === "number" || typeof value === "boolean") {
      safe[key] = value;
    } else if (typeof value === "string") {
      safe[key] = redact(value).slice(0, MAX_DETAIL_VALUE_CHARS);
    } else {
      // Arrays/objects are flattened to a marker: log lines must stay one line.
      safe[key] = "[object]";
    }
  }
  // Object details are bounded by field count and value length instead of being
  // sliced mid-string, which would leave the JSON line unparseable.
  return maskEmbeddedSecrets(JSON.stringify(safe));
}

/** Normalises an event to the wire shape (pure: unit-testable without a spy). */
export function buildSecurityEvent(input: SecurityEventInput, now: Date = new Date()): SecurityEvent {
  return {
    evt: input.evt,
    at: now.toISOString(),
    actor: input.actor ? redact(String(input.actor)).slice(0, 120) : null,
    ip: input.ip ? redact(String(input.ip)).slice(0, 120) : null,
    detail: detailToString(input.detail),
  };
}

/** Emits one JSON line. Never throws: logging must not take down an auth path. */
export function logSecurityEvent(input: SecurityEventInput): void {
  try {
    console.warn(JSON.stringify(buildSecurityEvent(input)));
  } catch {
    // A broken logger must not change an authentication decision.
  }
}
