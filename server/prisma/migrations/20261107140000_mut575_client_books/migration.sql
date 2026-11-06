-- MUT-575 (ADR-249): an accountant removes an ended client from their list. Additive: one nullable column, no
-- backfill (every existing grant reads null: still listed, as before), no index (reads use (accountantUserId, status)).
--
-- To revert, ship a new migration: ALTER TABLE "accountant_grants" DROP COLUMN "dismissedAt";

-- AlterTable
ALTER TABLE "accountant_grants" ADD COLUMN "dismissedAt" TIMESTAMP(3);
