import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is required.");
}

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url }),
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
