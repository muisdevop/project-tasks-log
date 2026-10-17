-- PAR-02: the two migration sets seeded different amounts of data.
--
-- `prisma/migrations/20260327201323_add_job_hierarchy/migration.sql` creates the Job
-- table and then inserts a default Job (twice: once from the pre-hierarchy UserSettings
-- schedule, once unconditionally when nothing matched). The Postgres set — `baseline`
-- plus `add_api_tokens` — contains no INSERT at all (`grep -c INSERT` is 0 in both
-- files), so a fresh Postgres deployment started with an empty board while a fresh SQLite
-- deployment started with "Default Job". Anything that assumes a job exists — the seed
-- script, the first-run UX, the container smoke's expectations — was only true on one
-- provider.
--
-- Additive on purpose: `prisma/postgres/migrations/*` are already applied in the field, so
-- this is a new migration rather than an edit to one that shipped. Guarded by NOT EXISTS
-- so it is safe to re-run and cannot collide with a job an operator already created.
-- The `workDays` value is the same array `prisma/postgres/schema.prisma:47` declares as
-- the column default.

INSERT INTO "Job"
    ("name", "nameKey", "description", "workStart", "workEnd", "workDays", "createdAt", "updatedAt")
SELECT
    'Default Job', 'default-job', 'Default job for existing projects', '09:00', '17:00',
    '[1, 2, 3, 4, 5]'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "Job" WHERE "nameKey" = 'default-job');
