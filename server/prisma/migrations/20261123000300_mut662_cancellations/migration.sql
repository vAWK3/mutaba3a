-- MUT-662: a payment request is cancelled by a record of its own, never by changing the document. Insert-only like
-- every issuing table, with no foreign keys (kept 7 years, MUT-644).
CREATE TABLE "issued_document_cancellations" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "cancelledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" VARCHAR(300),
    "createdByUserId" UUID NOT NULL,
    "requestKey" VARCHAR(128) NOT NULL,

    CONSTRAINT "issued_document_cancellations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "issued_document_cancellations_documentId_key" ON "issued_document_cancellations"("documentId");
CREATE UNIQUE INDEX "issued_document_cancellations_organizationId_number_key" ON "issued_document_cancellations"("organizationId", "number");
CREATE UNIQUE INDEX "issued_document_cancellations_organizationId_requestKey_key" ON "issued_document_cancellations"("organizationId", "requestKey");

CREATE TABLE "issued_cancellation_counters" (
    "organizationId" UUID NOT NULL,
    "next" INTEGER NOT NULL,

    CONSTRAINT "issued_cancellation_counters_pkey" PRIMARY KEY ("organizationId")
);

CREATE TRIGGER "issued_document_cancellations_immutable" BEFORE UPDATE OR DELETE ON "issued_document_cancellations" FOR EACH ROW EXECUTE FUNCTION "issuing_refuse_change"();
CREATE TRIGGER "issued_document_cancellations_no_truncate" BEFORE TRUNCATE ON "issued_document_cancellations" FOR EACH STATEMENT EXECUTE FUNCTION "issuing_refuse_change"();
