-- AI-02: scoped, revocable API tokens for agent / server-to-server callers.
-- Only the SHA-256 hash of the token is stored, never the plaintext.
-- `scope` stays TEXT (not a Postgres ENUM) so the two Prisma schemas remain
-- byte-identical for `npm run db:parity`; the read|write domain is enforced by
-- zod in src/lib/validators.ts.

-- CreateTable
CREATE TABLE "ApiToken" (
    "id" SERIAL NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'read',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_tokenHash_key" ON "ApiToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ApiToken_revokedAt_idx" ON "ApiToken"("revokedAt");

-- CreateIndex
CREATE INDEX "ApiToken_expiresAt_idx" ON "ApiToken"("expiresAt");
