-- MUT-647: invoices issued elsewhere, attached to an Owed or a Received.
CREATE TABLE "external_invoices" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "entryKind" VARCHAR(8) NOT NULL,
    "entryId" UUID NOT NULL,
    "attachmentId" UUID NOT NULL,
    "number" VARCHAR(64) NOT NULL,
    "documentDate" VARCHAR(10) NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "external_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "external_invoices_organizationId_entryKind_entryId_idx" ON "external_invoices"("organizationId", "entryKind", "entryId");

-- One live invoice per entry (Prisma can't express a partial index; the schema diff ignores it).
CREATE UNIQUE INDEX "external_invoices_one_live_per_entry" ON "external_invoices"("organizationId", "entryKind", "entryId") WHERE "removedAt" IS NULL;
