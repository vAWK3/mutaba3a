-- MUT-643 (ADR-276): a credit note may reach past what is still owed into what the client paid. The paid part either
-- stays with the client as unallocated money or goes back to them as a refund. A refund is a ledger row beside its
-- credit note (not a numbered document): append-only in code like receivable_credits, purged with the profile, no
-- immutability trigger. Its sources name the payments the money came from; refunded money counts in their
-- "allocatedMinor". Additive: no existing row changes.
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "refundedOn" VARCHAR(10) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "issuedDocumentId" UUID NOT NULL,
    "requestId" TEXT,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "refunds_amount_positive" CHECK ("amountMinor" > 0)
);

CREATE TABLE "refund_sources" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "refundId" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "amountMinor" BIGINT NOT NULL,

    CONSTRAINT "refund_sources_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "refund_sources_amount_positive" CHECK ("amountMinor" > 0)
);

CREATE UNIQUE INDEX "refunds_organizationId_issuedDocumentId_key" ON "refunds"("organizationId", "issuedDocumentId");
CREATE INDEX "refunds_organizationId_customerId_refundedOn_idx" ON "refunds"("organizationId", "customerId", "refundedOn");
CREATE INDEX "refunds_organizationId_refundedOn_idx" ON "refunds"("organizationId", "refundedOn");
CREATE INDEX "refund_sources_organizationId_paymentId_idx" ON "refund_sources"("organizationId", "paymentId");
CREATE INDEX "refund_sources_refundId_idx" ON "refund_sources"("refundId");

ALTER TABLE "refund_sources" ADD CONSTRAINT "refund_sources_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The credit note names its refund; no FK, like "creditId" (issued documents outlive the ledger, ADR-260 decision 2).
ALTER TABLE "issued_documents" ADD COLUMN "refundId" UUID;
