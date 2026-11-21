-- MUT-568 (ADR-259): the issuing core. Issued documents are legal records kept 7 years even after the account
-- closes (MUT-644): no foreign keys, and documents, lines and copies are INSERT-only.

-- CreateEnum
CREATE TYPE "IssuedDocType" AS ENUM ('TAX_INVOICE', 'TAX_INVOICE_RECEIPT', 'CREDIT_NOTE', 'RECEIPT');

-- CreateEnum
CREATE TYPE "DealerType" AS ENUM ('LICENSED', 'EXEMPT', 'COMPANY', 'NONPROFIT');



-- CreateTable
CREATE TABLE "issuer_details" (
    "organizationId" UUID NOT NULL,
    "legalName" TEXT NOT NULL,
    "vatId" VARCHAR(9) NOT NULL,
    "dealerType" "DealerType" NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "logoAttachmentId" UUID,
    "ink" VARCHAR(5) NOT NULL DEFAULT 'BLACK',
    "documentStyle" VARCHAR(32) NOT NULL DEFAULT 'PROFESSIONAL',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "issuer_details_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "issued_document_counters" (
    "organizationId" UUID NOT NULL,
    "docType" "IssuedDocType" NOT NULL,
    "start" INTEGER NOT NULL,
    "next" INTEGER NOT NULL,

    CONSTRAINT "issued_document_counters_pkey" PRIMARY KEY ("organizationId","docType")
);

-- CreateTable
CREATE TABLE "issued_documents" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "docType" "IssuedDocType" NOT NULL,
    "number" INTEGER NOT NULL,
    "documentDate" VARCHAR(10) NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currency" VARCHAR(3) NOT NULL,
    "subtotalMinor" BIGINT NOT NULL,
    "discountMinor" BIGINT NOT NULL,
    "netMinor" BIGINT NOT NULL,
    "vatRateBasisPoints" INTEGER NOT NULL,
    "vatMinor" BIGINT NOT NULL,
    "grossMinor" BIGINT NOT NULL,
    "issuer" JSONB NOT NULL,
    "customerId" UUID,
    "customer" JSONB NOT NULL,
    "language" VARCHAR(2) NOT NULL,
    "style" VARCHAR(32) NOT NULL,
    "ink" VARCHAR(5) NOT NULL,
    "notes" TEXT,
    "originalId" UUID,
    "paymentDetails" JSONB,
    "allocationNumber" VARCHAR(9),
    "receivableId" UUID,
    "paymentId" UUID,
    "creditId" UUID,
    "coreVersion" VARCHAR(16) NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "requestKey" VARCHAR(128) NOT NULL,

    CONSTRAINT "issued_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issued_document_lines" (
    "documentId" UUID NOT NULL,
    "index" INTEGER NOT NULL,
    "organizationId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "kind" VARCHAR(7) NOT NULL,
    "quantityMilli" BIGINT NOT NULL,
    "unitPriceMinor" BIGINT NOT NULL,
    "discountMinor" BIGINT NOT NULL,
    "netMinor" BIGINT NOT NULL,
    "vatRateBasisPoints" INTEGER NOT NULL,
    "vatMinor" BIGINT NOT NULL,

    CONSTRAINT "issued_document_lines_pkey" PRIMARY KEY ("documentId","index")
);

-- CreateTable
CREATE TABLE "issued_document_copies" (
    "documentId" UUID NOT NULL,
    "copyIndex" INTEGER NOT NULL,
    "organizationId" UUID NOT NULL,
    "producedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "producedByUserId" UUID NOT NULL,
    "channel" VARCHAR(8) NOT NULL,

    CONSTRAINT "issued_document_copies_pkey" PRIMARY KEY ("documentId","copyIndex")
);

-- CreateIndex
CREATE INDEX "issued_documents_organizationId_customerId_documentDate_idx" ON "issued_documents"("organizationId", "customerId", "documentDate");

-- CreateIndex
CREATE INDEX "issued_documents_organizationId_documentDate_idx" ON "issued_documents"("organizationId", "documentDate");

-- CreateIndex
CREATE INDEX "issued_documents_originalId_idx" ON "issued_documents"("originalId");

-- CreateIndex
CREATE UNIQUE INDEX "issued_documents_organizationId_docType_number_key" ON "issued_documents"("organizationId", "docType", "number");

-- CreateIndex
CREATE UNIQUE INDEX "issued_documents_organizationId_requestKey_key" ON "issued_documents"("organizationId", "requestKey");

-- CreateIndex
CREATE INDEX "issued_document_lines_organizationId_idx" ON "issued_document_lines"("organizationId");

-- CreateIndex
CREATE INDEX "issued_document_copies_organizationId_idx" ON "issued_document_copies"("organizationId");


-- Immutability. Only the MUT-644 retention sweep may change these rows, with SET LOCAL mutaba3a.issuing_bypass = 'on'
-- inside its own transaction. TRUNCATE skips row triggers, so it gets a statement trigger of its own.
CREATE FUNCTION "issuing_refuse_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('mutaba3a.issuing_bypass', true) = 'on' THEN
    IF TG_LEVEL = 'ROW' THEN RETURN COALESCE(NEW, OLD); END IF;
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'issued documents are immutable: % on % refused (MUT-568)', TG_OP, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER "issued_documents_immutable" BEFORE UPDATE OR DELETE ON "issued_documents" FOR EACH ROW EXECUTE FUNCTION "issuing_refuse_change"();
CREATE TRIGGER "issued_documents_no_truncate" BEFORE TRUNCATE ON "issued_documents" FOR EACH STATEMENT EXECUTE FUNCTION "issuing_refuse_change"();
CREATE TRIGGER "issued_document_lines_immutable" BEFORE UPDATE OR DELETE ON "issued_document_lines" FOR EACH ROW EXECUTE FUNCTION "issuing_refuse_change"();
CREATE TRIGGER "issued_document_lines_no_truncate" BEFORE TRUNCATE ON "issued_document_lines" FOR EACH STATEMENT EXECUTE FUNCTION "issuing_refuse_change"();
CREATE TRIGGER "issued_document_copies_immutable" BEFORE UPDATE OR DELETE ON "issued_document_copies" FOR EACH ROW EXECUTE FUNCTION "issuing_refuse_change"();
CREATE TRIGGER "issued_document_copies_no_truncate" BEFORE TRUNCATE ON "issued_document_copies" FOR EACH STATEMENT EXECUTE FUNCTION "issuing_refuse_change"();

-- A counter is never deleted (its numbers would be reused) and never moves back once a document of its type exists;
-- before the first document the starting number may still change (D3).
CREATE FUNCTION "issuing_counter_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('mutaba3a.issuing_bypass', true) = 'on' THEN
    IF TG_LEVEL = 'ROW' THEN RETURN COALESCE(NEW, OLD); END IF;
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW."next" >= OLD."next" AND NEW."start" = OLD."start" OR NOT EXISTS (
    SELECT 1 FROM "issued_documents" d WHERE d."organizationId" = OLD."organizationId" AND d."docType" = OLD."docType"
  )) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'issued document numbering is append-only: % on % refused (MUT-568)', TG_OP, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER "issued_document_counters_guard" BEFORE UPDATE OR DELETE ON "issued_document_counters" FOR EACH ROW EXECUTE FUNCTION "issuing_counter_guard"();
CREATE TRIGGER "issued_document_counters_no_truncate" BEFORE TRUNCATE ON "issued_document_counters" FOR EACH STATEMENT EXECUTE FUNCTION "issuing_counter_guard"();
