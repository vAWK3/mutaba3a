-- MUT-478 (ADR-217): every receivable gets a number, CHG-YYYY-NNNN, gap-free per
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

-- Rolling deploy (PATTERNS "never a CHECK the previous image can't satisfy"): migrations run before the roll, and
-- the previous revision inserts receivables without a number. This trigger numbers any such row from the same
-- counter the new revision takes inside its posting transaction, so the NOT NULL below never refuses the old image
-- and no receivable is ever left unnumbered. The new revision always sends a number, so the trigger stands down.
-- Dropped by a later migration once every serving revision numbers receivables itself (TD-272).
CREATE FUNCTION "receivables_assign_number"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    y INTEGER;
    n INTEGER;
BEGIN
    IF NEW."number" IS NOT NULL THEN
        RETURN NEW;
    END IF;
    y := CAST(left(NEW."postingDate", 4) AS INTEGER);
    INSERT INTO "receivable_counters" ("organizationId", "year", "next") VALUES (NEW."organizationId", y, 1)
    ON CONFLICT ("organizationId", "year") DO UPDATE SET "next" = "receivable_counters"."next" + 1
    RETURNING "next" INTO n;
    NEW."number" := 'CHG-' || y || '-' || CASE WHEN n < 10000 THEN lpad(n::TEXT, 4, '0') ELSE n::TEXT END;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "receivables_assign_number" BEFORE INSERT ON "receivables" FOR EACH ROW EXECUTE FUNCTION "receivables_assign_number"();

ALTER TABLE "receivables" ALTER COLUMN "number" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "receivables_organizationId_number_key" ON "receivables"("organizationId", "number");
