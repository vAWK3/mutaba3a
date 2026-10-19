-- MUT-270: GET /v1/entries reads each organization's expenses, conversions and Owed (ADJUSTMENT) receivables
-- newest logged first, limit + 1 rows at a time. Expenses and conversions were indexed by occurredOn only, and
-- receivables by (organizationId, createdAt, id) with every origin mixed in; these keep each query an index range
-- scan. Payments keep their existing (organizationId, createdAt, id), read backwards. Indexes only: no data change.
CREATE INDEX "expenses_organizationId_createdAt_id_idx" ON "expenses"("organizationId", "createdAt" DESC, "id" DESC);
CREATE INDEX "conversions_organizationId_createdAt_id_idx" ON "conversions"("organizationId", "createdAt" DESC, "id" DESC);
CREATE INDEX "receivables_organizationId_origin_createdAt_id_idx" ON "receivables"("organizationId", "origin", "createdAt", "id");
