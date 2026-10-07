const KNOWN_DEFAULT_SECRETS = new Set([
  "change-this-in-production",
  "changeme",
  "change-me",
  "secret",
  "session-secret",
  "your-secret-here",
  "keyboard cat",
]);

type StartupEnv = Record<string, string | undefined>;

export function getStartupWarnings(env: StartupEnv = process.env): string[] {
  const warnings: string[] = [];
  const secret = (env.SESSION_SECRET ?? "").trim();
  // Known defaults are checked first: a 12-character placeholder such as
  // "keyboard cat" is a leaked example, not merely a short secret, and the
  // operator needs the accurate reason to fix it.
  if (KNOWN_DEFAULT_SECRETS.has(secret.toLowerCase())) {
    warnings.push("SESSION_SECRET matches a well-known default value.");
  } else if (!secret || secret.length < 16) {
    warnings.push("SESSION_SECRET is unset or shorter than 16 characters.");
  }
  if (env.APP_PASSWORD) {
    warnings.push("APP_PASSWORD (plaintext) is set; prefer APP_PASSWORD_HASH.");
  }
  return warnings;
}

/**
 * Fails fast in production when insecure defaults would silently weaken
 * authentication (SEC-03). In development the same conditions are warnings.
 */
export function assertStartupConfig(env: StartupEnv = process.env): void {
  if (env.NODE_ENV !== "production") {
    for (const warning of getStartupWarnings(env)) {
      console.warn(`[startup] WARNING: ${warning}`);
    }
    return;
  }

  const secret = (env.SESSION_SECRET ?? "").trim();
  if (!secret || secret.length < 16 || KNOWN_DEFAULT_SECRETS.has(secret.toLowerCase())) {
    throw new Error(
      "Refusing to start: SESSION_SECRET must be a unique value of at least 16 characters (not a known default).",
    );
  }

  if (env.APP_PASSWORD) {
    throw new Error(
      "Refusing to start: APP_PASSWORD plaintext is not allowed in production. Use APP_PASSWORD_HASH (see scripts/hash-password).",
    );
  }
}
