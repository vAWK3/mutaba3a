-- MUT-107: contingency terms on fee proposals. The proposed upfront lives in the existing proposedAmountMinor column.

-- AlterTable
ALTER TABLE "fee_proposals" ADD COLUMN     "commissionRateBasisPoints" INTEGER,
ADD COLUMN     "upfrontTreatment" "UpfrontTreatment";

-- Both columns are set together or neither is (mirrors the agreements CONTINGENCY check added by MUT-100).
ALTER TABLE "fee_proposals" ADD CONSTRAINT "fee_proposals_contingency_terms_check"
  CHECK (("commissionRateBasisPoints" IS NULL) = ("upfrontTreatment" IS NULL));
