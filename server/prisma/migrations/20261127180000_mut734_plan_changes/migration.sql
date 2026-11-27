-- MUT-734 (ADR-291): plan changes a person asked for (up now, down at the period end, to Starter).
-- Additive only: one new table, nothing else touched, so old and new code run together.
-- Rollback: DROP TABLE "billing_plan_changes";

-- CreateTable
CREATE TABLE "billing_plan_changes" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "stripeSubscriptionId" TEXT NOT NULL,
    "fromTier" VARCHAR(16) NOT NULL,
    "toTier" VARCHAR(16) NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "state" VARCHAR(16) NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "amountMinor" INTEGER,
    "currency" CHAR(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_plan_changes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "billing_plan_changes_kind_check" CHECK ("kind" IN ('UPGRADE', 'DOWNGRADE', 'TO_STARTER')),
    CONSTRAINT "billing_plan_changes_state_check" CHECK ("state" IN ('APPLIED', 'PENDING', 'SCHEDULED', 'UNDONE', 'FAILED')),
    CONSTRAINT "billing_plan_changes_tiers_check" CHECK ("fromTier" IN ('FREELANCER', 'SOLO', 'BUSINESS', 'FIRM') AND "toTier" IN ('STARTER', 'SOLO', 'BUSINESS', 'FIRM'))
);

-- CreateIndex
CREATE INDEX "billing_plan_changes_userId_createdAt_idx" ON "billing_plan_changes"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "billing_plan_changes" ADD CONSTRAINT "billing_plan_changes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- At most one change waits for the period end per person: undo it before scheduling another.
CREATE UNIQUE INDEX "billing_plan_changes_one_scheduled" ON "billing_plan_changes"("userId") WHERE "state" = 'SCHEDULED';
