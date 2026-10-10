/*
  PAR-03 — repair the `Job.workDays` column default on SQLite.

  The shipped `20260327201323_add_job_hierarchy` migration declared

      "workDays" JSONB NOT NULL DEFAULT [1, 2, 3, 4, 5]

  and in SQLite's grammar a bracketed token is an *identifier* quote, not an array
  literal: the stored default is the bare text `1, 2, 3, 4, 5`, which is not valid
  JSON. Measured before this file was written — `migrate deploy` the old set into an
  empty database, insert a row that omits the column, and `workDays` comes back as
  "1, 2, 3, 4, 5" (JSON.parse throws). The Postgres set was always correct because
  there `[1, 2, 3, 4, 5]` is not a legal token, so the baseline quotes it.

  Nothing in the application reaches the default: `src/app/api/jobs/route.ts` supplies
  `workDays` on every create, which is why this is a Low finding and not a corruption
  incident. It is still a schema that means something other than what it says, and any
  future insert that omits the column — a seed, a migration, a `psql`/`sqlite3` session —
  inherits the string.

  SQLite cannot alter a column default in place, so this is the same copy-and-swap
  rebuild Prisma generates for a default change. Applied in a scratch database with rows
  and child rows in it, this file keeps every Job row, keeps the unique index, and leaves
  `PRAGMA foreign_key_check` empty.

  It is deliberately not an edit to the applied migration: shipped files are immutable,
  and `_prisma_migrations` checksums would reject the change on every existing database.
  `npm run db:parity:migrations` now requires a repair like this to exist for every
  unquoted default it allowlists, so the defect cannot be re-introduced or left unrepaired.
*/

PRAGMA foreign_keys=OFF;

-- Step 1: the same table, with the default quoted so SQLite stores a JSON array.
CREATE TABLE "new_Job" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "description" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "workStart" TEXT NOT NULL DEFAULT '09:00',
    "workEnd" TEXT NOT NULL DEFAULT '17:00',
    "workDays" JSONB NOT NULL DEFAULT '[1, 2, 3, 4, 5]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- Step 2: copy the rows across. An existing row that already holds the bad default text
-- is left exactly as it is — this migration repairs the *default*, not stored data, and
-- inventing a work schedule for a job someone configured would be the worse surprise.
INSERT INTO "new_Job" ("id", "name", "nameKey", "description", "isArchived", "workStart", "workEnd", "workDays", "createdAt", "updatedAt")
SELECT "id", "name", "nameKey", "description", "isArchived", "workStart", "workEnd", "workDays", "createdAt", "updatedAt"
  FROM "Job";

-- Step 3: swap. Child tables reference `Job` by name, so dropping and renaming back in
-- the same transaction leaves their foreign keys pointing at this table again.
DROP TABLE "Job";
ALTER TABLE "new_Job" RENAME TO "Job";

-- Step 4: the index went with the dropped table.
CREATE UNIQUE INDEX "Job_nameKey_key" ON "Job"("nameKey");

PRAGMA foreign_keys=ON;
