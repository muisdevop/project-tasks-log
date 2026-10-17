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

  SQLite cannot alter a column default in place. The obvious repair is the copy-and-swap
  rebuild Prisma itself generates for a default change, and that form was measured to
  work — until the re-audit checked it against the condition Prisma's runner can create.
  With `PRAGMA foreign_keys=ON` and the file executed inside one transaction, a
  `DROP TABLE "Job"` does not fail; the `ON DELETE CASCADE` arms on Project, Task,
  JobAttendance and BreakType fire, and every row in those four tables is deleted while
  the migration still reports success. Measured on a populated database (2 jobs, one
  project, one task, one attendance row, one break type):

      foreign_keys=OFF txn=OFF  lost=nothing
      foreign_keys=ON  txn=OFF  lost=nothing
      foreign_keys=ON  txn=ON   lost=Project,Task,JobAttendance,BreakType

  `PRAGMA foreign_keys` is a no-op inside a transaction, so a runner that turns the
  pragma on *before* opening the transaction leaves the cascade armed with no way to
  disarm it. Prisma's SQLite executor does not currently do that — the shipped
  `20260327201323_add_job_hierarchy` relies on the same behaviour — but "the executor
  happens not to" is not a property this file can depend on, and the failure mode is
  silent data loss rather than an error.

  So this repair never drops a table. It changes only the `Job` table, using three
  supported SQLite operations: add a column with a constant default (any 3.x), drop a
  column that is not indexed, referenced by a foreign key, or part of a primary key
  (3.35+), and rename a column (3.25+). The table identity — and therefore every
  foreign key pointing at it — is never destroyed. Measured through the same three
  FK/transaction conditions on the same populated database:

      foreign_keys=OFF txn=OFF  lost=nothing
      foreign_keys=ON  txn=OFF  lost=nothing
      foreign_keys=ON  txn=ON   lost=nothing

  with the resulting default `'[1, 2, 3, 4, 5]'`, `JSON.parse` of a defaulted insert
  yielding [1,2,3,4,5], one index on `Job` (`Job_nameKey_key`), `PRAGMA foreign_key_check`
  empty, and zero orphaned children in either form.

  An existing row that already holds the bad default text is left exactly as it is —
  this migration repairs the *default*, not stored data, and inventing a work schedule
  for a job someone configured would be the worse surprise.

  Shipped files are immutable, and `_prisma_migrations` checksums reject any change to a
  migration a database has already applied — which is why the repair is its own directory and
  not an edit to `20260328120000_add_job_workdays_default`. The reason this file may be edited
  in place at all is provenance, not preference: it was added in the same unreleased window
  (git: added by 998e60d, absent from the `v0.2.0` tree), so no deployment has ever recorded
  its checksum, and the copy-and-swap form it replaces is the one that silently cascaded four
  tables away under `foreign_keys=ON` inside a transaction. Restoring that form to honour an
  immutability rule this file has not yet fallen under would trade a rule for data loss.
  `npm run db:parity:migrations` now requires a repair like this to exist for every
  unquoted default it allowlists, so the defect cannot be re-introduced or left unrepaired.
*/

ALTER TABLE "Job" ADD COLUMN "workDaysFixed" JSONB NOT NULL DEFAULT '[1, 2, 3, 4, 5]';

UPDATE "Job" SET "workDaysFixed" = "workDays";

ALTER TABLE "Job" DROP COLUMN "workDays";

ALTER TABLE "Job" RENAME COLUMN "workDaysFixed" TO "workDays";
