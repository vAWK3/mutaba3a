-- MUT-640: a produced copy remembers the request that produced it, so a retried download gets the same copy and mark.
-- Copies are INSERT-only (MUT-568 trigger); adding a nullable column changes no row.
ALTER TABLE "issued_document_copies" ADD COLUMN "requestKey" VARCHAR(128);
CREATE UNIQUE INDEX "issued_document_copies_documentId_requestKey_key" ON "issued_document_copies"("documentId", "requestKey");
