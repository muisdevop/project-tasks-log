import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";

function createClient() {
  const provider = (process.env.DB_PROVIDER || "").toLowerCase();
  const schemaPath = (process.env.PRISMA_SCHEMA_PATH || "").toLowerCase();
  const resolvedUrl = process.env.DATABASE_URL?.trim();

  const hintedProvider =
    (schemaPath.includes("postgres")
      ? "postgres"
      : schemaPath.includes("sqlite")
        ? "sqlite"
        : "") ||
    (resolvedUrl?.startsWith("postgres") ? "postgres" : "") ||
    provider;

  const defaultSqliteUrl = process.env.DATABASE_URL_SQLITE?.trim() || "file:./dev.db";
  const defaultPostgresUrl =
    process.env.DATABASE_URL_POSTGRES?.trim() ||
    "postgresql://postgres:postgres@localhost:5432/postgres?schema=public";

  const url =
    resolvedUrl ||
    (hintedProvider === "postgres" || hintedProvider === "postgresql"
      ? defaultPostgresUrl
      : defaultSqliteUrl);

  const useSqlite =
    hintedProvider === "sqlite" ||
    ((hintedProvider !== "postgres" && hintedProvider !== "postgresql") && url.startsWith("file:"));

  const log: Array<"error" | "warn"> =
    process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"];

  const createSqliteClient = (connectionUrl: string) =>
    new PrismaClient({
      adapter: new PrismaBetterSqlite3({ url: connectionUrl }),
      log,
    });

  const createPostgresClient = (connectionUrl: string) =>
    new PrismaClient({
      adapter: new PrismaPg({ connectionString: connectionUrl }),
      log,
    });

  // Fail fast on any provider/env mismatch. A silent fallback to the other
  // database with default connection strings can serve an empty database in
  // production with no visible error (ST-03).
  if (useSqlite && !url.startsWith("file:")) {
    throw new Error(
      `DB_PROVIDER/DATABASE_URL mismatch: resolved provider is sqlite but DATABASE_URL is "${url}". Set DB_PROVIDER=postgres or a file: URL.`,
    );
  }
  if (!useSqlite && url.startsWith("file:")) {
    throw new Error(
      `DB_PROVIDER/DATABASE_URL mismatch: resolved provider is postgres but DATABASE_URL is "${url}". Set DB_PROVIDER=sqlite or a postgresql:// URL.`,
    );
  }

  return useSqlite ? createSqliteClient(url) : createPostgresClient(url);
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * The client is built on first *use*, not on first *import*.
 *
 * That distinction is the whole reason this file exports a proxy. Building the
 * client at module load read `DATABASE_URL` as it stood when the module graph was
 * assembled, which is before any test harness, migration script, or entrypoint has
 * finished setting the environment. Concretely: an integration test that imports a
 * route handler at the top level got a client wired to the repository's `dev.db`,
 * so its inserts and deletes landed in a developer's real data (the harness creates
 * a temporary database, but a client already built ignores it). Lazily resolving
 * means whoever sets the environment last wins, which is the behaviour every caller
 * already assumes.
 *
 * Fail-fast configuration is unaffected: the startup checks in
 * `scripts/bootstrap`/`src/lib/startup-checks.ts` still validate `DB_PROVIDER`
 * against `DATABASE_URL` before the app serves a request, and `createClient` still
 * throws on a provider mismatch — it just throws on the first query instead of at
 * import time.
 */
function resolveClient(): PrismaClient {
  const existing = globalForPrisma.prisma;
  if (existing) return existing;
  const created = createClient();
  // Outside production the cache lives on globalThis so a hot reload reuses the
  // connection pool instead of opening a new one per module evaluation.
  if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = created;
  return created;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = resolveClient() as unknown as Record<string | symbol, unknown>;
    const value = client[property as string];
    // Bind to the real client: methods read private state, and `this` would
    // otherwise be the proxy.
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(client) : value;
  },
  set(_target, property, value) {
    (resolveClient() as unknown as Record<string | symbol, unknown>)[property as string] = value;
    return true;
  },
  // `vi.spyOn(prisma, "$transaction")` and any other `Object.defineProperty`
  // against this export must land on the real client, otherwise the spy sits on
  // the empty proxy target and the `get` trap below never sees it.
  defineProperty(_target, property, descriptor) {
    Object.defineProperty(resolveClient(), property, descriptor);
    return true;
  },
  deleteProperty(_target, property) {
    return Reflect.deleteProperty(resolveClient(), property);
  },
  has(_target, property) {
    return property in resolveClient();
  },
  // Required for object spread and `Object.keys` to work through the proxy.
  ownKeys() {
    return Reflect.ownKeys(resolveClient());
  },
  getOwnPropertyDescriptor(_target, property) {
    const descriptor = Reflect.getOwnPropertyDescriptor(resolveClient(), property);
    // The proxy target has no such property, so the descriptor must be reported
    // configurable or the invariant check throws.
    return descriptor ? { ...descriptor, configurable: true } : descriptor;
  },
});
