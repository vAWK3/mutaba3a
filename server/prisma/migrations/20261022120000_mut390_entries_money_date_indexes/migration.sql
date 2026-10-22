-- MUT-390: GET /v1/entries?order=occurredOn reads each organization's expenses, payments, Owed (ADJUSTMENT)
-- receivables and conversions newest money day first, then newest logged, limit + 1 rows at a time. Each kind's own
-- money date leads its index (expenses and conversions occurredOn, payments receivedOn, receivables postingDate after
-- origin), so every query stays an index range scan. The ledger's (organizationId, occurredOn, id) indexes stay: they
-- carry no createdAt. Indexes only: no data change.
CREATE INDEX "expenses_organizationId_occurredOn_createdAt_id_idx" ON "expenses"("organizationId", "occurredOn" DESC, "createdAt" DESC, "id" DESC);
CREATE INDEX "conversions_organizationId_occurredOn_createdAt_id_idx" ON "conversions"("organizationId", "occurredOn" DESC, "createdAt" DESC, "id" DESC);
CREATE INDEX "payments_organizationId_receivedOn_createdAt_id_idx" ON "payments"("organizationId", "receivedOn" DESC, "createdAt" DESC, "id" DESC);
CREATE INDEX "receivables_organizationId_origin_postingDate_createdAt_id_idx" ON "receivables"("organizationId", "origin", "postingDate" DESC, "createdAt" DESC, "id" DESC);
