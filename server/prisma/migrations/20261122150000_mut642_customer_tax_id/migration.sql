-- MUT-642: a customer's VAT, company or ID number and address, printed on issued documents. Both optional.
ALTER TABLE "customers" ADD COLUMN "taxId" VARCHAR(9);
ALTER TABLE "customers" ADD COLUMN "address" TEXT;
