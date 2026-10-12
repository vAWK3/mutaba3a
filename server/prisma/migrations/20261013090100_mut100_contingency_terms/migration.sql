-- MUT-100: contingency terms and outcome on agreements, and the commission flag on installments.

-- CreateEnum
CREATE TYPE "UpfrontTreatment" AS ENUM ('SEPARATE', 'CREDITED');

-- CreateEnum
CREATE TYPE "ContingencyOutcome" AS ENUM ('AWARDED', 'NO_RECOVERY');

-- AlterTable
ALTER TABLE "agreements" ADD COLUMN     "awardedAmountMinor" BIGINT,
ADD COLUMN     "commissionRateBasisPoints" INTEGER,
ADD COLUMN     "outcome" "ContingencyOutcome",
ADD COLUMN     "outcomeDate" VARCHAR(10),
ADD COLUMN     "outcomeNote" TEXT,
ADD COLUMN     "outcomeRecordedAt" TIMESTAMP(3),
ADD COLUMN     "upfrontTreatment" "UpfrontTreatment";

-- AlterTable
ALTER TABLE "installments" ADD COLUMN     "isCommission" BOOLEAN NOT NULL DEFAULT false;

-- A CONTINGENCY row always carries a rate and a treatment (the application refuses both earlier; this is the floor).
-- The explicit IS NOT NULL matters: `NULL BETWEEN 1 AND 10000` is NULL, and a CHECK that evaluates to NULL passes.
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_contingency_terms_check"
  CHECK ("type" <> 'CONTINGENCY' OR ("commissionRateBasisPoints" IS NOT NULL AND "commissionRateBasisPoints" BETWEEN 1 AND 10000 AND "upfrontTreatment" IS NOT NULL));
