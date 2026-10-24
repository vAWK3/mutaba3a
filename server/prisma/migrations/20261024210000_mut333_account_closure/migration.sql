-- MUT-333 (ADR-188): Close my account. Additive columns, one new table, and relaxed foreign keys; no backfill.
--
-- 1. The closure lives on the user row (D18): the auth layer already reads it on every request.
--    closeRequestedAt / deleteAfter are set together (CHECK). closeEndedSubscriptionIds are the Stripe subscriptions
--    the closing set to end, so "Keep my account" turns back on only those (D1). purgeStartedAt is the hard delete's
--    claim (R1): once set, a cancel can never win. purgeLastTriedAt orders retries (R13).
ALTER TABLE "users" ADD COLUMN "closeRequestedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "deleteAfter" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "closeEndedSubscriptionIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "users" ADD COLUMN "purgeStartedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "purgeLastTriedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD CONSTRAINT "users_closure_pair_check" CHECK (("closeRequestedAt" IS NULL) = ("deleteAfter" IS NULL));
ALTER TABLE "users" ADD CONSTRAINT "users_purge_needs_closure_check" CHECK ("purgeStartedAt" IS NULL OR "deleteAfter" IS NOT NULL);
CREATE INDEX "users_deleteAfter_idx" ON "users"("deleteAfter") WHERE "deleteAfter" IS NOT NULL;

-- 2. R1: the bucket prefixes of deleted profiles, written in the purge's own transaction and emptied after the commit.
--    No foreign key: the profile is gone by then.
CREATE TABLE "storage_purges" (
    "organizationId" UUID NOT NULL,
    "queuedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "storage_purges_pkey" PRIMARY KEY ("organizationId")
);

-- 3. D7 (Basel, MUT-333 comment 12293): a closed person's records on a profile they didn't own stay, anonymized.
ALTER TABLE "expenses" ALTER COLUMN "createdByUserId" DROP NOT NULL;
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_createdByUserId_fkey";
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "expense_receipts" ALTER COLUMN "uploadedByUserId" DROP NOT NULL;
ALTER TABLE "expense_receipts" DROP CONSTRAINT "expense_receipts_uploadedByUserId_fkey";
ALTER TABLE "expense_receipts" ADD CONSTRAINT "expense_receipts_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "conversions" ALTER COLUMN "createdByUserId" DROP NOT NULL;
ALTER TABLE "conversions" DROP CONSTRAINT "conversions_createdByUserId_fkey";
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "expense_groups" ALTER COLUMN "createdByUserId" DROP NOT NULL;
ALTER TABLE "expense_groups" DROP CONSTRAINT "expense_groups_createdByUserId_fkey";
ALTER TABLE "expense_groups" ADD CONSTRAINT "expense_groups_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A pending firm request survives its requester; the pair CHECK now says only "requested-by implies requested-at".
ALTER TABLE "organizations" DROP CONSTRAINT "organizations_firmRequestedByUserId_fkey";
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_firmRequestedByUserId_fkey" FOREIGN KEY ("firmRequestedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "organizations" DROP CONSTRAINT "organizations_firm_request_pair_check";
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_firm_request_pair_check" CHECK ("firmRequestedByUserId" IS NULL OR "firmRequestedAt" IS NOT NULL);
