-- MUT-641 (ADR-265): an issued document's signed original ("מקור"), kept once and handed out as is.
-- INSERT-only like the issued documents (ADR-260): the MUT-568 trigger refuses UPDATE, DELETE and TRUNCATE.
CREATE TABLE "issued_document_originals" (
    "documentId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "bytes" BYTEA NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issued_document_originals_pkey" PRIMARY KEY ("documentId")
);

CREATE INDEX "issued_document_originals_organizationId_idx" ON "issued_document_originals"("organizationId");

CREATE TRIGGER "issued_document_originals_immutable" BEFORE UPDATE OR DELETE ON "issued_document_originals" FOR EACH ROW EXECUTE FUNCTION "issuing_refuse_change"();
CREATE TRIGGER "issued_document_originals_no_truncate" BEFORE TRUNCATE ON "issued_document_originals" FOR EACH STATEMENT EXECUTE FUNCTION "issuing_refuse_change"();
