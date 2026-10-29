-- MUT-443 (ADR-225): why a correction reversed a payment, as a code (CREDIT_REASON_CODES), so Malafat can label it.
-- Additive: one nullable column (every existing payment has none). A revision that predates this reverses without it
-- during a rolling deploy and leaves it null, as any plain reversal does; reversalReason keeps the text either way.
--
-- Migrations are forward-only (DEPLOYMENT.md). To revert, ship a new migration:
--   ALTER TABLE "payments" DROP COLUMN "reversalReasonCode";

-- AlterTable
ALTER TABLE "payments" ADD COLUMN "reversalReasonCode" VARCHAR(32);
