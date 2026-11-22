-- MUT-711 (ADR-272): where an issued document's allocation number came from. API = requested by MTB3A (MUT-572);
-- MANUAL = requested by hand on the Tax Authority site and entered before issuing. Every number so far came from the API.
ALTER TABLE "issued_documents" ADD COLUMN "allocationSource" VARCHAR(8);
UPDATE "issued_documents" SET "allocationSource" = 'API' WHERE "allocationNumber" IS NOT NULL;
ALTER TABLE "issued_documents" ADD CONSTRAINT "issued_documents_allocation_source" CHECK (
  ("allocationNumber" IS NULL AND "allocationSource" IS NULL)
  OR ("allocationNumber" IS NOT NULL AND "allocationSource" IN ('API', 'MANUAL'))
);
