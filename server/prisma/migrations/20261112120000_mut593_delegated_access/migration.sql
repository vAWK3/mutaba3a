-- MUT-593 (ADR-254): Malafat acts as the person with a tenant-bound delegated token. A confidential OAuth client
-- (private_key_jwt against its JWKS), the tenant on each request and grant, single-use assertion ids, and the
-- operator's per-firm switch on the integration. Additive only: every existing row keeps its meaning.

-- AlterEnum
ALTER TYPE "OAuthClientKind" ADD VALUE 'CONFIDENTIAL';

-- AlterTable
ALTER TABLE "integrations" ADD COLUMN     "delegationEnabledAt" TIMESTAMP(3),
ADD COLUMN     "delegationEnabledBy" UUID;

-- AlterTable
ALTER TABLE "oauth_clients" ADD COLUMN     "allowedResources" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "disabledAt" TIMESTAMP(3),
ADD COLUMN     "jwksUri" VARCHAR(2048);

-- AlterTable
ALTER TABLE "oauth_authorization_requests" ADD COLUMN     "tenantId" VARCHAR(255);

-- AlterTable
ALTER TABLE "oauth_grants" ADD COLUMN     "tenantId" VARCHAR(255);

-- CreateTable
CREATE TABLE "oauth_client_assertions" (
    "id" UUID NOT NULL,
    "clientId" VARCHAR(2048) NOT NULL,
    "jti" VARCHAR(255) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_client_assertions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "oauth_client_assertions_expiresAt_idx" ON "oauth_client_assertions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_client_assertions_clientId_jti_key" ON "oauth_client_assertions"("clientId", "jti");

-- CreateIndex
CREATE INDEX "oauth_grants_tenantId_idx" ON "oauth_grants"("tenantId");

-- AddForeignKey
ALTER TABLE "oauth_client_assertions" ADD CONSTRAINT "oauth_client_assertions_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauth_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
