-- MUT-481 (ADR-223): the number of the legal receipt (קבלה) the firm issued in its invoicing app, on the payment.
-- Additive: one nullable column (every existing payment has none) and the index GET /v1/payments?receiptNumber= reads.
-- A revision that predates this inserts without it during a rolling deploy and gets null. Not unique: a correction
-- keeps the reversed payment's number.
--
-- Migrations are forward-only (DEPLOYMENT.md). To revert, ship a new migration:
--   DROP INDEX "payments_organizationId_receiptNumber_idx";
--   ALTER TABLE "payments" DROP COLUMN "receiptNumber";

-- AlterTable
ALTER TABLE "payments" ADD COLUMN "receiptNumber" VARCHAR(64);

-- CreateIndex
CREATE INDEX "payments_organizationId_receiptNumber_idx" ON "payments"("organizationId", "receiptNumber");
