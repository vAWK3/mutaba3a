-- MUT-441: the server reads receipts. Additive: two enums, seven columns with defaults (every existing row reads as
-- NONE / PHOTO, never asked), and one partial index the read sweep scans. A revision that predates this inserts
-- without the columns during a rolling deploy and gets the defaults.
--
-- `readFailReason` holds a code only (`unreadable`, `timeout`, `exhausted`), never receipt text.
--
-- Migrations are forward-only (DEPLOYMENT.md). To revert, ship a new migration:
--   DROP INDEX "expense_receipts_read_pending_idx";
--   ALTER TABLE "expense_receipts" DROP COLUMN "captureHint", DROP COLUMN "readAttempts", DROP COLUMN "readFailReason",
--     DROP COLUMN "readLeaseUntil", DROP COLUMN "readRequestedAt", DROP COLUMN "readFirstClaimedAt", DROP COLUMN "readStatus";
--   DROP TYPE "ReceiptCaptureHint";
--   DROP TYPE "ReceiptReadStatus";

-- CreateEnum
CREATE TYPE "ReceiptReadStatus" AS ENUM ('NONE', 'PENDING', 'DONE', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ReceiptCaptureHint" AS ENUM ('SCANNED', 'PHOTO');

-- AlterTable
ALTER TABLE "expense_receipts" ADD COLUMN     "captureHint" "ReceiptCaptureHint" NOT NULL DEFAULT 'PHOTO',
ADD COLUMN     "readAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "readFailReason" VARCHAR(40),
ADD COLUMN     "readLeaseUntil" TIMESTAMP(3),
ADD COLUMN     "readRequestedAt" TIMESTAMP(3),
ADD COLUMN     "readFirstClaimedAt" TIMESTAMP(3),
ADD COLUMN     "readStatus" "ReceiptReadStatus" NOT NULL DEFAULT 'NONE';

-- The read sweep: PENDING receipts whose lease has expired or was never taken. Partial, so it stays as small as the
-- queue (not in schema.prisma, which can't express a partial index; as users_deleteAfter_idx, MUT-333).
CREATE INDEX "expense_receipts_read_pending_idx" ON "expense_receipts"("readStatus", "readLeaseUntil") WHERE "readStatus" = 'PENDING';
