-- MUT-478 (ADR-216): every receivable gets a number, CHG-YYYY-NNNN, gap-free per
-- organization and year of its postingDate, like payments' PAY-YYYY-NNNN.
-- Existing receivables are numbered in (postingDate, postedAt, id) order, the
-- same order the portal's local mode uses (payments/numbering.ts
-- backfillReceivableNumbers), and each counter resumes after its last number.

-- CreateTable
CREATE TABLE "receivable_counters" (
    "organizationId" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "next" INTEGER NOT NULL,

    CONSTRAINT "receivable_counters_pkey" PRIMARY KEY ("organizationId","year")
);

-- AlterTable: nullable for the backfill, NOT NULL once every row has one.
ALTER TABLE "receivables" ADD COLUMN "number" TEXT;

-- Backfill (soft-deleted rows too: a number is never reused).
WITH numbered AS (
    SELECT
        "id",
        CAST(left("postingDate", 4) AS INTEGER) AS "year",
        ROW_NUMBER() OVER (PARTITION BY "organizationId", left("postingDate", 4) ORDER BY "postingDate", "postedAt", "id") AS "seq"
    FROM "receivables"
)
UPDATE "receivables" AS r
SET "number" = 'CHG-' || n."year" || '-' || CASE WHEN n."seq" < 10000 THEN lpad(n."seq"::TEXT, 4, '0') ELSE n."seq"::TEXT END
FROM numbered AS n
WHERE r."id" = n."id";

INSERT INTO "receivable_counters" ("organizationId", "year", "next")
SELECT "organizationId", CAST(left("postingDate", 4) AS INTEGER), COUNT(*)
FROM "receivables"
GROUP BY "organizationId", left("postingDate", 4);

ALTER TABLE "receivables" ALTER COLUMN "number" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "receivables_organizationId_number_key" ON "receivables"("organizationId", "number");
