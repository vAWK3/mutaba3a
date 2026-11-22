-- MUT-711 (ADR-272): where an issued document's allocation number came from. API = requested by MTB3A (MUT-572);
-- MANUAL = requested by hand on the Tax Authority site and entered before issuing. Issued documents are immutable
-- (MUT-568), so the rows issued before this column stay NULL: a number with no source reads as API, the only source
-- there was. A source never stands without a number.
ALTER TABLE "issued_documents" ADD COLUMN "allocationSource" VARCHAR(8);
ALTER TABLE "issued_documents" ADD CONSTRAINT "issued_documents_allocation_source" CHECK (
  "allocationSource" IS NULL OR ("allocationNumber" IS NOT NULL AND "allocationSource" IN ('API', 'MANUAL'))
);
