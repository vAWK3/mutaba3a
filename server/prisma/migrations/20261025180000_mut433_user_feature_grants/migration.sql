-- MUT-433 (ADR-196): per-user feature flags, granted only by the operator (first: agent_access, epic MUT-432).
-- Additive: one table, its unique key, one index and the FK to users (ON DELETE CASCADE, so the MUT-333 purge takes
-- a person's rows with them). No backfill: every flag is off until granted.
--
-- Migrations are forward-only (DEPLOYMENT.md). To revert, ship a new migration:
--   DROP TABLE "user_feature_grants";
CREATE TABLE "user_feature_grants" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "feature" VARCHAR(64) NOT NULL,
    "grantedBy" VARCHAR(64) NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "user_feature_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_feature_grants_userId_feature_key" ON "user_feature_grants"("userId", "feature");

-- CreateIndex
CREATE INDEX "user_feature_grants_feature_idx" ON "user_feature_grants"("feature");

-- AddForeignKey
ALTER TABLE "user_feature_grants" ADD CONSTRAINT "user_feature_grants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
