-- RA-32 (FL-D's remaining half, closed): the read boundaries clamp a negative to zero, but
-- GET /api/stats aggregates with a Prisma `_sum` that the database computes, so no JS clamp
-- is in the path — a legacy negative row kept subtracting from a project's total. FL-08 only
-- stops new ones, because it floors the value at write time going forward.
--
-- The rows themselves predate the invariant, so they are repaired here rather than tolerated
-- on every read. Same statement on both engines: quoted identifiers are valid in SQLite and
-- Postgres, and `UPDATE` needs no dialect branch.
UPDATE "Task" SET "elapsedSeconds" = 0 WHERE "elapsedSeconds" < 0;
UPDATE "JobAttendance" SET "totalWorkSeconds" = 0 WHERE "totalWorkSeconds" < 0;
