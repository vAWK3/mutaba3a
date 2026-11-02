-- MUT-303: a vendor remembers the currency and VAT of its expenses, to prefill the next one. Nullable columns, so
-- Postgres adds them without a rewrite.
ALTER TABLE "vendors" ADD COLUMN "lastCurrency" VARCHAR(3),
ADD COLUMN "lastVatTreatment" "VatTreatment",
ADD COLUMN "lastVatRateBasisPoints" INTEGER;

ALTER TABLE "vendors" ADD CONSTRAINT "vendors_last_vat_both_or_none" CHECK (("lastVatTreatment" IS NULL) = ("lastVatRateBasisPoints" IS NULL));

-- D5: seed each vendor's currency from its latest live expense, in the currencies the API supports today. No VAT
-- seed: expense VAT is days old (MUT-302), and the next save with VAT teaches it.
UPDATE "vendors" v SET "lastCurrency" = latest."currency"
FROM (
  SELECT DISTINCT ON ("vendorId") "vendorId", "currency"
  FROM "expenses"
  WHERE "vendorId" IS NOT NULL AND "deletedAt" IS NULL AND "currency" IN ('ILS', 'USD', 'EUR', 'JOD')
  ORDER BY "vendorId", "occurredOn" DESC, "createdAt" DESC, "id" DESC
) AS latest
WHERE v."id" = latest."vendorId" AND v."lastCurrency" IS NULL;
