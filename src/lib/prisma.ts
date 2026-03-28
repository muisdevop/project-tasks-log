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

  try {
    return useSqlite ? createSqliteClient(url) : createPostgresClient(url);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("not compatible with the provider")) {
      throw error;
    }

    // Build environments can have provider/env drift; fallback keeps compilation stable.
    return useSqlite ? createPostgresClient(defaultPostgresUrl) : createSqliteClient(defaultSqliteUrl);
  }
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
