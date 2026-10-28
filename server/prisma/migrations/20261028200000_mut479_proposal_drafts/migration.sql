-- MUT-479 (ADR-224): a fee proposal stores the agreement an approval would make. Additive: two columns and a CHECK.
-- agreementType defaults to FIXED, and the backfill marks the proposals that carry contingency terms (MUT-107) as
-- CONTINGENCY, so every existing row says what its legacy approve makes. draft stays null on every existing row (no
-- draft was proposed). A revision that predates this inserts without either column during a rolling deploy and gets
-- FIXED with a null draft, which is what it meant unless it wrote contingency terms; the backfill cannot see those, so
-- a contingency proposal created during the roll reads FIXED until re-run (docs/operations/before-release.md).
--
-- Migrations are forward-only (DEPLOYMENT.md). To revert, ship a new migration:
--   ALTER TABLE "fee_proposals" DROP CONSTRAINT "fee_proposals_recurring_no_contingency_check";
--   ALTER TABLE "fee_proposals" DROP COLUMN "draft";
--   ALTER TABLE "fee_proposals" DROP COLUMN "agreementType";

-- AlterTable
ALTER TABLE "fee_proposals" ADD COLUMN "agreementType" "AgreementType" NOT NULL DEFAULT 'FIXED',
ADD COLUMN "draft" JSONB;

-- Backfill: a proposal with contingency terms is a CONTINGENCY proposal.
UPDATE "fee_proposals" SET "agreementType" = 'CONTINGENCY' WHERE "commissionRateBasisPoints" IS NOT NULL;

-- A retainer proposal carries no contingency terms (extends MUT-107's fee_proposals_contingency_terms_check).
ALTER TABLE "fee_proposals" ADD CONSTRAINT "fee_proposals_recurring_no_contingency_check"
  CHECK ("agreementType" <> 'RECURRING' OR "commissionRateBasisPoints" IS NULL);
