-- MUT-709: one payment per recording request. Additive: a nullable column and a unique index (NULLs never collide).
ALTER TABLE "payments" ADD COLUMN "clientRequestKey" VARCHAR(64);

CREATE UNIQUE INDEX "payments_organizationId_clientRequestKey_key" ON "payments"("organizationId", "clientRequestKey");
