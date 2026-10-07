import bcrypt from "bcryptjs";
import { getSessionUsername } from "@/lib/session";
import { prisma } from "@/lib/prisma";

/** Thrown by requireAuth so route handlers can map auth failures to 401 precisely. */
export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
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

function getExpectedUsername(): string {
  return process.env.APP_USERNAME ?? "admin";
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

export async function requireAuth(): Promise<string> {
  const username = await getSessionUsername();
  if (!username) {
    throw new UnauthorizedError();
  }
  return username;
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
