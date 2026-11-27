-- MUT-763 (accountant channel, epic MUT-762): an approved accountant creates a customer's account.
-- Additive only: nullable columns and indexes, so old and new code can run together. Rollback = switch ACCOUNTANT_PROVISIONING off;
-- created accounts and grants stay untouched.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "accountantProvisioningEnabledAt" TIMESTAMP(3),
ADD COLUMN     "provisionCreateLimitPerDay" INTEGER,
ADD COLUMN     "provisionLookupLimitPerDay" INTEGER,
ADD COLUMN     "provisionedAt" TIMESTAMP(3),
ADD COLUMN     "provisionedByUserId" UUID;

-- AlterTable
ALTER TABLE "account_setup_tokens" ADD COLUMN     "claimCodeAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "claimCodeDigest" VARCHAR(64),
ADD COLUMN     "mailStatus" VARCHAR(8);

-- CreateIndex
CREATE INDEX "users_provisionedByUserId_provisionedAt_idx" ON "users"("provisionedByUserId", "provisionedAt");

-- CreateIndex
CREATE INDEX "audit_events_actorId_action_createdAt_idx" ON "audit_events"("actorId", "action", "createdAt");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_provisionedByUserId_fkey" FOREIGN KEY ("provisionedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The unclaimed list and the 60-day sweep read only accounts nobody has claimed; a partial index keeps them cheap.
CREATE INDEX "users_unclaimed_provisioned_idx" ON "users"("provisionedAt") WHERE "passwordHash" IS NULL AND "provisionedAt" IS NOT NULL;

-- A provisioned account's creator is only ever recorded together with when.
ALTER TABLE "users" ADD CONSTRAINT "users_provisioned_pair_check" CHECK ("provisionedByUserId" IS NULL OR "provisionedAt" IS NOT NULL);
ALTER TABLE "users" ADD CONSTRAINT "users_provision_limits_check" CHECK (("provisionCreateLimitPerDay" IS NULL OR "provisionCreateLimitPerDay" >= 0) AND ("provisionLookupLimitPerDay" IS NULL OR "provisionLookupLimitPerDay" >= 0));
ALTER TABLE "account_setup_tokens" ADD CONSTRAINT "account_setup_tokens_claim_check" CHECK ("claimCodeAttempts" >= 0 AND ("mailStatus" IS NULL OR "mailStatus" IN ('PENDING', 'SENT', 'FAILED')));
