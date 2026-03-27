/*
  Migration to add Job hierarchy and move work schedule to Job level
  
  Steps:
  1. Create Job table
  2. Create a default Job with work schedule from existing UserSettings
  3. Migrate existing Projects to point to the default Job
  4. Migrate existing BreakTypes to point to the default Job
  5. Update UserSettings to remove work schedule columns
*/

-- Step 1: Create Job table
CREATE TABLE "Job" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "description" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "workStart" TEXT NOT NULL DEFAULT '09:00',
    "workEnd" TEXT NOT NULL DEFAULT '17:00',
    "workDays" JSONB NOT NULL DEFAULT [1, 2, 3, 4, 5],
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- Step 2: Create a default Job with existing work schedule data
INSERT INTO "Job" ("name", "nameKey", "description", "workStart", "workEnd", "workDays", "createdAt", "updatedAt")
SELECT 
    'Default Job' as "name",
    'default-job' as "nameKey",
    'Default job for existing projects' as "description",
    COALESCE("workStart", '09:00') as "workStart",
    COALESCE("workEnd", '17:00') as "workEnd",
    COALESCE("workDays", '[1,2,3,4,5]') as "workDays",
    CURRENT_TIMESTAMP as "createdAt",
    CURRENT_TIMESTAMP as "updatedAt"
FROM "UserSettings" WHERE "id" = 1;

-- If no UserSettings exists, insert a default job anyway
INSERT INTO "Job" ("name", "nameKey", "description", "workStart", "workEnd", "workDays", "createdAt", "updatedAt")
SELECT 
    'Default Job', 'default-job', 'Default job for existing projects', '09:00', '17:00', '[1,2,3,4,5]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "Job" WHERE "nameKey" = 'default-job');

-- Step 3: Redefine tables with new relations
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

-- Migrate BreakType table
CREATE TABLE "new_BreakType" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "duration" INTEGER,
    "isOneTime" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "jobId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BreakType_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- Migrate existing break types to the default job (jobId = 1)
INSERT INTO "new_BreakType" ("createdAt", "duration", "id", "isActive", "isOneTime", "name", "type", "updatedAt", "jobId")
SELECT "createdAt", "duration", "id", "isActive", "isOneTime", "name", "type", "updatedAt", 1 as "jobId" FROM "BreakType";
DROP TABLE "BreakType";
ALTER TABLE "new_BreakType" RENAME TO "BreakType";

-- Migrate Project table
CREATE TABLE "new_Project" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "description" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "jobId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Project_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- Migrate existing projects to the default job (jobId = 1)
INSERT INTO "new_Project" ("createdAt", "id", "isArchived", "name", "nameKey", "description", "updatedAt", "jobId")
SELECT "createdAt", "id", "isArchived", "name", "nameKey", NULL as "description", "updatedAt", 1 as "jobId" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
CREATE UNIQUE INDEX "Project_nameKey_key" ON "Project"("nameKey");

-- Update UserSettings table (remove work schedule columns)
CREATE TABLE "new_UserSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "passwordHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_UserSettings" ("createdAt", "id", "passwordHash", "updatedAt")
SELECT "createdAt", "id", "passwordHash", "updatedAt" FROM "UserSettings";
DROP TABLE "UserSettings";
ALTER TABLE "new_UserSettings" RENAME TO "UserSettings";

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Job_nameKey_key" ON "Job"("nameKey");
