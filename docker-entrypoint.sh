#!/usr/bin/env sh
set -eu

# Ensure DB directory exists (volume mount target).
mkdir -p /data

# Apply DB schema (SQLite) on container start.
# This is safe for repeated container restarts.
npx prisma migrate deploy

exec npm run start

