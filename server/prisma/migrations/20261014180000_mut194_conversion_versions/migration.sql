-- MUT-194 (ADR-075, superseding ADR-070 §2): conversions become editable (optimistic, on `version`)
-- and soft-deletable, like expenses. Existing rows start at version 1 with updatedAt = createdAt.

-- AlterTable
ALTER TABLE "conversions" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable: a temporary default fills existing rows; the backfill then sets each to its createdAt,
-- and the default is dropped so the column matches the schema (declared like Expense's, no default).
ALTER TABLE "conversions" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "conversions" SET "updatedAt" = "createdAt";
ALTER TABLE "conversions" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "conversions" ADD COLUMN "deletedAt" TIMESTAMP(3);
