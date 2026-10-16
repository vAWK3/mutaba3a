-- MUT-235: one-time setup links replace printed passwords (ADR-088).
-- Additive: a new enum and table, and users.passwordHash relaxed to NULL-able.
-- No existing row changes: every current user keeps the hash they have. NULL
-- means "no password yet" (a new account before its link is used, or an
-- operator reset with --lock); sign-in refuses it exactly like a wrong password.
-- Only the HMAC-SHA256 digest of a link's token is stored.

-- CreateEnum
CREATE TYPE "SetupLinkPurpose" AS ENUM ('SETUP', 'RESET');

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "passwordHash" DROP NOT NULL;

-- CreateTable
CREATE TABLE "account_setup_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenDigest" VARCHAR(64) NOT NULL,
    "purpose" "SetupLinkPurpose" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "account_setup_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_setup_tokens_tokenDigest_key" ON "account_setup_tokens"("tokenDigest");

-- CreateIndex
CREATE INDEX "account_setup_tokens_userId_idx" ON "account_setup_tokens"("userId");

-- AddForeignKey
ALTER TABLE "account_setup_tokens" ADD CONSTRAINT "account_setup_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
