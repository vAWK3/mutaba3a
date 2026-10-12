-- MUT-66: the unsorted inbox — a capture that does not belong to a profile yet.
-- Purely additive: one enum, one table, one index. No existing table, column or
-- constraint is touched, so every row written before this migration is unaffected.
--
-- The table deliberately carries NO organizationId and no FK to organizations
-- or memberships. That absence is the feature: revoking a user's last
-- membership cannot cascade into their inbox, because there is no edge to
-- cascade along. A future edit that adds such a column would break the
-- ticket's "removing a user's last membership does not delete their inbox"
-- guarantee; a DMMF test guards against exactly that.
--
-- Migrations are forward-only (DEPLOYMENT.md). To revert, ship a new migration:
--   DROP TABLE "inbox_entries"; DROP TYPE "InboxEntryKind";

-- CreateEnum
CREATE TYPE "InboxEntryKind" AS ENUM ('INCOME', 'EXPENSE');

-- CreateTable
CREATE TABLE "inbox_entries" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "InboxEntryKind" NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "occurredOn" VARCHAR(10) NOT NULL,
    "note" TEXT,
    "captureSource" VARCHAR(20),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inbox_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: the one read path — this user's entries, newest first, keyset-paged.
CREATE INDEX "inbox_entries_userId_createdAt_id_idx" ON "inbox_entries"("userId", "createdAt" DESC, "id" DESC);

-- AddForeignKey
ALTER TABLE "inbox_entries" ADD CONSTRAINT "inbox_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
