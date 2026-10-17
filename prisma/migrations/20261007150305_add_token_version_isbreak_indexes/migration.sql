-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Task" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "projectId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "startedAt" DATETIME NOT NULL,
    "endedAt" DATETIME,
    "elapsedSeconds" INTEGER NOT NULL DEFAULT 0,
    "completionOutput" TEXT,
    "cancellationReason" TEXT,
    "logNotes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "isBreak" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("cancellationReason", "completionOutput", "createdAt", "description", "elapsedSeconds", "endedAt", "id", "logNotes", "projectId", "startedAt", "status", "title", "updatedAt") SELECT "cancellationReason", "completionOutput", "createdAt", "description", "elapsedSeconds", "endedAt", "id", "logNotes", "projectId", "startedAt", "status", "title", "updatedAt" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE INDEX "Task_projectId_status_idx" ON "Task"("projectId", "status");
CREATE INDEX "Task_status_endedAt_idx" ON "Task"("status", "endedAt");
CREATE TABLE "new_UserSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "passwordHash" TEXT,
    "fullName" TEXT,
    "email" TEXT,
    "title" TEXT,
    "bio" TEXT,
    "reportTitleOptions" JSONB,
    "defaultReportTitle" TEXT,
    "tokenVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_UserSettings" ("bio", "createdAt", "defaultReportTitle", "email", "fullName", "id", "passwordHash", "reportTitleOptions", "title", "updatedAt") SELECT "bio", "createdAt", "defaultReportTitle", "email", "fullName", "id", "passwordHash", "reportTitleOptions", "title", "updatedAt" FROM "UserSettings";
DROP TABLE "UserSettings";
ALTER TABLE "new_UserSettings" RENAME TO "UserSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "SubTask_taskId_idx" ON "SubTask"("taskId");

-- CreateIndex
CREATE INDEX "TaskEvent_taskId_idx" ON "TaskEvent"("taskId");

-- Backfill isBreak for tasks created via the legacy " break" title suffix (FL-05)
UPDATE "Task" SET "isBreak" = 1 WHERE lower(substr("title", -6)) = ' break';
