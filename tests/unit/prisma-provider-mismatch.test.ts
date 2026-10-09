/**
 * ST-03: DB client initialisation must fail closed on a configuration error.
 *
 * `src/lib/prisma.ts` used to catch Prisma's "not compatible with the provider"
 * error and quietly build a client for the *other* database with the built-in
 * default connection string (`file:./dev.db` /
 * `postgresql://postgres:postgres@localhost:5432/postgres`). A misconfigured
 * production deploy therefore booted, answered requests and served an empty
 * database with nothing in the logs.
 *
 * These tests drive the real module through `vi.resetModules()` + dynamic
 * import, because the client binds `DATABASE_URL` on *first use*, not on import
 * (the export is a lazy `Proxy`). Every rejected configuration is asserted twice:
 * it throws a configuration error, and *no* adapter was constructed — a silent
 * fallback would have to construct one, so that assertion is what actually pins
 * the bug away. `@prisma/client` and both adapters are mocked so no test touches
 * a real database and the connection string each adapter received is observable.
 *
 * The error text is also asserted not to carry credentials: it names the scheme
 * of a rejected URL, never its user:password part.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type PrismaModule = typeof import("../../src/lib/prisma");

const recorder = vi.hoisted(() => ({
  built: [] as Array<{ adapter: "better-sqlite3" | "pg"; connection: string }>,
}));

function clientModule() {
  return {
    PrismaClient: class {
      // Deliberately own properties, not prototype methods: the exported `Proxy`
      // reports descriptors from the real client only, so `vi.spyOn` needs these
      // to be own properties to work the way the integration suites expect.
      $connect = () => Promise.resolve();
      constructor(options: { adapter: { __connection: string } }) {
        const connection = options.adapter.__connection;
        recorder.built.push({
          adapter: connection.startsWith("file:") ? "better-sqlite3" : "pg",
          connection,
        });
        // Reproduces the engine error that used to *trigger* the silent fallback:
        // a generated client whose datasource disagrees with its adapter.
        if (connection === POISON_URL) {
          throw new Error('Datasource "db": provider "sqlite" is not compatible with the provider "postgresql".');
        }
      }
    },
  };
}

function sqliteAdapterModule() {
  return {
    PrismaBetterSqlite3: class {
      __connection: string;
      constructor(config: { url: string }) {
        this.__connection = config.url;
      }
    },
  };
}

function pgAdapterModule() {
  return {
    PrismaPg: class {
      __connection: string;
      constructor(config: { connectionString: string }) {
        this.__connection = config.connectionString;
      }
    },
  };
}

vi.mock("@prisma/client", () => clientModule() as never);
vi.mock("@prisma/adapter-better-sqlite3", () => sqliteAdapterModule() as never);
vi.mock("@prisma/adapter-pg", () => pgAdapterModule() as never);

type DbEnv = {
  DB_PROVIDER?: string;
  DATABASE_URL?: string;
  DATABASE_URL_SQLITE?: string;
  DATABASE_URL_POSTGRES?: string;
  PRISMA_SCHEMA_PATH?: string;
};

/**
 * Assigns every database variable explicitly (unset means `undefined`, i.e.
 * genuinely absent from the environment) so no case can inherit state from the
 * host shell or from a previous case.
 */
function applyDbEnv(env: DbEnv): void {
  vi.stubEnv("DB_PROVIDER", env.DB_PROVIDER);
  vi.stubEnv("DATABASE_URL", env.DATABASE_URL);
  vi.stubEnv("DATABASE_URL_SQLITE", env.DATABASE_URL_SQLITE);
  vi.stubEnv("DATABASE_URL_POSTGRES", env.DATABASE_URL_POSTGRES);
  vi.stubEnv("PRISMA_SCHEMA_PATH", env.PRISMA_SCHEMA_PATH);
}

async function importPrisma(env: DbEnv = {}): Promise<PrismaModule> {
  applyDbEnv(env);
  vi.resetModules();
  // The non-production client is cached on globalThis; drop it so each case
  // resolves its own configuration.
  Reflect.deleteProperty(globalThis, "prisma");
  return import("../../src/lib/prisma");
}

/** Forces the lazy proxy to build the client, which is where a bad config throws. */
function firstUse(mod: PrismaModule): void {
  void mod.prisma.$connect;
}

const POSTGRES_URL = "postgresql://app_user:s3cr3t-pass@db.internal:5432/gid?schema=public";
/** A connection string the mocked engine refuses to build a client for. */
const POISON_URL = "postgresql://app_user:s3cr3t-pass@poison.internal:5432/gid?schema=public";

const REJECTED: Array<{ name: string; env: DbEnv; reason: RegExp }> = [
  {
    name: "DB_PROVIDER=postgres against a file: URL",
    env: { DB_PROVIDER: "postgres", DATABASE_URL: "file:./data/app.db" },
    reason: /resolved provider is postgres but DATABASE_URL is "file:\.\/data\/app\.db"/,
  },
  {
    name: "DB_PROVIDER=postgresql against a file: URL",
    env: { DB_PROVIDER: "postgresql", DATABASE_URL: "file:/data/dev.db" },
    reason: /resolved provider is postgres but DATABASE_URL is "file:\/data\/dev\.db"/,
  },
  {
    name: "DB_PROVIDER=sqlite against a postgres:// URL",
    env: { DB_PROVIDER: "sqlite", DATABASE_URL: POSTGRES_URL },
    reason: /resolved provider is sqlite but DATABASE_URL is a "postgresql:\/\//,
  },
  {
    name: "DB_PROVIDER=sqlite with only a PRISMA_SCHEMA_PATH=postgres schema",
    env: { DB_PROVIDER: "sqlite", PRISMA_SCHEMA_PATH: "prisma/schema.postgres.prisma" },
    reason: /DB_PROVIDER is "sqlite" but PRISMA_SCHEMA_PATH points at the postgres schema/,
  },
  {
    name: "an unsupported DB_PROVIDER value",
    env: { DB_PROVIDER: "mysql", DATABASE_URL: POSTGRES_URL },
    reason: /DB_PROVIDER is "mysql", which is not a supported provider/,
  },
  {
    name: "no DB_PROVIDER and no DATABASE_URL at all",
    env: {},
    reason: /no database is declared/,
  },
];

beforeEach(() => {
  recorder.built.length = 0;
  // The lazily built client is cached on globalThis outside production; every
  // case has to start from an unbound module.
  Reflect.deleteProperty(globalThis, "prisma");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  recorder.built.length = 0;
});

describe("prisma provider resolution fails closed (ST-03)", () => {
  it("does not build a client at import time", async () => {
    // The proxy defers resolution, which is what lets `next build` run in an
    // environment with no database while still failing the first query.
    const mod = await importPrisma({});
    expect(recorder.built).toEqual([]);
    expect(mod.prisma).toBeTypeOf("object");
  });

  for (const { name, env, reason } of REJECTED) {
    it(`throws a configuration error on first use: ${name}`, async () => {
      const mod = await importPrisma(env);
      expect(() => firstUse(mod)).toThrow(reason);
    });

    it(`constructs no client at all: ${name}`, async () => {
      const mod = await importPrisma(env);
      expect(() => firstUse(mod)).toThrow();
      // A silent fallback would have opened the other database here.
      expect(recorder.built).toEqual([]);
    });
  }

  it("never repeats a rejected configuration's credentials back in the message", async () => {
    const mod = await importPrisma({ DB_PROVIDER: "sqlite", DATABASE_URL: POSTGRES_URL });
    let message = "";
    try {
      firstUse(mod);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("DB_PROVIDER/DATABASE_URL mismatch");
    expect(message).toContain("Set DB_PROVIDER=postgres or a file: URL.");
    expect(message).not.toContain(POSTGRES_URL);
    expect(message).not.toContain("s3cr3t-pass");
    expect(message).not.toContain("app_user");
    expect(message).not.toContain("db.internal");
    expect(message).not.toContain("@");
  });

  it("does not name the built-in development database when nothing is declared", async () => {
    const mod = await importPrisma({});
    expect(() => firstUse(mod)).toThrow(/Refusing to open the built-in development database/);
    expect(recorder.built).toEqual([]);
  });

  it("re-throws the engine's provider incompatibility instead of retrying the other database", async () => {
    // This is the exact error the removed `catch` used to swallow and answer with
    // `createSqliteClient("file:./dev.db")` — an empty database, silently.
    const mod = await importPrisma({ DB_PROVIDER: "postgres", DATABASE_URL: POISON_URL });
    expect(() => firstUse(mod)).toThrow(/is not compatible with the provider/);
    expect(recorder.built).toEqual([{ adapter: "pg", connection: POISON_URL }]);
  });

  it("still reads an explicit file: default for the declared provider", async () => {
    // Operator-declared provider + provider-specific URL from the image env:
    // legitimate, and the sqlite client must receive exactly that URL.
    const mod = await importPrisma({
      DB_PROVIDER: "sqlite",
      DATABASE_URL_SQLITE: "file:/data/dev.db",
    });
    firstUse(mod);
    expect(recorder.built).toEqual([{ adapter: "better-sqlite3", connection: "file:/data/dev.db" }]);
  });

  it("builds the sqlite client when DB_PROVIDER=sqlite and the URL is a file: URL", async () => {
    const mod = await importPrisma({ DB_PROVIDER: "sqlite", DATABASE_URL: "file:./tests.db" });
    firstUse(mod);
    expect(recorder.built).toEqual([{ adapter: "better-sqlite3", connection: "file:./tests.db" }]);
  });

  it("builds the postgres client when DB_PROVIDER=postgres and the URL is postgresql://", async () => {
    const mod = await importPrisma({ DB_PROVIDER: "postgres", DATABASE_URL: POSTGRES_URL });
    firstUse(mod);
    expect(recorder.built).toEqual([{ adapter: "pg", connection: POSTGRES_URL }]);
  });

  it("falls back to the DATABASE_URL scheme when no provider is declared", async () => {
    const postgres = await importPrisma({ DATABASE_URL: POSTGRES_URL });
    firstUse(postgres);
    expect(recorder.built).toEqual([{ adapter: "pg", connection: POSTGRES_URL }]);

    recorder.built.length = 0;
    const sqlite = await importPrisma({ DATABASE_URL: "file:./data/app.db" });
    firstUse(sqlite);
    expect(recorder.built).toEqual([{ adapter: "better-sqlite3", connection: "file:./data/app.db" }]);
  });

  it("binds the connection string on first use, not on import", async () => {
    // Whoever sets the environment last wins: the harness sets the temporary
    // database after the module graph is already loaded.
    const mod = await importPrisma({ DB_PROVIDER: "sqlite", DATABASE_URL: "file:./stale.db" });
    applyDbEnv({ DB_PROVIDER: "sqlite", DATABASE_URL: "file:./harness.db" });
    firstUse(mod);
    expect(recorder.built).toEqual([{ adapter: "better-sqlite3", connection: "file:./harness.db" }]);
  });

  it("forwards property definitions and deletions to the real client", async () => {
    const mod = await importPrisma({ DB_PROVIDER: "sqlite", DATABASE_URL: "file:./data/app.db" });
    firstUse(mod);
    const cached = (globalThis as { prisma?: Record<string, unknown> }).prisma;
    expect(cached).toBeTypeOf("object");
    // This is what `vi.spyOn(prisma, …)` does internally: the trap has to land
    // the definition on the client behind the proxy, otherwise the `get` trap
    // keeps returning the original method and the spy is never observed.
    // (Written by hand instead of via `vi.spyOn` so no spy outlives the case —
    // vitest restores registered spies after the environment is restored, and
    // restoring onto a lazily bound client would re-resolve the config.)
    const stub = () => "stubbed";
    Object.defineProperty(mod.prisma, "$connect", {
      value: stub,
      configurable: true,
      writable: true,
    });
    expect(cached!.$connect).toBe(stub);
    expect((mod.prisma.$connect as unknown as () => string)()).toBe("stubbed");
    expect(delete (mod.prisma as unknown as Record<string, unknown>).$connect).toBe(true);
    expect(cached!.$connect).toBeUndefined();
  });
});
