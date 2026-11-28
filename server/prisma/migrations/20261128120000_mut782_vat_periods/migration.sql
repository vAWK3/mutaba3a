-- MUT-782 (ADR-343): VAT period per client profile, each period's reminder and its "all receipts sent" state.
-- Additive only: two enums and two new tables; no existing table or column changes, so old and new code run together.
-- Rollback: DROP TABLE "vat_period_records"; DROP TABLE "vat_period_settings"; DROP TYPE "VatPeriodState"; DROP TYPE "VatPeriodKind";

-- CreateEnum
CREATE TYPE "VatPeriodKind" AS ENUM ('MONTHLY', 'BIMONTHLY', 'YEARLY', 'NONE');

-- CreateEnum
CREATE TYPE "VatPeriodState" AS ENUM ('OPEN', 'CLIENT_DONE', 'CONFIRMED', 'MORE_NEEDED');

-- CreateTable
CREATE TABLE "vat_period_settings" (
    "organizationId" UUID NOT NULL,
    "kind" "VatPeriodKind" NOT NULL,
    "setByUserId" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vat_period_settings_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "vat_period_records" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "periodKey" VARCHAR(16) NOT NULL,
    "state" "VatPeriodState" NOT NULL DEFAULT 'OPEN',
    "announcedAt" TIMESTAMP(3) NOT NULL,
    "followUpDueAt" TIMESTAMP(3),
    "followUpSentAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "doneByUserId" UUID,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" UUID,
    "note" VARCHAR(200),

    CONSTRAINT "vat_period_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vat_period_records_state_followUpDueAt_idx" ON "vat_period_records"("state", "followUpDueAt");

-- CreateIndex
CREATE UNIQUE INDEX "vat_period_records_organizationId_periodKey_key" ON "vat_period_records"("organizationId", "periodKey");

-- AddForeignKey
ALTER TABLE "vat_period_settings" ADD CONSTRAINT "vat_period_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vat_period_records" ADD CONSTRAINT "vat_period_records_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
