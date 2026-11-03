-- MUT-534 (ADR-243): the come-back offer. Additive: one nullable billing_subscriptions column (Stripe's ended_at) and
-- its index, one enum value, and one partial unique index. The nightly reconcile fills endedAt for subscriptions that
-- already ended (it lists them all).
--
-- Migrations are forward-only (DEPLOYMENT.md). To revert, ship a new migration:
--   DROP INDEX "billing_retention_events_one_comeback_stage"; DROP INDEX "billing_subscriptions_status_endedAt_idx";
--   ALTER TABLE "billing_subscriptions" DROP COLUMN "endedAt";
--   (an enum value can't be dropped in place; leave COMEBACK_OFFERED unused)

-- AlterEnum
ALTER TYPE "BillingRetentionKind" ADD VALUE 'COMEBACK_OFFERED';

-- AlterTable
ALTER TABLE "billing_subscriptions" ADD COLUMN     "endedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "billing_subscriptions_status_endedAt_idx" ON "billing_subscriptions"("status", "endedAt");

-- The one-stage-per-person index is the next migration: a new enum value can't be used in the transaction that adds it.
