#!/usr/bin/env sh
set -eu

DB_PROVIDER="${DB_PROVIDER:-sqlite}"

if [ "$DB_PROVIDER" = "postgres" ] || [ "$DB_PROVIDER" = "postgresql" ]; then
	export PRISMA_SCHEMA_PATH="prisma/schema.postgres.prisma"
	if [ -z "${DATABASE_URL:-}" ]; then
		export DATABASE_URL="${DATABASE_URL_POSTGRES:-}"
	fi
else
	export PRISMA_SCHEMA_PATH="prisma/schema.sqlite.prisma"
	if [ -z "${DATABASE_URL:-}" ]; then
		export DATABASE_URL="${DATABASE_URL_SQLITE:-file:/data/dev.db}"
	fi
	mkdir -p /data
fi

if [ -z "${DATABASE_URL:-}" ]; then
	echo "DATABASE_URL is required after provider resolution." >&2
	exit 1
fi

npx prisma generate --schema "$PRISMA_SCHEMA_PATH"

if [ "$DB_PROVIDER" = "postgres" ] || [ "$DB_PROVIDER" = "postgresql" ]; then
	npx prisma db push --schema "$PRISMA_SCHEMA_PATH"
else
	npx prisma migrate deploy --schema "$PRISMA_SCHEMA_PATH"
fi

exec npm run start

