/**
 * RA-20: the Postgres migration path, committed as a file instead of a runtime guess.
 *
 * `npm run db:migrate:postgres` used to be `prisma migrate deploy --schema
 * prisma/postgres/schema.prisma`, and the repo's root `prisma.config.ts` pins
 * `migrations.path` to the SQLite directory. Measured against a live Postgres database,
 * that command loaded 13 migrations from `prisma/migrations` and died with
 * `P3019: The datasource provider postgresql specified in your schema does not match the
 * one specified in the migration_lock.toml, sqlite` — the documented way to migrate a
 * Postgres deployment had never worked. `docker-entrypoint.sh` already knew this (its own
 * comment says so) and writes a provider-specific config at boot; an operator following
 * the README had no equivalent.
 *
 * Prisma resolves the paths a config declares relative to *that config file's own
 * directory*, not the working directory — which is why this file sits next to the schema
 * and the migrations it points at, and why the entrypoint writes its copy at the project
 * root with root-relative names.
 */
const config = {
  schema: "schema.prisma",
  migrations: { path: "migrations" },
  datasource: { url: process.env.DATABASE_URL },
};

export default config;
