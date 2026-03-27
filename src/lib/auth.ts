import bcrypt from "bcryptjs";
import { getSessionUsername } from "@/lib/session";
import { prisma } from "@/lib/prisma";

function getExpectedUsername(): string {
  return process.env.APP_USERNAME ?? "admin";
}

function normalizePossibleQuotedEnv(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, "");
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
    computedHashPromise = bcrypt.hash(rawPlain, 10);
  }
  return computedHashPromise;
}

export async function validateLogin(username: string, password: string): Promise<boolean> {
  if (username !== getExpectedUsername()) {
    return false;
  }

  const dbSettings = await prisma.userSettings.findUnique({
    where: { id: 1 },
    select: { passwordHash: true },
  });
  const dbHash = dbSettings?.passwordHash ?? null;
  if (dbHash) {
    return bcrypt.compare(password, dbHash);
  }

  const hash = getPasswordHashIfAvailable();
  if (hash) {
    return bcrypt.compare(password, hash);
  }

  const computedHash = await getPasswordHashFromPlaintextIfAvailable();
  if (!computedHash) {
    throw new Error("No APP_PASSWORD_HASH (usable) or APP_PASSWORD provided.");
  }

  // Password compare against computed hash; guarantees default credentials work.
  return bcrypt.compare(password, computedHash);
}

export async function verifyCurrentPassword(currentPassword: string): Promise<boolean> {
  const username = getExpectedUsername();
  return validateLogin(username, currentPassword);
}

export async function updateDbPassword(newPassword: string): Promise<void> {
  const newHash = await bcrypt.hash(newPassword, 10);
  await prisma.userSettings.upsert({
    where: { id: 1 },
    update: { passwordHash: newHash },
    create: {
      id: 1,
      passwordHash: newHash,
    },
  });
}

export async function requireAuth(): Promise<string> {
  const username = await getSessionUsername();
  if (!username) {
    throw new Error("Unauthorized");
  }
  return username;
}
