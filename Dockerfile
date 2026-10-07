# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# SEC-14: reproducibility. Base image pinned to an exact tag AND digest
# (multi-arch index digest from `docker buildx imagetools inspect
# node:20-alpine3.20`). If you cannot reach the registry to verify a digest,
# keep at minimum the exact version tag (`node:20-alpine3.20`).
# apk packages are pinned to versions current for Alpine 3.20 at the time of
# writing (verified with `apk policy` inside the pinned base). Alpine only
# bumps these inside a branch, so pins may need refreshing when you move the
# base tag; the ARG defaults below are the single place to edit.
# ---------------------------------------------------------------------------
ARG NODE_BASE=node:20-alpine3.20@sha256:3bc9a4c4cc25cfde1e8f946341c85f333c36517aafda829b4bb7e785e9b5995c

FROM ${NODE_BASE} AS builder
WORKDIR /app

# AR-06: never let puppeteer download Chrome for Testing; the runner stage
# ships apk chromium instead.
ENV PUPPETEER_SKIP_DOWNLOAD=true

# ST-02: toolchain so native modules (better-sqlite3 etc.) can compile a
# fallback when no musl prebuilt matches. Builder stage ONLY - the runner
# stays lean. (AR-06: python3/make/g++ must NOT appear in the runtime image.)
# SEC-14: pinned apk versions.
ARG TOOLCHAIN="python3=3.12.13-r0 make=4.4.1-r2 g++=13.2.1_git20240309-r1"
RUN apk add --no-cache ${TOOLCHAIN}

# Ensure Prisma can run during build even when orchestration injects empty build args.
ARG DATABASE_URL
ARG DATABASE_URL_SQLITE="file:./dev.db"
ENV DATABASE_URL=$DATABASE_URL
ENV DATABASE_URL_SQLITE=$DATABASE_URL_SQLITE
ENV DB_PROVIDER=sqlite

COPY package.json package-lock.json ./
RUN npm ci

# Prisma generate needs schema; it doesn't require the DB to already exist,
# but the sqlite file path should be present for adapter initialization.
RUN touch dev.db

COPY prisma ./prisma
COPY prisma.config.ts ./
COPY src ./src
COPY next.config.ts ./
COPY tsconfig.json ./
COPY postcss.config.* ./
COPY public ./public

RUN if [ -z "$DATABASE_URL" ]; then export DATABASE_URL="$DATABASE_URL_SQLITE"; fi; \
	npx prisma generate --schema prisma/schema.sqlite.prisma; \
	npm run build

# AR-06: with `output: standalone` the runtime only needs PRODUCTION deps
# (prisma CLI + adapters for the entrypoint migrations, puppeteer-core/next at
# runtime). Prune devDependencies here so the runner never copies them.
RUN npm prune --omit=dev

FROM ${NODE_BASE} AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
# The standalone server.js binds to `process.env.HOSTNAME || 0.0.0.0`, and
# Docker sets HOSTNAME to the container's name, which would make the
# HEALTHCHECK's 127.0.0.1 call fail (AR-06). Bind all interfaces explicitly;
# still reachable via the container IP, and orchestrators can override.
ENV HOSTNAME=0.0.0.0

# AR-06/AR-08: no baked-in DATABASE_URL default. The entrypoint resolves the
# connection from DB_PROVIDER + DATABASE_URL / DATABASE_URL_SQLITE /
# DATABASE_URL_POSTGRES, so Postgres users do not have to fight a stale SQLite
# default (see docker-compose.yml for the override pattern).
# AR-06: export route (src/app/api/export/route.ts) uses
# PUPPETEER_EXECUTABLE_PATH in production; apk chromium lives at
# /usr/bin/chromium (not /usr/bin/chromium-browser).
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
# AR-06: image already ships the binary, skip any puppeteer download.
ENV PUPPETEER_SKIP_DOWNLOAD=true

# curl for HEALTHCHECK, chromium for server-side PDF export.
# SEC-14: pinned apk versions.
ARG CURL=curl=8.14.1-r2
ARG CHROMIUM=chromium=131.0.6778.108-r0
RUN apk add --no-cache ${CURL} ${CHROMIUM}

# AR-06: standalone output + static assets + public + prisma artifacts, with
# the pruned production node_modules (no devDependencies).
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/prisma.config.ts ./
COPY --from=builder --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules

COPY --chown=node:node ./docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# AR-06: non-root runtime user with an owned /data for the SQLite file and the
# startup marker. Named volumes (compose) inherit this ownership on first use;
# bind mounts need host-side ownership of the mounted dir. WORKDIR /app is
# created root-owned by the base image, so chown it too - the entrypoint writes
# its generated prisma config + marker under /app (AR-07).
RUN mkdir -p /data && chown node:node /data /app
USER node

EXPOSE 3000

# AR-06: container-level healthcheck against the app's /api/health endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
	CMD curl -fsS "http://127.0.0.1:${PORT:-3000}/api/health" || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
# AR-07: entrypoint execs `node server.js` itself; CMD kept as no-op so
# Coolify/orchestrator command overrides don't bypass the entrypoint logic.
CMD []
