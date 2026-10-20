-- MUT-358 (ADR-160): billing core. Who pays, what Stripe says, and operator grants; nothing is enforced yet (MUT-361).
-- Additive: one enum, one users column, four tables, their FKs and indexes, one CHECK, and the pre-billing backfill.
--
-- The backfill (brief §2.7, Basel P1): every user who exists now gets an OPERATOR grant covering their own profiles,
-- and every operator-provisioned firm (no owner, not personal) gets one on itself, so the lapse gate (MUT-361) can't
-- turn anyone who exists today read-only. The pilot runbook revokes a person's grant once their Stripe subscription
-- is linked (MUT-360). Users created after this migration get a grant by hand (pilot-runbook.md) or a trial (MUT-331).
--
-- Migrations are forward-only (DEPLOYMENT.md). To revert, ship a new migration:
--   DROP TABLE "stripe_events"; DROP TABLE "entitlement_grants"; DROP TABLE "billing_subscriptions"; DROP TABLE "billing_accounts";
--   ALTER TABLE "users" DROP COLUMN "trialStartedAt";
--   DROP TYPE "BillingTier";

-- CreateEnum
CREATE TYPE "BillingTier" AS ENUM ('FREELANCER', 'FIRM');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "trialStartedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "billing_accounts" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "stripeCustomerId" TEXT NOT NULL,
    "country" VARCHAR(2),
    "currency" VARCHAR(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_subscriptions" (
    "id" UUID NOT NULL,
    "billingAccountId" UUID NOT NULL,
    "stripeSubscriptionId" TEXT NOT NULL,
    "tier" "BillingTier" NOT NULL,
    "organizationId" UUID,
    "status" VARCHAR(32) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "priceLookupKey" VARCHAR(100),
    "founderUntil" TIMESTAMP(3),
    "stripeUpdatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entitlement_grants" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "organizationId" UUID,
    "tier" "BillingTier" NOT NULL,
    "reason" VARCHAR(200) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "grantedBy" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "entitlement_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stripe_events" (
    "id" TEXT NOT NULL,
    "type" VARCHAR(100) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "stripe_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "billing_accounts_userId_key" ON "billing_accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "billing_accounts_stripeCustomerId_key" ON "billing_accounts"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "billing_subscriptions_stripeSubscriptionId_key" ON "billing_subscriptions"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "billing_subscriptions_billingAccountId_idx" ON "billing_subscriptions"("billingAccountId");

-- CreateIndex
CREATE INDEX "billing_subscriptions_organizationId_idx" ON "billing_subscriptions"("organizationId");

-- CreateIndex
CREATE INDEX "entitlement_grants_userId_idx" ON "entitlement_grants"("userId");

-- CreateIndex
CREATE INDEX "entitlement_grants_organizationId_idx" ON "entitlement_grants"("organizationId");

-- AddForeignKey
ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "billing_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlement_grants" ADD CONSTRAINT "entitlement_grants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlement_grants" ADD CONSTRAINT "entitlement_grants_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A grant covers either a person's own profiles or one profile, never both and never neither.
ALTER TABLE "entitlement_grants" ADD CONSTRAINT "entitlement_grants_one_target_check" CHECK (("userId" IS NULL) <> ("organizationId" IS NULL));

-- Pre-billing backfill (P1).
INSERT INTO "entitlement_grants" ("id", "userId", "tier", "reason", "grantedBy")
SELECT gen_random_uuid(), "id", 'FREELANCER', 'pre-billing', 'migration:mut358' FROM "users";

INSERT INTO "entitlement_grants" ("id", "organizationId", "tier", "reason", "grantedBy")
SELECT gen_random_uuid(), "id", 'FIRM', 'pre-billing', 'migration:mut358' FROM "organizations"
WHERE "ownerUserId" IS NULL AND "personalOwnerUserId" IS NULL;
