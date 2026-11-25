-- MUT-644 (ADR-277 D5): the retention log of closed profiles' issued documents (sweeps and exported archives).
-- No foreign key: the profile is already gone. Additive only.
CREATE TABLE "issuing_retention_events" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "action" VARCHAR(32) NOT NULL,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "issuing_retention_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "issuing_retention_events_organizationId_createdAt_idx" ON "issuing_retention_events"("organizationId", "createdAt");
