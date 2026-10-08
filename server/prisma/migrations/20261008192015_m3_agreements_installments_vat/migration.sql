-- CreateEnum
CREATE TYPE "VatTreatment" AS ENUM ('STANDARD_RATED', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE');

-- CreateEnum
CREATE TYPE "PricingBasis" AS ENUM ('VAT_EXCLUSIVE', 'VAT_INCLUSIVE');

-- CreateEnum
CREATE TYPE "AgreementType" AS ENUM ('FIXED', 'RECURRING');

-- CreateEnum
CREATE TYPE "AgreementStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TriggerType" AS ENUM ('IMMEDIATE', 'DATE', 'MANUAL');

-- CreateEnum
CREATE TYPE "PaymentTerms" AS ENUM ('IMMEDIATE', 'EOM', 'EOM_15', 'EOM_30', 'EOM_45', 'EOM_60');

-- CreateEnum
CREATE TYPE "ReceivableOrigin" AS ENUM ('INSTALLMENT', 'RETAINER_CHARGE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "ReceivableStatus" AS ENUM ('OPEN', 'SETTLED');

-- CreateEnum
CREATE TYPE "FinalMonth" AS ENUM ('FULL', 'WAIVE');

-- CreateEnum
CREATE TYPE "SupplementDistribution" AS ENUM ('LAST_UNPOSTED', 'PRORATE_UNPOSTED', 'NEW_INSTALLMENT');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "vatTreatment" "VatTreatment";

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "vatTreatment" "VatTreatment";

-- CreateTable
CREATE TABLE "vat_rates" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "rateBasisPoints" INTEGER NOT NULL,
    "effectiveFrom" VARCHAR(10) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vat_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agreements" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "type" "AgreementType" NOT NULL,
    "status" "AgreementStatus" NOT NULL DEFAULT 'ACTIVE',
    "currency" VARCHAR(3) NOT NULL,
    "pricingBasis" "PricingBasis" NOT NULL,
    "vatTreatment" "VatTreatment" NOT NULL,
    "vatRateBasisPoints" INTEGER NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "netMinor" BIGINT NOT NULL,
    "vatMinor" BIGINT NOT NULL,
    "grossMinor" BIGINT NOT NULL,
    "agreementDate" VARCHAR(10) NOT NULL,
    "description" TEXT,
    "paymentTerms" "PaymentTerms" NOT NULL DEFAULT 'EOM',
    "startMonth" VARCHAR(7),
    "billingDay" INTEGER,
    "endMonth" VARCHAR(7),
    "cancelEffectiveMonth" VARCHAR(7),
    "finalMonth" "FinalMonth",
    "cancelledAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installments" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "agreementId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "netMinor" BIGINT NOT NULL,
    "vatMinor" BIGINT NOT NULL,
    "grossMinor" BIGINT NOT NULL,
    "vatTreatment" "VatTreatment" NOT NULL,
    "rateBasisPoints" INTEGER NOT NULL,
    "triggerType" "TriggerType" NOT NULL,
    "triggerDate" VARCHAR(10),
    "paymentTerms" "PaymentTerms",
    "dueDateOverride" VARCHAR(10),
    "postedAt" TIMESTAMP(3),
    "postingDate" VARCHAR(10),
    "receivableId" UUID,
    "voidedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retainer_charges" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "agreementId" UUID NOT NULL,
    "serviceMonth" VARCHAR(7) NOT NULL,
    "chargeDate" VARCHAR(10) NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "netMinor" BIGINT NOT NULL,
    "vatMinor" BIGINT NOT NULL,
    "grossMinor" BIGINT NOT NULL,
    "vatTreatment" "VatTreatment" NOT NULL,
    "rateBasisPoints" INTEGER NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "receivableId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retainer_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receivables" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "agreementId" UUID,
    "origin" "ReceivableOrigin" NOT NULL,
    "originId" UUID,
    "currency" VARCHAR(3) NOT NULL,
    "netMinor" BIGINT NOT NULL,
    "vatMinor" BIGINT NOT NULL,
    "grossMinor" BIGINT NOT NULL,
    "vatTreatment" "VatTreatment" NOT NULL,
    "vatRateBasisPoints" INTEGER NOT NULL,
    "paidMinor" BIGINT NOT NULL DEFAULT 0,
    "dueDate" VARCHAR(10) NOT NULL,
    "postingDate" VARCHAR(10) NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "status" "ReceivableStatus" NOT NULL DEFAULT 'OPEN',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receivables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agreement_supplements" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "agreementId" UUID NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "description" TEXT,
    "effectiveDate" VARCHAR(10) NOT NULL,
    "distribution" "SupplementDistribution" NOT NULL,
    "resultingAmountMinor" BIGINT NOT NULL,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agreement_supplements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vat_rates_organizationId_effectiveFrom_key" ON "vat_rates"("organizationId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "agreements_organizationId_projectId_idx" ON "agreements"("organizationId", "projectId");

-- CreateIndex
CREATE INDEX "agreements_organizationId_customerId_idx" ON "agreements"("organizationId", "customerId");

-- CreateIndex
CREATE INDEX "agreements_organizationId_createdAt_id_idx" ON "agreements"("organizationId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "installments_receivableId_key" ON "installments"("receivableId");

-- CreateIndex
CREATE INDEX "installments_organizationId_triggerType_triggerDate_idx" ON "installments"("organizationId", "triggerType", "triggerDate");

-- CreateIndex
CREATE UNIQUE INDEX "installments_agreementId_position_key" ON "installments"("agreementId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "retainer_charges_receivableId_key" ON "retainer_charges"("receivableId");

-- CreateIndex
CREATE UNIQUE INDEX "retainer_charges_agreementId_serviceMonth_key" ON "retainer_charges"("agreementId", "serviceMonth");

-- CreateIndex
CREATE INDEX "receivables_organizationId_customerId_idx" ON "receivables"("organizationId", "customerId");

-- CreateIndex
CREATE INDEX "receivables_organizationId_projectId_idx" ON "receivables"("organizationId", "projectId");

-- CreateIndex
CREATE INDEX "receivables_organizationId_dueDate_idx" ON "receivables"("organizationId", "dueDate");

-- CreateIndex
CREATE INDEX "receivables_organizationId_createdAt_id_idx" ON "receivables"("organizationId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "agreement_supplements_agreementId_createdAt_idx" ON "agreement_supplements"("agreementId", "createdAt");

-- AddForeignKey
ALTER TABLE "vat_rates" ADD CONSTRAINT "vat_rates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installments" ADD CONSTRAINT "installments_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retainer_charges" ADD CONSTRAINT "retainer_charges_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreement_supplements" ADD CONSTRAINT "agreement_supplements_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
