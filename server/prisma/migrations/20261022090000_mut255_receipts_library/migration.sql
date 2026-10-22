-- MUT-255: the receipts library. A receipt belongs to its profile and may have no expense yet ("To review").
-- Additive: a new enum, `expenseId` becomes optional, seven columns, one foreign key, one CHECK and one index.
--
-- `filingStatus` defaults to FILED and `receivedOn` to the UTC day, for the same reason: during a rolling deploy the previous revision still inserts
-- MUT-44 receipts with an expense and neither column, and those must pass the CHECK and the NOT NULL. Every existing row has an
-- expense, so the default is also its correct value. The library route sets TO_REVIEW itself.
-- The expense foreign key stays ON DELETE RESTRICT: expenses are only ever soft-deleted, and SET NULL would break
-- the CHECK.
--
-- Migrations are forward-only (DEPLOYMENT.md). Once any receipt has a NULL "expenseId", the previous revision's
-- Prisma client can't read that row (P2032), so a rollback is a roll-forward fix, or soft-deleting the To-review
-- rows first. To revert the schema, ship a new migration:
--   ALTER TABLE "expense_receipts" DROP CONSTRAINT "expense_receipts_filed_has_record";
--   DROP INDEX "expense_receipts_organizationId_filingStatus_receivedOn_cre_idx";
--   ALTER TABLE "expense_receipts" DROP CONSTRAINT "expense_receipts_approvedByUserId_fkey";
--   ALTER TABLE "expense_receipts" DROP COLUMN "filingStatus", DROP COLUMN "receivedOn", DROP COLUMN "suggested",
--     DROP COLUMN "approved", DROP COLUMN "approvedAt", DROP COLUMN "approvedByUserId", DROP COLUMN "version";
--   ALTER TABLE "expense_receipts" ALTER COLUMN "expenseId" SET NOT NULL;  -- only once no row has a NULL expense
--   DROP TYPE "ReceiptFilingStatus";

-- CreateEnum
CREATE TYPE "ReceiptFilingStatus" AS ENUM ('TO_REVIEW', 'FILED');

-- AlterTable
ALTER TABLE "expense_receipts" ALTER COLUMN "expenseId" DROP NOT NULL,
ADD COLUMN     "filingStatus" "ReceiptFilingStatus" NOT NULL DEFAULT 'FILED',
ADD COLUMN     "receivedOn" VARCHAR(10) NOT NULL DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD'::text),
ADD COLUMN     "suggested" JSONB,
ADD COLUMN     "approved" JSONB,
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedByUserId" UUID,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- Backfill existing rows: the upload day in the profile's timezone ("createdAt" is stored as UTC without a zone).
UPDATE "expense_receipts" r
SET "receivedOn" = to_char(((r."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE o."timezone"), 'YYYY-MM-DD')
FROM "organizations" o
WHERE o."id" = r."organizationId";

-- AddForeignKey: SET NULL, the way close-account anonymizes a person's rows on shared profiles (MUT-333).
ALTER TABLE "expense_receipts" ADD CONSTRAINT "expense_receipts_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- FILED exactly when the receipt has a record (MUT-308 adds "or a bill").
ALTER TABLE "expense_receipts" ADD CONSTRAINT "expense_receipts_filed_has_record" CHECK (("filingStatus" = 'FILED') = ("expenseId" IS NOT NULL));

-- CreateIndex
CREATE INDEX "expense_receipts_organizationId_filingStatus_receivedOn_cre_idx" ON "expense_receipts"("organizationId", "filingStatus", "receivedOn", "createdAt");
