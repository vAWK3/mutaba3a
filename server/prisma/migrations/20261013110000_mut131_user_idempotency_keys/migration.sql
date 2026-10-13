-- MUT-131: user-scoped idempotency, for the organization-independent inbox
-- create (POST /v1/inbox has no organization to key idempotency_keys against —
-- the same reason inbox_entries itself has no organizationId, MUT-66).
--
-- Purely additive: a new table, same shape as idempotency_keys, keyed by
-- userId instead of organizationId. No existing table, column or constraint
-- is touched, so every row written before this migration is unaffected.
--
-- Migrations are forward-only (DEPLOYMENT.md). To revert, ship a new migration:
--   DROP TABLE "user_idempotency_keys";

-- CreateTable
CREATE TABLE "user_idempotency_keys" (
    "userId" UUID NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "operation" TEXT NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "status" "IdempotencyStatus" NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "user_idempotency_keys_pkey" PRIMARY KEY ("userId","key")
);

-- CreateIndex
CREATE INDEX "user_idempotency_keys_createdAt_idx" ON "user_idempotency_keys"("createdAt");

-- AddForeignKey
ALTER TABLE "user_idempotency_keys" ADD CONSTRAINT "user_idempotency_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
