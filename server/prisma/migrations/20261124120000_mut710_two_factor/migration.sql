-- MUT-710 (ADR-274): two-step sign-in. Additive only: three new tables, two enums, one nullable column on sessions.

-- CreateEnum
CREATE TYPE "TwoFactorMethod" AS ENUM ('totp', 'email');

-- CreateEnum
CREATE TYPE "TwoFactorPurpose" AS ENUM ('sign_in', 'enrol', 'reset', 'manage');

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "twoFactorAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "two_factor" (
    "userId" UUID NOT NULL,
    "method" "TwoFactorMethod" NOT NULL,
    "totpSecretSealed" TEXT,
    "lastUsedStep" BIGINT,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "failuresSince" TIMESTAMP(3),
    "lockedUntil" TIMESTAMP(3),
    "enabledAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "two_factor_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "two_factor_recovery_codes" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "codeDigest" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "two_factor_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "two_factor_challenges" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenDigest" VARCHAR(64) NOT NULL,
    "purpose" "TwoFactorPurpose" NOT NULL,
    "method" "TwoFactorMethod" NOT NULL,
    "sessionKind" "SessionKind",
    "firstStep" JSONB,
    "passwordChangedAt" TIMESTAMP(3),
    "linkId" UUID,
    "pendingSecretSealed" TEXT,
    "codeDigest" VARCHAR(64),
    "codeSentAt" TIMESTAMP(3),
    "codesSent" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "two_factor_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "two_factor_recovery_codes_codeDigest_key" ON "two_factor_recovery_codes"("codeDigest");

-- CreateIndex
CREATE INDEX "two_factor_recovery_codes_userId_idx" ON "two_factor_recovery_codes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "two_factor_challenges_tokenDigest_key" ON "two_factor_challenges"("tokenDigest");

-- CreateIndex
CREATE INDEX "two_factor_challenges_userId_idx" ON "two_factor_challenges"("userId");

-- CreateIndex
CREATE INDEX "two_factor_challenges_expiresAt_idx" ON "two_factor_challenges"("expiresAt");

-- AddForeignKey
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "two_factor_recovery_codes" ADD CONSTRAINT "two_factor_recovery_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "two_factor_challenges" ADD CONSTRAINT "two_factor_challenges_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

