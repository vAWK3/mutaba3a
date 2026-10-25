-- MUT-434 (ADR-197): the OAuth 2.1 authorization server for MCP clients (epic MUT-432).
-- Additive: two enums and five tables (clients, authorization requests, grants, codes, tokens), their indexes and FKs.
-- Grants and decided requests cascade with their person (the MUT-333 purge takes them); codes and tokens cascade with
-- their grant; a grant restricts its client (OV5). No backfill: nobody has connected an agent yet.
--
-- Migrations are forward-only (DEPLOYMENT.md). To revert, ship a new migration:
--   DROP TABLE "oauth_tokens"; DROP TABLE "oauth_codes"; DROP TABLE "oauth_grants";
--   DROP TABLE "oauth_authorization_requests"; DROP TABLE "oauth_clients";
--   DROP TYPE "OAuthTokenKind"; DROP TYPE "OAuthClientKind";

-- CreateEnum
CREATE TYPE "OAuthClientKind" AS ENUM ('DCR', 'CIMD');

-- CreateEnum
CREATE TYPE "OAuthTokenKind" AS ENUM ('ACCESS', 'REFRESH');

-- CreateTable
CREATE TABLE "oauth_clients" (
    "id" VARCHAR(2048) NOT NULL,
    "kind" "OAuthClientKind" NOT NULL,
    "clientName" VARCHAR(100) NOT NULL,
    "redirectUris" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "metadataFetchedAt" TIMESTAMP(3),
    "metadataExpiresAt" TIMESTAMP(3),

    CONSTRAINT "oauth_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_authorization_requests" (
    "id" UUID NOT NULL,
    "clientId" VARCHAR(2048) NOT NULL,
    "redirectUri" VARCHAR(2048) NOT NULL,
    "codeChallenge" VARCHAR(64) NOT NULL,
    "scopes" TEXT[],
    "state" VARCHAR(500),
    "resource" VARCHAR(2048) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "userId" UUID,

    CONSTRAINT "oauth_authorization_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_grants" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "clientId" VARCHAR(2048) NOT NULL,
    "redirectUri" VARCHAR(2048) NOT NULL,
    "scopes" TEXT[],
    "resource" VARCHAR(2048) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" VARCHAR(32),

    CONSTRAINT "oauth_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_codes" (
    "id" UUID NOT NULL,
    "codeDigest" VARCHAR(64) NOT NULL,
    "grantId" UUID NOT NULL,
    "codeChallenge" VARCHAR(64) NOT NULL,
    "redirectUri" VARCHAR(2048) NOT NULL,
    "resource" VARCHAR(2048) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "oauth_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_tokens" (
    "id" UUID NOT NULL,
    "tokenDigest" VARCHAR(64) NOT NULL,
    "grantId" UUID NOT NULL,
    "kind" "OAuthTokenKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "rotatedAt" TIMESTAMP(3),
    "successorId" UUID,

    CONSTRAINT "oauth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "oauth_clients_createdAt_idx" ON "oauth_clients"("createdAt");

-- CreateIndex
CREATE INDEX "oauth_authorization_requests_expiresAt_idx" ON "oauth_authorization_requests"("expiresAt");

-- CreateIndex
CREATE INDEX "oauth_authorization_requests_userId_idx" ON "oauth_authorization_requests"("userId");

-- CreateIndex
CREATE INDEX "oauth_grants_userId_idx" ON "oauth_grants"("userId");

-- CreateIndex
CREATE INDEX "oauth_grants_clientId_idx" ON "oauth_grants"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_codes_codeDigest_key" ON "oauth_codes"("codeDigest");

-- CreateIndex
CREATE INDEX "oauth_codes_grantId_idx" ON "oauth_codes"("grantId");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_tokens_tokenDigest_key" ON "oauth_tokens"("tokenDigest");

-- CreateIndex
CREATE INDEX "oauth_tokens_grantId_idx" ON "oauth_tokens"("grantId");

-- AddForeignKey
ALTER TABLE "oauth_authorization_requests" ADD CONSTRAINT "oauth_authorization_requests_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauth_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_authorization_requests" ADD CONSTRAINT "oauth_authorization_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauth_clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_codes" ADD CONSTRAINT "oauth_codes_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "oauth_grants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "oauth_grants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
