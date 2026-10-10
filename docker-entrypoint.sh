#!/usr/bin/env sh
set -eu

# AR-06/AR-08: no DATABASE_URL is baked into the image anymore; it is resolved
# here from env only. Keep the DB host fully env-configurable (DATABASE_URL /
# DATABASE_URL_POSTGRES) - Coolify renames containers with a random suffix, so
# nothing here may rely on a hardcoded container-name DNS alias.
DB_PROVIDER="${DB_PROVIDER:-sqlite}"

if [ "$DB_PROVIDER" = "postgres" ] || [ "$DB_PROVIDER" = "postgresql" ]; then
	export PRISMA_SCHEMA_PATH="prisma/postgres/schema.prisma"
	MIGRATIONS_DIR="prisma/postgres/migrations"
	if [ -z "${DATABASE_URL:-}" ]; then
		export DATABASE_URL="${DATABASE_URL_POSTGRES:-}"
	fi
else
	export PRISMA_SCHEMA_PATH="prisma/schema.sqlite.prisma"
	MIGRATIONS_DIR="prisma/migrations"
	if [ -z "${DATABASE_URL:-}" ]; then
		export DATABASE_URL="${DATABASE_URL_SQLITE:-file:/data/dev.db}"
	fi
	# SQLite needs a writable /data (owned by the non-root `node` user in the
	# image; named volumes inherit that ownership on first use - AR-06).
	mkdir -p /data 2>/dev/null || true
fi

if [ -z "${DATABASE_URL:-}" ]; then
	echo "DATABASE_URL is required after provider resolution." >&2
	exit 1
fi

# The repo's prisma.config.ts pins migrations.path to the SQLite directory, so
# `migrate deploy --schema prisma/postgres/...` fails with P3019 (provider
# mismatch). Write a provider-specific config and pass --config (AR-07;
# unblocks the postgres boot path docker-compose advertises). Prefer /app so
# relative paths keep resolving against the project root; fall back to /tmp
# (with absolute paths) on a read-only /app.
SCHEMA_REL="$PRISMA_SCHEMA_PATH"
MIGRATIONS_REL="$MIGRATIONS_DIR"
if ( : >> /app/prisma.startup.config.mjs ) 2>/dev/null; then
	PRISMA_CONFIG=/app/prisma.startup.config.mjs
else
	PRISMA_CONFIG=/tmp/prisma.startup.config.mjs
	SCHEMA_REL="/app/$PRISMA_SCHEMA_PATH"
	MIGRATIONS_REL="/app/$MIGRATIONS_DIR"
fi
cat > "$PRISMA_CONFIG" <<EOF
export default {
	schema: "$SCHEMA_REL",
	migrations: { path: "$MIGRATIONS_REL" },
	datasource: { url: process.env.DATABASE_URL },
};
EOF

# AR-07: run `prisma generate` + `migrate deploy` ONLY when the schema or
# migrations actually changed since the last boot. The hash covers the active
# schema file plus every migration SQL, and is compared against a marker file.
SCHEMA_HASH="$(find "$PRISMA_SCHEMA_PATH" "$MIGRATIONS_DIR" -type f 2>/dev/null | sort | xargs cat | sha256sum | cut -d' ' -f1)"

# Prefer /data (persisted with the volume), fall back to /app then /tmp for
# read-only/partial mounts so startup never hard-fails on marker placement.
MARKER="/tmp/.prisma-schema-hash"
for CANDIDATE in /data/.prisma-schema-hash /app/.prisma-schema-hash /tmp/.prisma-schema-hash; do
	if ( : >>"$CANDIDATE" ) 2>/dev/null; then
		MARKER="$CANDIDATE"
		break
	fi
done

# PAR-01: `prisma generate` runs on EVERY boot. It writes into the image's own
# (ephemeral) node_modules, while the marker below lives on the persisted volume -
# so gating it means a container recreation can skip it and leave the client that
# was baked into the image (generated from the SQLite schema) talking to a
# Postgres database. Only `migrate deploy`, which touches the database, stays
# gated by the schema hash.
npx prisma generate --schema "$PRISMA_SCHEMA_PATH" --config "$PRISMA_CONFIG"

if [ "$(cat "$MARKER" 2>/dev/null || true)" != "$SCHEMA_HASH" ]; then
	echo "[entrypoint] Schema/migrations changed - running prisma migrate deploy"
	npx prisma migrate deploy --schema "$PRISMA_SCHEMA_PATH" --config "$PRISMA_CONFIG"
	echo "$SCHEMA_HASH" >"$MARKER" 2>/dev/null || true
else
	echo "[entrypoint] Schema unchanged since last boot - skipping migrate deploy"
fi

# AR-07: exec node directly so `node server.js` (the standalone server) is the
# signal parent - no npm wrapper swallowing SIGTERM.
cd /app
exec node server.js
