-- MUT-560 (ADR-246): one-time share links to a period of one profile, with a PIN, no account needed. Additive: a new
-- enum, two tables and their indexes only.
--
-- To revert, ship a new migration: DROP TABLE "share_link_viewers"; DROP TABLE "share_links"; DROP TYPE "ShareLinkPeriod";

-- CreateEnum
CREATE TYPE "ShareLinkPeriod" AS ENUM ('LAST_1_MONTH', 'LAST_2_MONTHS', 'LAST_3_MONTHS', 'WHOLE_PROFILE');

-- CreateTable
CREATE TABLE "share_links" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "createdByUserId" UUID,
    "tokenDigest" VARCHAR(64) NOT NULL,
    "pinHash" TEXT NOT NULL,
    "period" "ShareLinkPeriod" NOT NULL,
    "periodFrom" VARCHAR(10),
    "periodTo" VARCHAR(10) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "failedPinAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastOpenedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "share_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_link_viewers" (
    "id" UUID NOT NULL,
    "shareLinkId" UUID NOT NULL,
    "tokenDigest" VARCHAR(64) NOT NULL,
    "accessExpiresAt" TIMESTAMP(3) NOT NULL,
    "lastViewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "share_link_viewers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "share_links_tokenDigest_key" ON "share_links"("tokenDigest");

-- CreateIndex
CREATE INDEX "share_links_organizationId_expiresAt_idx" ON "share_links"("organizationId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "share_link_viewers_tokenDigest_key" ON "share_link_viewers"("tokenDigest");

-- CreateIndex
CREATE INDEX "share_link_viewers_shareLinkId_idx" ON "share_link_viewers"("shareLinkId");

-- AddForeignKey
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_link_viewers" ADD CONSTRAINT "share_link_viewers_shareLinkId_fkey" FOREIGN KEY ("shareLinkId") REFERENCES "share_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

