-- PAR-04: make "at most one open check-in per job" a database invariant.
--
-- FL-04 already enforces this rule in src/app/api/attendance/route.ts by reading
-- inside prisma.$transaction and creating afterwards. On PostgreSQL an
-- interactive transaction is a plain BEGIN under READ COMMITTED, so two
-- concurrent check-ins can both read "no open row" and both insert: the job ends
-- up with two open attendance rows and every later report double-counts the
-- seconds between them. No amount of reading fixes that after the fact — the row
-- has to be refused by the engine, which is what a partial unique index does. It
-- is valid on both shipped providers, so this migration is the same SQL in both
-- sets, and `npm run db:parity:migrations` (rule C) fails if the two definitions
-- ever diverge.
--
-- SQLite cannot be the reference implementation here: it has one writer per
-- connection, so the race is merely narrow, not impossible.

-- 1. Backfill. The index cannot be created over existing violations, so rows a
--    past race has already produced are closed first. The rule is deliberately
--    minimal: the newest open row per job keeps its open interval, and every
--    other open row for that job is closed at its own check-in time with zero
--    seconds. A duplicate open row is an artefact of the bug, not a working
--    interval — the surviving row already covers that span — so this neither
--    invents time nor double-counts it. MAX(id) is taken over rows that are still
--    open, and the row it selects is excluded from the UPDATE below, so the
--    "winner" set cannot shift while the statement runs.
UPDATE "JobAttendance"
   SET "checkOutTime" = "checkInTime",
       "totalWorkSeconds" = 0
 WHERE "checkOutTime" IS NULL
   AND "id" NOT IN (
     SELECT MAX("open"."id")
       FROM "JobAttendance" "open"
      WHERE "open"."checkOutTime" IS NULL
      GROUP BY "open"."jobId"
   );

-- 2. The invariant. `WHERE "checkOutTime" IS NULL` restricts uniqueness to the
--    open rows only, so a job can accumulate as many closed days as it likes.
--    The route auto-closes stale open rows from previous days before it inserts,
--    so a legitimate check-in is never blocked by yesterday's crash; it is the
--    second *simultaneously open* row that is refused, which is exactly the
--    interleaving the transaction could not prevent.
--
--    Prisma schemas cannot express a partial index, so this object exists only in
--    the migration sets. The comment in both schema files points here, and
--    tests/integration/helpers/harness.ts applies this file after `db push` so
--    the integration suite exercises the same constraint the deployments have.
CREATE UNIQUE INDEX "JobAttendance_one_open_check_in"
    ON "JobAttendance"("jobId")
 WHERE "checkOutTime" IS NULL;
