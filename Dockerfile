# syntax=docker/dockerfile:1

FROM node:20-alpine AS builder

WORKDIR /app

# Ensure Prisma can run during build (it expects DATABASE_URL in prisma.config.ts)
ARG DATABASE_URL="file:./dev.db"
ENV DATABASE_URL=$DATABASE_URL

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

RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# SQLite DB location inside the container
ENV DATABASE_URL="file:/data/dev.db"

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

