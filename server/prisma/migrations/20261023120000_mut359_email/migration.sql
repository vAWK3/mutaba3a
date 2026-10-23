-- MUT-359 (ADR-159 §5): transactional mail. The send log behind the caps and idempotency (digests only, never an
-- address or a body; pruned after 30 days) and the suppression list the Resend webhook writes. Additive: two enums,
-- two tables and their indexes. Nothing reads them until a mailer is configured.
--
-- Migrations are forward-only (DEPLOYMENT.md). To revert, ship a new migration:
--   DROP TABLE "email_suppressions"; DROP TABLE "email_deliveries";
--   DROP TYPE "EmailSuppressionReason"; DROP TYPE "EmailDeliveryStatus";

-- CreateEnum
CREATE TYPE "EmailDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'UNCERTAIN');

-- CreateEnum
CREATE TYPE "EmailSuppressionReason" AS ENUM ('HARD_BOUNCE', 'COMPLAINT');

-- CreateTable
CREATE TABLE "email_deliveries" (
    "id" UUID NOT NULL,
    "keyDigest" VARCHAR(64) NOT NULL,
    "recipientDigest" VARCHAR(64) NOT NULL,
    "template" VARCHAR(40) NOT NULL,
    "locale" VARCHAR(5) NOT NULL,
    "status" "EmailDeliveryStatus" NOT NULL,
    "providerId" VARCHAR(100),
    "error" VARCHAR(200),
    "createdAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "email_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_suppressions" (
    "email" TEXT NOT NULL,
    "reason" "EmailSuppressionReason" NOT NULL,
    "eventId" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_suppressions_pkey" PRIMARY KEY ("email")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_deliveries_keyDigest_key" ON "email_deliveries"("keyDigest");

-- CreateIndex
CREATE INDEX "email_deliveries_createdAt_idx" ON "email_deliveries"("createdAt");

-- CreateIndex
CREATE INDEX "email_deliveries_recipientDigest_createdAt_idx" ON "email_deliveries"("recipientDigest", "createdAt");

