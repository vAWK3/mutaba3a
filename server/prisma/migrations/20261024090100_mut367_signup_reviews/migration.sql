-- MUT-367 (ADR-159 §7a, ADR-178): the signup screen's verdict on the SIGNUP token, and the operator's review queue.
-- Additive: two enums, two nullable/defaulted token columns with a CHECK every existing row satisfies, one table.
--
-- Forward-only (DEPLOYMENT.md). To revert, ship a migration that drops "signup_reviews", the CHECK and the two
-- token columns, and the two enums; first approve or decline every pending review (no PENDING_REVIEW user remains).

-- CreateEnum
CREATE TYPE "EmailDomainClass" AS ENUM ('BUSINESS', 'BUSINESS_UNVERIFIED', 'WEBMAIL');

-- CreateEnum
CREATE TYPE "SignupReviewDecision" AS ENUM ('APPROVED', 'DECLINED');

-- AlterTable
ALTER TABLE "account_setup_tokens" ADD COLUMN "domainClass" "EmailDomainClass",
ADD COLUMN "domainReasons" TEXT[];

-- Only a SIGNUP link carries the screen's verdict.
ALTER TABLE "account_setup_tokens" ADD CONSTRAINT "account_setup_tokens_domain_class_signup_only"
  CHECK ("domainClass" IS NULL OR "purpose"::text = 'SIGNUP');

-- CreateTable
CREATE TABLE "signup_reviews" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "domain" VARCHAR(253) NOT NULL,
    "classification" "EmailDomainClass" NOT NULL,
    "reasons" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL,
    "notifiedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decision" "SignupReviewDecision",
    "decidedBy" VARCHAR(64),

    CONSTRAINT "signup_reviews_pkey" PRIMARY KEY ("id"),
    -- A decision and its time come together.
    CONSTRAINT "signup_reviews_decided_together" CHECK (("decision" IS NULL) = ("decidedAt" IS NULL)),
    -- An open review always names its person; only a decline unlinks one (the account is deleted).
    CONSTRAINT "signup_reviews_open_has_user" CHECK ("decision" IS NOT NULL OR "userId" IS NOT NULL)
);

-- CreateIndex
CREATE UNIQUE INDEX "signup_reviews_userId_key" ON "signup_reviews"("userId");

-- CreateIndex
CREATE INDEX "signup_reviews_createdAt_idx" ON "signup_reviews"("createdAt");

-- AddForeignKey
ALTER TABLE "signup_reviews" ADD CONSTRAINT "signup_reviews_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
