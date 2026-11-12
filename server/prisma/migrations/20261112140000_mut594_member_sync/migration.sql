-- MUT-594 (ADR-254 D2, D3, D7): Malafat syncs a firm's members. A firm whose members come from Malafat is marked
-- (organizations.memberSyncAt), and each Malafat person in a firm is a seat (external_identities), linked to an
-- account at their first Sign in with Malafat (MUT-595). Additive only.

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "memberSyncAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "external_identities" (
    "id" UUID NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "tenantId" VARCHAR(255) NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "organizationId" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "malafatRole" VARCHAR(32) NOT NULL,
    "userId" UUID,
    "linkedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_identities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "external_identities_userId_idx" ON "external_identities"("userId");

-- CreateIndex
CREATE INDEX "external_identities_organizationId_idx" ON "external_identities"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "external_identities_provider_tenantId_subject_key" ON "external_identities"("provider", "tenantId", "subject");

-- AddForeignKey
ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

