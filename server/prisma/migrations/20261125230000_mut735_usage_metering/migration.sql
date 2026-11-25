-- MUT-735 (ADR-281): usage metering. Additive only: three new tables, and three nullable columns on users that only
-- MUT-733 will write (its over-cap gift, one per account). A rollback ignores all of it.
--
--   usage_events       the ledger, one row per metered action, idempotent on (kind, entityKey); kept 13 months.
--                      (subjectKey, month, kind) serves the per-person rollup; (month, kind) the per-plan totals.
--   usage_counters     (subjectKey, month, meter) → count, the hot counter a cap reads in O(1); kept 25 months.
--   route_usage_daily  requests per Jerusalem day × route template × plan × status class, no person; kept 90 days.
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "overCapGiftMeter" VARCHAR(16),
ADD COLUMN     "overCapGiftMonth" CHAR(7),
ADD COLUMN     "overCapGiftUsedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "usage_events" (
    "id" UUID NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "month" CHAR(7) NOT NULL,
    "subjectKey" VARCHAR(64) NOT NULL,
    "actorUserId" UUID,
    "organizationId" UUID,
    "kind" VARCHAR(40) NOT NULL,
    "detail" VARCHAR(40),
    "plan" VARCHAR(16) NOT NULL,
    "door" VARCHAR(16) NOT NULL,
    "entityKey" VARCHAR(200) NOT NULL,

    CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_counters" (
    "subjectKey" VARCHAR(64) NOT NULL,
    "month" CHAR(7) NOT NULL,
    "meter" VARCHAR(16) NOT NULL,
    "count" INTEGER NOT NULL,
    "plan" VARCHAR(16) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usage_counters_pkey" PRIMARY KEY ("subjectKey","month","meter")
);

-- CreateTable
CREATE TABLE "route_usage_daily" (
    "day" VARCHAR(10) NOT NULL,
    "routeKey" VARCHAR(200) NOT NULL,
    "plan" VARCHAR(16) NOT NULL,
    "statusClass" VARCHAR(3) NOT NULL,
    "count" INTEGER NOT NULL,
    "durationMsSum" BIGINT NOT NULL,
    "b0" INTEGER NOT NULL DEFAULT 0,
    "b1" INTEGER NOT NULL DEFAULT 0,
    "b2" INTEGER NOT NULL DEFAULT 0,
    "b3" INTEGER NOT NULL DEFAULT 0,
    "b4" INTEGER NOT NULL DEFAULT 0,
    "b5" INTEGER NOT NULL DEFAULT 0,
    "b6" INTEGER NOT NULL DEFAULT 0,
    "b7" INTEGER NOT NULL DEFAULT 0,
    "b8" INTEGER NOT NULL DEFAULT 0,
    "b9" INTEGER NOT NULL DEFAULT 0,
    "b10" INTEGER NOT NULL DEFAULT 0,
    "b11" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "route_usage_daily_pkey" PRIMARY KEY ("day","routeKey","plan","statusClass")
);

-- CreateIndex
CREATE INDEX "usage_events_subjectKey_month_kind_idx" ON "usage_events"("subjectKey", "month", "kind");

-- CreateIndex
CREATE INDEX "usage_events_month_kind_idx" ON "usage_events"("month", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "usage_events_kind_entityKey_key" ON "usage_events"("kind", "entityKey");

-- CreateIndex
CREATE INDEX "usage_counters_month_meter_idx" ON "usage_counters"("month", "meter");


-- Backfill (brief §3): this Asia/Jerusalem month's counters only, so the meters are true on release day. Events are not
-- backfilled: history starts at release. The payer is the profile's creator (or its personal owner), else the profile.
-- `plan` is 'none' until the payer's next counted action stamps the real one. Timestamps are stored as UTC.
WITH bounds AS (
  SELECT
    to_char(now() AT TIME ZONE 'Asia/Jerusalem', 'YYYY-MM') AS month,
    (date_trunc('month', now() AT TIME ZONE 'Asia/Jerusalem') AT TIME ZONE 'Asia/Jerusalem') AT TIME ZONE 'UTC' AS from_utc
),
payer AS (
  SELECT o."id", COALESCE('user:' || o."ownerUserId"::text, 'user:' || o."personalOwnerUserId"::text, 'org:' || o."id"::text) AS "subjectKey"
  FROM "organizations" o
),
documents AS (
  SELECT p."subjectKey", count(*)::int AS n
  FROM "issued_documents" d JOIN payer p ON p."id" = d."organizationId", bounds b
  WHERE d."issuedAt" >= b.from_utc
  GROUP BY p."subjectKey"
),
scans AS (
  SELECT p."subjectKey", count(*)::int AS n
  FROM "expense_receipts" r JOIN payer p ON p."id" = r."organizationId", bounds b
  WHERE r."status" = 'READY' AND r."completedAt" >= b.from_utc
  GROUP BY p."subjectKey"
)
INSERT INTO "usage_counters" ("subjectKey", "month", "meter", "count", "plan", "updatedAt")
SELECT x."subjectKey", b.month, x.meter, x.n, 'none', now() AT TIME ZONE 'UTC'
FROM (
  SELECT "subjectKey", 'DOCUMENTS' AS meter, n FROM documents
  UNION ALL
  SELECT "subjectKey", 'SCANS' AS meter, n FROM scans
) x, bounds b;
