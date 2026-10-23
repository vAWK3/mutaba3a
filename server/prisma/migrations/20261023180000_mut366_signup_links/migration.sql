-- MUT-366 (ADR-159, ADR-175): self-service signup links. A SIGNUP link is bound to an address, not a person: the
-- user is created when it is redeemed, so `userId` becomes nullable and the link carries the normalised address and
-- the signup page's language. `mailed` marks links sent by mail (signup, recovery); redeeming one verifies the
-- address (`users.emailVerifiedAt`). Additive: one enum value, four nullable/defaulted columns, an index and CHECKs
-- every existing row already satisfies (every existing link has a user and is SETUP or RESET).
--
-- The CHECKs compare `purpose::text`: Postgres refuses to use an enum value added in the same transaction.
--
-- Migrations are forward-only (DEPLOYMENT.md). To revert, ship a new migration that deletes the SIGNUP rows, drops
-- the CHECKs, the index and the four columns, and sets "userId" NOT NULL (the enum value can stay).

-- AlterEnum
ALTER TYPE "SetupLinkPurpose" ADD VALUE 'SIGNUP';

-- AlterTable
ALTER TABLE "users" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "account_setup_tokens" ALTER COLUMN "userId" DROP NOT NULL,
ADD COLUMN "email" TEXT,
ADD COLUMN "locale" VARCHAR(5),
ADD COLUMN "mailed" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "account_setup_tokens_email_idx" ON "account_setup_tokens"("email");

-- A SIGNUP link has no user and has an address and a language; every other link has a user and neither.
ALTER TABLE "account_setup_tokens" ADD CONSTRAINT "account_setup_tokens_signup_has_no_user"
  CHECK (("purpose"::text = 'SIGNUP') = ("userId" IS NULL));
ALTER TABLE "account_setup_tokens" ADD CONSTRAINT "account_setup_tokens_email_iff_no_user"
  CHECK (("userId" IS NULL) = ("email" IS NOT NULL));
ALTER TABLE "account_setup_tokens" ADD CONSTRAINT "account_setup_tokens_locale_iff_email"
  CHECK (("email" IS NULL) = ("locale" IS NULL));
