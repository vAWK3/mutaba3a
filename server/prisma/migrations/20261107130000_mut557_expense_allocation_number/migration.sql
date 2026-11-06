-- MUT-557 (ADR-246): the Israeli allocation number (מספר הקצאה) of a supplier's tax invoice. Nullable, so Postgres adds
-- it without a rewrite; every existing expense reads "none recorded". Nine digits, as the API normalizes it.
ALTER TABLE "expenses" ADD COLUMN "allocationNumber" VARCHAR(9);

ALTER TABLE "expenses" ADD CONSTRAINT "expenses_allocation_number_digits" CHECK ("allocationNumber" IS NULL OR "allocationNumber" ~ '^[0-9]{9}$');
