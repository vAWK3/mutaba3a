-- MUT-559 (ADR-245): an owner shares one profile, read-only, with an accountant. A table of its own, never a
-- Membership, so every membership reader stays default-deny. Additive: a new enum, table and indexes only.
--
-- To revert, ship a new migration: DROP TABLE "accountant_grants"; DROP TYPE "AccountantGrantStatus";

-- CreateEnum
CREATE TYPE "AccountantGrantStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED', 'LEFT');

-- CreateTable
CREATE TABLE "accountant_grants" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "inviteEmail" TEXT NOT NULL,
    "locale" VARCHAR(5) NOT NULL,
    "invitedByUserId" UUID,
    "accountantUserId" UUID,
    "status" "AccountantGrantStatus" NOT NULL DEFAULT 'PENDING',
    "tokenDigest" VARCHAR(64),
    "inviteExpiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastViewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accountant_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accountant_grants_tokenDigest_key" ON "accountant_grants"("tokenDigest");

-- CreateIndex
CREATE INDEX "accountant_grants_organizationId_idx" ON "accountant_grants"("organizationId");

-- CreateIndex
CREATE INDEX "accountant_grants_accountantUserId_status_idx" ON "accountant_grants"("accountantUserId", "status");

-- AddForeignKey
ALTER TABLE "accountant_grants" ADD CONSTRAINT "accountant_grants_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accountant_grants" ADD CONSTRAINT "accountant_grants_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accountant_grants" ADD CONSTRAINT "accountant_grants_accountantUserId_fkey" FOREIGN KEY ("accountantUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One live invite per profile and address: a second PENDING/ACTIVE grant for the same address answers 409
-- ALREADY_INVITED (an expired PENDING one is ended in the invite's transaction first, so it never blocks a re-invite).
CREATE UNIQUE INDEX "accountant_grants_one_live_invite" ON "accountant_grants"("organizationId", lower("inviteEmail")) WHERE "status" IN ('PENDING', 'ACTIVE');

-- One ACTIVE grant per profile and accountant (two invites to two of their addresses can't both be accepted). Ended
-- grants keep their accountantUserId as history, so this is partial, not a plain unique key.
CREATE UNIQUE INDEX "accountant_grants_one_active_per_accountant" ON "accountant_grants"("organizationId", "accountantUserId") WHERE "status" = 'ACTIVE';
