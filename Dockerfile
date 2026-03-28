# syntax=docker/dockerfile:1

FROM node:20-alpine AS builder

WORKDIR /app

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
COPY tailwind.config.* ./
COPY postcss.config.* ./
COPY public ./public

RUN if [ -z "$DATABASE_URL" ]; then export DATABASE_URL="$DATABASE_URL_SQLITE"; fi; \
	npx prisma generate --schema prisma/schema.sqlite.prisma; \
	npm run build

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# SQLite DB location inside the container
ENV DATABASE_URL="file:/data/dev.db"

# Install curl for health checks and Chrome for PDF generation
RUN apk add --no-cache curl chromium

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./

COPY ./docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["npm", "run", "start"]

