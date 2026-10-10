import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is required.");
}

// The adapter has to match the URL the seed is pointed at, the same way
// src/lib/prisma.ts does. With the SQLite adapter hardcoded, `npm run db:seed`
// against a Postgres DATABASE_URL created a stray `file:` database, seeded
// nothing in the real one, and still reported success.
const adapter = url.trim().startsWith("file:")
  ? new PrismaBetterSqlite3({ url })
  : new PrismaPg({ connectionString: url });

const prisma = new PrismaClient({
  adapter,
});

async function main() {
  // Create default user settings (no longer holds work schedule - that's per-job now)
  await prisma.userSettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
