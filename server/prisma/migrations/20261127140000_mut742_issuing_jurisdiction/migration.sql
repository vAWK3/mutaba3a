-- MUT-742 (ADR-287): every issued document records the jurisdiction and the jurisdiction pack's version it was issued
-- under, and an issuer's tax ID gets a scheme and room for a number that is not nine digits.
--
-- Issued documents are INSERT-only (ADR-260: BEFORE UPDATE OR DELETE triggers), so this changes no row of that table:
-- ADD COLUMN with a constant default is a catalog-only change in Postgres 11+ (the default is the column's "missing
-- value", rows are not rewritten, no trigger fires, no UPDATE is issued), and every document issued before reads back
-- IL and 1.0.0, the only jurisdiction and pack there was. The defaults STAY: the application always writes both
-- explicitly, and an API image rolled back past this migration (which does not know the columns) still inserts, stamped
-- IL, which is right while Israel is the only live country. Widening a VARCHAR is also catalog-only; it is done only on
-- mutable tables (issued_documents.allocationNumber stays VARCHAR(9): it is Israel's projection of a clearance).
ALTER TABLE "issued_documents"
  ADD COLUMN "jurisdiction" VARCHAR(2) NOT NULL DEFAULT 'IL',
  ADD COLUMN "jurisdictionPackVersion" VARCHAR(16) NOT NULL DEFAULT '1.0.0';
-- NOT VALID then VALIDATE: the check is enforced for new rows at once and the table scan runs without blocking writes.
ALTER TABLE "issued_documents" ADD CONSTRAINT "issued_documents_jurisdiction_code" CHECK ("jurisdiction" ~ '^[A-Z]{2}$') NOT VALID;
ALTER TABLE "issued_documents" VALIDATE CONSTRAINT "issued_documents_jurisdiction_code";

-- The issuer's tax ID: room for a ZATCA or JoFotara number, and the scheme that says how to read it (the pack's
-- `taxId.scheme`; IL_TAX_ID = the Israeli VAT, company or ID number with its check digit).
ALTER TABLE "issuer_details" ALTER COLUMN "vatId" TYPE VARCHAR(32);
ALTER TABLE "issuer_details" ADD COLUMN "vatIdScheme" VARCHAR(16) NOT NULL DEFAULT 'IL_TAX_ID';

-- A customer's tax ID: room only (its scheme and country wait for their first reader, MUT-667 and MUT-743).
ALTER TABLE "customers" ALTER COLUMN "taxId" TYPE VARCHAR(32);
