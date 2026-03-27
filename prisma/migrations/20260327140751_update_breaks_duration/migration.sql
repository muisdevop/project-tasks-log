/*
  Warnings:

  - You are about to drop the column `time` on the `BreakType` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BreakType" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "duration" INTEGER,
    "isOneTime" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "settingsId" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BreakType_settingsId_fkey" FOREIGN KEY ("settingsId") REFERENCES "UserSettings" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_BreakType" ("createdAt", "id", "isActive", "isOneTime", "name", "settingsId", "type", "updatedAt") SELECT "createdAt", "id", "isActive", "isOneTime", "name", "settingsId", "type", "updatedAt" FROM "BreakType";
DROP TABLE "BreakType";
ALTER TABLE "new_BreakType" RENAME TO "BreakType";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
