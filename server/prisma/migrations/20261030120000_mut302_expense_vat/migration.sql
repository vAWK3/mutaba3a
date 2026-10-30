-- MUT-302 (ADR-231): VAT on expenses. Nullable columns, so Postgres adds them without a rewrite; every existing row
-- reads "No VAT recorded". The gross is "amountMinor" (no second copy).
ALTER TABLE "expenses" ADD COLUMN "vatTreatment" "VatTreatment",
ADD COLUMN "vatRateBasisPoints" INTEGER,
ADD COLUMN "netMinor" BIGINT,
ADD COLUMN "vatMinor" BIGINT;

ALTER TABLE "expenses" ADD CONSTRAINT "expenses_vat_all_or_none" CHECK (
  ("vatTreatment" IS NULL AND "vatRateBasisPoints" IS NULL AND "netMinor" IS NULL AND "vatMinor" IS NULL)
  OR ("vatTreatment" IS NOT NULL AND "vatRateBasisPoints" IS NOT NULL AND "netMinor" IS NOT NULL AND "vatMinor" IS NOT NULL)
);
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_vat_adds_up" CHECK ("netMinor" IS NULL OR "netMinor" + "vatMinor" = "amountMinor");
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_vat_zero_unless_standard" CHECK ("vatTreatment" IS NULL OR "vatTreatment" = 'STANDARD_RATED' OR ("vatMinor" = 0 AND "vatRateBasisPoints" = 0));
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_vat_standard_rate" CHECK ("vatTreatment" IS DISTINCT FROM 'STANDARD_RATED' OR "vatRateBasisPoints" BETWEEN 1 AND 10000);
