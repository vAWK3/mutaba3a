-- MUT-254 (ADR-183): vendors per profile, saved automatically from any typed vendor. Additive: expenses keep their
-- free-text vendor; vendorId is linked by the server on every write and by the post-roll backfill
-- (scripts/backfill-vendors.ts) for existing rows and rows the previous revision writes during the roll.
-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "vendorId" UUID;

-- CreateTable
CREATE TABLE "vendors" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "canonicalName" TEXT NOT NULL,
    "registrationNo" TEXT,
    "registrationKey" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "lastCategoryId" UUID,
    "lastUsedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_names" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "vendorId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_names_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vendors_organizationId_lastUsedAt_idx" ON "vendors"("organizationId", "lastUsedAt" DESC);

-- CreateIndex
CREATE INDEX "vendors_lastCategoryId_idx" ON "vendors"("lastCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_organizationId_registrationKey_key" ON "vendors"("organizationId", "registrationKey");

-- CreateIndex
CREATE INDEX "vendor_names_vendorId_idx" ON "vendor_names"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_names_organizationId_nameKey_key" ON "vendor_names"("organizationId", "nameKey");

-- CreateIndex
CREATE INDEX "expenses_organizationId_vendorId_idx" ON "expenses"("organizationId", "vendorId");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_lastCategoryId_fkey" FOREIGN KEY ("lastCategoryId") REFERENCES "expense_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_names" ADD CONSTRAINT "vendor_names_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_names" ADD CONSTRAINT "vendor_names_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
