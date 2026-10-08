-- AlterEnum
ALTER TYPE "FinalMonth" ADD VALUE 'PRORATE';

-- AlterTable
ALTER TABLE "agreements" ADD COLUMN     "cancelEffectiveDate" VARCHAR(10);

-- AlterTable
ALTER TABLE "retainer_charges" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "retainer_versions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "agreementId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "effectiveMonth" VARCHAR(7) NOT NULL,
    "monthlyAmountMinor" BIGINT NOT NULL,
    "netMinor" BIGINT NOT NULL,
    "vatMinor" BIGINT NOT NULL,
    "grossMinor" BIGINT NOT NULL,
    "pricingBasis" "PricingBasis" NOT NULL,
    "vatTreatment" "VatTreatment" NOT NULL,
    "rateBasisPoints" INTEGER NOT NULL,
    "billingDay" INTEGER NOT NULL,
    "paymentTerms" "PaymentTerms" NOT NULL,
    "endMonth" VARCHAR(7),
    "reason" TEXT NOT NULL,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retainer_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "retainer_versions_agreementId_version_key" ON "retainer_versions"("agreementId", "version");

-- CreateIndex
CREATE INDEX "retainer_versions_organizationId_agreementId_idx" ON "retainer_versions"("organizationId", "agreementId");

-- AddForeignKey
ALTER TABLE "retainer_versions" ADD CONSTRAINT "retainer_versions_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
