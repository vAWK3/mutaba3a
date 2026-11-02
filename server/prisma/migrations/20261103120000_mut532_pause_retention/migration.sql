-- MUT-532 (ADR-239): pause instead of cancel, and the stay offer. Additive: two nullable billing_subscriptions columns
-- (the mirror of Stripe's pause_collection), one enum, one table and its indexes. No backfill: no subscription is
-- paused today, and nobody has had a pause or an offer.
--
-- Migrations are forward-only (DEPLOYMENT.md). To revert, ship a new migration:
--   DROP TABLE "billing_retention_events"; DROP TYPE "BillingRetentionKind";
--   ALTER TABLE "billing_subscriptions" DROP COLUMN "pausedFrom", DROP COLUMN "pauseResumesAt";

-- AlterTable
ALTER TABLE "billing_subscriptions" ADD COLUMN     "pausedFrom" TIMESTAMP(3),
ADD COLUMN     "pauseResumesAt" TIMESTAMP(3);

-- CreateEnum
CREATE TYPE "BillingRetentionKind" AS ENUM ('PAUSE', 'STAY_OFFER', 'CANCEL', 'YEARLY_SWITCH');

-- CreateTable
CREATE TABLE "billing_retention_events" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "stripeSubscriptionId" TEXT NOT NULL,
    "kind" "BillingRetentionKind" NOT NULL,
    "reason" VARCHAR(40),
    "months" INTEGER,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "endedEarlyAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_retention_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "billing_retention_events_userId_kind_startsAt_idx" ON "billing_retention_events"("userId", "kind", "startsAt");

-- AddForeignKey
ALTER TABLE "billing_retention_events" ADD CONSTRAINT "billing_retention_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The stay offer is once per person, ever (epic rule 2): a double press or a retry can never claim it twice.
CREATE UNIQUE INDEX "billing_retention_events_one_stay_offer" ON "billing_retention_events"("userId") WHERE "kind" = 'STAY_OFFER';
