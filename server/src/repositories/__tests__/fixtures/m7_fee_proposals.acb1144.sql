-- The ORIGINAL M7 migration as production applied it (commit acb1144, revision mutaba3a-api-00003-rvr, 2026-10-09).
-- M8 later edited 20261009120000_m7_fee_proposals in place; this copy rebuilds the production shape for the MUT-59 repair test.

-- CreateEnum
CREATE TYPE "FeeProposalStatus" AS ENUM ('PROPOSED', 'CLIENT_APPROVED', 'AGREED', 'CONVERTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "fee_proposals" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "status" "FeeProposalStatus" NOT NULL DEFAULT 'PROPOSED',
    "pricingBasis" "PricingBasis" NOT NULL,
    "proposedAmountMinor" BIGINT NOT NULL,
    "proposedOn" VARCHAR(10) NOT NULL,
    "note" TEXT,
    "clientApprovedOn" VARCHAR(10),
    "clientApprovalNote" TEXT,
    "agreedAmountMinor" BIGINT,
    "agreedOn" VARCHAR(10),
    "agreedNote" TEXT,
    "withdrawnAt" TIMESTAMP(3),
    "withdrawnReason" TEXT,
    "agreementId" UUID,
    "requestId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fee_proposals_agreementId_key" ON "fee_proposals"("agreementId");

-- CreateIndex
CREATE INDEX "fee_proposals_organizationId_projectId_idx" ON "fee_proposals"("organizationId", "projectId");

-- CreateIndex
CREATE INDEX "fee_proposals_organizationId_customerId_idx" ON "fee_proposals"("organizationId", "customerId");

-- CreateIndex
CREATE INDEX "fee_proposals_organizationId_createdAt_id_idx" ON "fee_proposals"("organizationId", "createdAt", "id");

-- AddForeignKey
ALTER TABLE "fee_proposals" ADD CONSTRAINT "fee_proposals_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
