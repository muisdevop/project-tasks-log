import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";

type DbProvider = "postgres" | "sqlite";

/**
 * Only a convenience for `next dev`/scripts where the operator declared *which*
 * database to use but left the connection string to the image defaults. They are
 * never used to switch to the *other* database behind the operator's back: that
 * silent fallback is what let a misconfigured production deploy serve an empty
 * database with no visible error (ST-03).
 */
const DEVELOPMENT_SQLITE_URL = "file:./dev.db";
const DEVELOPMENT_POSTGRES_URL = "postgresql://postgres:postgres@localhost:5432/postgres?schema=public";

const CONFIG_ERROR_PREFIX = "Invalid database configuration";

function providerFromName(value: string): DbProvider | "" {
  if (value === "sqlite") return "sqlite";
  if (value === "postgres" || value === "postgresql") return "postgres";
  return "";
}

/**
 * Keeps thrown messages safe to log: a full connection string carries the
 * database password. `file:` URLs are plain paths (no credentials) and are quoted
 * in full because the path is exactly what the operator has to fix; anything else
 * is reduced to its scheme.
 */
function describeConnection(url: string): string {
  if (url.startsWith("file:")) return `"${url}"`;
  const scheme = /^[a-z][a-z\d+.-]*:/i.exec(url)?.[0];
  return scheme ? `a "${scheme}//…" URL` : "a value with no recognisable scheme";
}

function providerOfUrl(url: string): DbProvider | "" {
  if (url.startsWith("postgres")) return "postgres";
  if (url.startsWith("file:")) return "sqlite";
  return "";
}

/**
 * Resolves which database this process is allowed to talk to, or throws.
 *
 * Three signals can declare the provider, and they must agree:
 * `PRISMA_SCHEMA_PATH` (which schema the client was generated from),
 * `DB_PROVIDER` (what the operator says the deployment is) and the
 * `DATABASE_URL` scheme. Precedence is schema path, then `DB_PROVIDER`, then the
 * URL scheme — the first one that is actually declared wins, and a contradiction
 * between two declared signals is a hard configuration error rather than a
 * guess.
 */
function resolveDatabaseConfig(): { provider: DbProvider; url: string } {
  const providerEnv = (process.env.DB_PROVIDER ?? "").trim().toLowerCase();
  const schemaPath = (process.env.PRISMA_SCHEMA_PATH ?? "").trim().toLowerCase();
  const declaredUrl = (process.env.DATABASE_URL ?? "").trim();
  const sqliteUrl = (process.env.DATABASE_URL_SQLITE ?? "").trim();
  const postgresUrl = (process.env.DATABASE_URL_POSTGRES ?? "").trim();

  const schemaHint: DbProvider | "" = schemaPath.includes("postgres")
    ? "postgres"
    : schemaPath.includes("sqlite")
      ? "sqlite"
      : "";
  const providerHint = providerFromName(providerEnv);

  if (providerEnv && !providerHint) {
    throw new Error(
      `${CONFIG_ERROR_PREFIX}: DB_PROVIDER is "${providerEnv}", which is not a supported provider. Expected sqlite, postgres or postgresql.`,
    );
  }

  const urlHint = providerOfUrl(declaredUrl);

  if (schemaHint && providerHint && schemaHint !== providerHint) {
    throw new Error(
      `${CONFIG_ERROR_PREFIX}: DB_PROVIDER is "${providerEnv}" but PRISMA_SCHEMA_PATH points at the ${schemaHint} schema. Keep DB_PROVIDER, PRISMA_SCHEMA_PATH and DATABASE_URL describing the same database.`,
    );
  }

  const provider = schemaHint || providerHint || urlHint;

  if (!provider) {
    // Nothing declares which database this is. Falling back to the built-in
    // development file would boot a deployment against an empty `dev.db`.
    throw new Error(
      `${CONFIG_ERROR_PREFIX}: no database is declared. Set DATABASE_URL, or DB_PROVIDER together with DATABASE_URL_SQLITE / DATABASE_URL_POSTGRES. Refusing to open the built-in development database.`,
    );
  }

  const url =
    declaredUrl ||
    (provider === "postgres"
      ? postgresUrl || DEVELOPMENT_POSTGRES_URL
      : sqliteUrl || DEVELOPMENT_SQLITE_URL);

  if (provider === "sqlite" && !url.startsWith("file:")) {
    throw new Error(
      `DB_PROVIDER/DATABASE_URL mismatch: resolved provider is sqlite but DATABASE_URL is ${describeConnection(url)}. Set DB_PROVIDER=postgres or a file: URL.`,
    );
  }
  if (provider === "postgres" && url.startsWith("file:")) {
    throw new Error(
      `DB_PROVIDER/DATABASE_URL mismatch: resolved provider is postgres but DATABASE_URL is ${describeConnection(url)}. Set DB_PROVIDER=sqlite or a postgresql:// URL.`,
    );
  }
  if (provider === "postgres" && providerOfUrl(url) !== "postgres") {
    throw new Error(
      `DB_PROVIDER/DATABASE_URL mismatch: resolved provider is postgres but DATABASE_URL is ${describeConnection(url)}, which is not a postgresql:// connection string.`,
    );
  }

  return { provider, url };
}

function createClient(): PrismaClient {
  const { provider, url } = resolveDatabaseConfig();

  const log: Array<"error" | "warn"> =
    process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"];

  if (provider === "sqlite") {
    return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }), log });
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }), log });
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
 * Fail-fast configuration depends on the same property: `resolveDatabaseConfig`
 * above throws a clear configuration error on a provider/URL contradiction (ST-03)
 * instead of falling back to the other database, and because it runs here the
 * error surfaces on the first query rather than at import time — which is what
 * keeps `next build` compiling in an environment that has no database at all.
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
