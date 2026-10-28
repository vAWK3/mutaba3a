-- MUT-480 (ADR-222): lowering a fee. Additive: nullable or defaulted columns every existing row already satisfies, so a
-- revision that predates this inserts without them during a rolling deploy and gets null / 0.
--   agreement_supplements: reasonCode, appliedGrossMinor (the gross taken off) and creditedMinor (the part of it that
--     became credits), set on REDUCTION rows only.
--   receivable_credits.reasonCode: why a receivable was credited; null on credits made before reason codes.
--
-- Migrations are forward-only (DEPLOYMENT.md). To revert, ship a new migration:
--   ALTER TABLE "receivable_credits" DROP COLUMN "reasonCode";
--   ALTER TABLE "agreement_supplements" DROP COLUMN "creditedMinor", DROP COLUMN "appliedGrossMinor", DROP COLUMN "reasonCode";

-- AlterTable
ALTER TABLE "agreement_supplements" ADD COLUMN "reasonCode" VARCHAR(32),
ADD COLUMN "appliedGrossMinor" BIGINT,
ADD COLUMN "creditedMinor" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "receivable_credits" ADD COLUMN "reasonCode" VARCHAR(32);
