-- MUT-660 (ADR-270): documents due per client. Additive only: what is due is derived, never stored.
CREATE TYPE "DocumentsPreference" AS ENUM ('TAX_INVOICE_FIRST', 'PAYMENT_REQUEST_FIRST', 'ON_PAYMENT', 'NO_DOCUMENT');

ALTER TABLE "customers" ADD COLUMN "documentsPreference" "DocumentsPreference";
ALTER TABLE "issuer_details" ADD COLUMN "defaultDocumentsPreference" "DocumentsPreference" NOT NULL DEFAULT 'ON_PAYMENT';
ALTER TABLE "receivables" ADD COLUMN "notForInvoice" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "payments" ADD COLUMN "notForInvoice" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "issued_documents_organizationId_receivableId_idx" ON "issued_documents"("organizationId", "receivableId");
CREATE INDEX "issued_documents_organizationId_paymentId_idx" ON "issued_documents"("organizationId", "paymentId");
