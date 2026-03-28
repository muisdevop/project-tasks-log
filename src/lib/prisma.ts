import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";

function createClient() {
  const provider = (process.env.DB_PROVIDER || "").toLowerCase();
  const schemaPath = (process.env.PRISMA_SCHEMA_PATH || "").toLowerCase();
  const resolvedUrl = process.env.DATABASE_URL?.trim();

  const hintedProvider =
    (resolvedUrl?.startsWith("postgres") ? "postgres" : "") ||
    (schemaPath.includes("postgres")
      ? "postgres"
      : schemaPath.includes("sqlite")
        ? "sqlite"
        : "") ||
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

  if (useSqlite) {
    const adapter = new PrismaBetterSqlite3({ url });
    return new PrismaClient({
      adapter,
      log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    });
  }

  const adapter = new PrismaPg({ connectionString: url });

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
