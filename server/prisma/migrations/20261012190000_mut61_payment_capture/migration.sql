-- MUT-61: a payment says who put it on the ledger, so Malafat can find phone captures it still has to allocate.

-- CreateEnum
CREATE TYPE "PaymentOrigin" AS ENUM ('INTEGRATION', 'CAPTURE');

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "captureSource" VARCHAR(20),
ADD COLUMN     "origin" "PaymentOrigin" NOT NULL DEFAULT 'INTEGRATION';

-- Backfill: every payment a person captured before this migration (MUT-65 income, MUT-66 inbox filing) carries
-- its creator; Malafat-fed payments never do. captureSource stays null for these — it lived in audit metadata only.
UPDATE "payments" SET "origin" = 'CAPTURE' WHERE "createdByUserId" IS NOT NULL;
