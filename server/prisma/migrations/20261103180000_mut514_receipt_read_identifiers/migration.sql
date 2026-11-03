-- MUT-514 (D6, D10): the phone and ID numbers a server read found on a receipt, digits only, as
-- {"buyer": [...], "vendor": [...]}: its bill-to blocks and what it filled as the vendor's. The organization's buyer
-- memory is learned from them. Nullable, so Postgres adds it without a rewrite and an older API ignores it.
ALTER TABLE "expense_receipts" ADD COLUMN "readIdentifiers" JSONB;
