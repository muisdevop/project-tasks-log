/**
 * Shared harness for the API integration suites (TC-01/TC-03 remediation).
 *
 * Every suite gets its OWN temporary SQLite file under the OS temp dir
 * (never the repo-root dev.db), a fresh Prisma client (globalThis cache is
 * deleted before the module graph is loaded), and deterministic clock/auth
 * helpers. `next/headers` cookies() is mocked so route handlers can be
 * invoked directly with plain `Request` objects; the mock records every
 * cookie write so tests can assert HttpOnly/SameSite/Secure flags exactly as
 * src/lib/session.ts sets them. Puppeteer is mocked so /api/export never
 * launches a real browser (parallel-safe, deterministic).
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SignJWT, jwtVerify } from "jose";
import { vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

export const TEST_USERNAME = "admin";
export const TEST_PASSWORD = "sup3r-secret-password";
export const SESSION_SECRET = "integration-suite-session-secret-0123456789";
export const COOKIE_NAME = "stl_session";

/**
 * Route handlers branch on `process.env.NODE_ENV` (the session cookie is `Secure`
 * only in production), so suites need to flip it. Current @types/node types that
 * key read-only, which is a type-level restriction only; assigning through a
 * mutable view keeps the intent explicit instead of repeating a cast per call site.
 */
export function setNodeEnv(value: string): void {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

export type CookieWrite = {
  name: string;
  value: string;
  options?: Record<string, unknown>;
};

export const mockCookieState = {
  jar: new Map<string, string>(),
  writes: [] as CookieWrite[],
  reset(): void {
    this.jar.clear();
    this.writes.length = 0;
  },
};

export const mockPuppeteerState = {
  fail: false,
  lastHtml: "",
  lastOptions: undefined as unknown,
};

function buildCookieJar() {
  return {
    get: (name: string) => {
      const value = mockCookieState.jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    getAll: () =>
      Array.from(mockCookieState.jar.entries(), ([name, value]) => ({
        name,
        value,
      })),
    has: (name: string) => mockCookieState.jar.has(name),
    set: (
      name: string,
      value: string,
      options?: Record<string, unknown>,
    ) => {
      mockCookieState.writes.push({ name, value, options });
      if (options && typeof options.maxAge === "number" && options.maxAge <= 0) {
        mockCookieState.jar.delete(name);
      } else {
        mockCookieState.jar.set(name, value);
      }
    },
    delete: (name: string) => {
      mockCookieState.jar.delete(name);
    },
    clear: () => {
      mockCookieState.jar.clear();
    },
    toString: () =>
      Array.from(
        mockCookieState.jar.entries(),
        ([name, value]) => `${name}=${value}`,
      ).join("; "),
  };
}

function buildPuppeteerMock() {
  return {
    default: {
      launch: async (options?: unknown) => {
        mockPuppeteerState.lastOptions = options;
        if (mockPuppeteerState.fail) {
          throw new Error("Mocked Chromium launch failure");
        }
        return {
          newPage: async () => ({
            setContent: async (html: string) => {
              mockPuppeteerState.lastHtml = html;
            },
            pdf: async () => new Uint8Array(Buffer.from("%PDF-1.4 mocked")),
          }),
          close: async () => undefined,
        };
      },
    },
  };
}

// Registered when the harness module is evaluated, i.e. before any suite
// dynamically imports a route handler. The factories return stand-ins whose
// shape only needs to cover what the routes actually call, so the module
// type is narrowed via `never` at the vi.mock boundary.
vi.mock("next/headers", () => mockCookieModule() as never);
vi.mock("puppeteer", () => mockPuppeteerModule() as never);

export function mockCookieModule(): unknown {
  return { cookies: async () => buildCookieJar() };
}

export function mockPuppeteerModule(): unknown {
  return buildPuppeteerMock();
}

export type TestDbContext = {
  tempDir: string;
  dbFile: string;
  databaseUrl: string;
};

/**
 * Creates an isolated SQLite file under the OS temp dir, points every DB
 * related env var at it, drops the cached globalThis.prisma singleton and
 * pushes prisma/schema.sqlite.prisma into the fresh file. Must be awaited
 * BEFORE importing @/lib/prisma or any route handler (use loadPrisma() /
 * dynamic import afterwards).
 */
export async function setupTestDatabase(
  label: string,
): Promise<TestDbContext> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `gid-${label}-`));
  const dbFile = path.join(tempDir, "test.db");
  const databaseUrl = `file:${dbFile.replace(/\\/g, "/")}`;

  const env = process.env as Record<string, string | undefined>;
  env.NODE_ENV = "test";
  env.DB_PROVIDER = "sqlite";
  env.DATABASE_URL = databaseUrl;
  env.DATABASE_URL_SQLITE = databaseUrl;
  env.PRISMA_SCHEMA_PATH = "prisma/schema.sqlite.prisma";
  env.SESSION_SECRET = SESSION_SECRET;
  env.APP_USERNAME = TEST_USERNAME;
  delete process.env.APP_PASSWORD;
  delete process.env.APP_PASSWORD_HASH;
  delete process.env.ALLOW_CLIENT_START_TIME;

  // The client singleton lives on globalThis outside production; wipe it so
  // a reused worker thread rebuilds against THIS temp file.
  delete (globalThis as { prisma?: unknown }).prisma;

  // Prisma 7 note: `db push --skip-generate` no longer exists; generate is
  // not part of push anymore, and --url overrides the datasource instead of
  // DATABASE_URL parsing. The repo schema keeps working unchanged.
  execSync(
    `npx prisma db push --schema prisma/schema.sqlite.prisma --url "${databaseUrl}"`,
    {
      cwd: REPO_ROOT,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
      timeout: 180_000,
    },
  );

  return { tempDir, dbFile, databaseUrl };
}

/** Loads (and caches for this file) the prisma singleton built on the temp DB. */
export async function loadPrisma(): Promise<PrismaClient> {
  const mod = await import("@/lib/prisma");
  return mod.prisma;
}

export async function teardownTestDatabase(
  ctx: TestDbContext | undefined,
  prisma: PrismaClient | undefined,
): Promise<void> {
  if (prisma) {
    await prisma.$disconnect().catch(() => undefined);
  }
  delete (globalThis as { prisma?: unknown }).prisma;
  if (ctx) {
    fs.rmSync(ctx.tempDir, { recursive: true, force: true });
  }
}

export async function createSessionToken(
  username: string,
  tokenVersion: number,
  secret: string = SESSION_SECRET,
  expiresInSeconds: number = 60 * 60 * 24 * 7,
): Promise<string> {
  return new SignJWT({ sub: username, tv: tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${expiresInSeconds}s`)
    .sign(new TextEncoder().encode(secret));
}

/** Ensures the UserSettings row exists (tokenVersion starts at 1). */
export async function ensureSettings(
  prisma: PrismaClient,
): Promise<{ tokenVersion: number }> {
  const row = await prisma.userSettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
    select: { tokenVersion: true },
  });
  return row;
}

/**
 * Authenticates like src/lib/session.createSession does (same JWT shape and
 * secret) and puts the cookie into the mocked jar. Returns the token.
 */
export async function issueAuthCookie(
  prisma: PrismaClient,
  username: string = TEST_USERNAME,
): Promise<string> {
  const { tokenVersion } = await ensureSettings(prisma);
  const token = await createSessionToken(username, tokenVersion);
  mockCookieState.jar.set(COOKIE_NAME, token);
  return token;
}

export function clearAuthCookie(): void {
  mockCookieState.jar.clear();
}

/** Builds a Request for http://localhost/api/... carrying the mocked cookies. */
export function apiRequest(
  urlPath: string,
  init?: { method?: string; body?: unknown; headers?: Record<string, string> },
): Request {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  const cookieHeader = Array.from(
    mockCookieState.jar.entries(),
    ([name, value]) => `${name}=${value}`,
  ).join("; ");
  if (cookieHeader) {
    headers.set("cookie", cookieHeader);
  }
  return new Request(`http://localhost${urlPath}`, {
    method: init?.method ?? "GET",
    headers,
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

/** Unique IP per logical login so the 5/5min rate limiter never wedges suites. */
let ipCounter = 0;
export function freshIp(): string {
  ipCounter += 1;
  return `10.77.${Math.floor(ipCounter / 254)}.${ipCounter % 254}`;
}

export async function resetLoginRateLimits(): Promise<void> {
  const { resetRateLimits } = await import("@/lib/rate-limit");
  resetRateLimits();
}

/**
 * Routes log noise away from test output: route handlers console.error on
 * failure paths, and Prisma's built-in error logger writes "prisma:error"
 * blocks via console.log whenever expected P2025/P2003 paths trigger.
 */
export function silenceConsole(): void {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
}

export async function verifySessionToken(
  token: string,
  secret: string = SESSION_SECRET,
): Promise<{ sub?: string | string[]; tv?: number }> {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
  return { sub: payload.sub, tv: payload.tv as number | undefined };
}
