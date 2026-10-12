-- MUT-65: personal hosted profiles accept income, clients and matters from the user.
-- Column-altering (not purely additive): payments.customerId and
-- receivables.projectId drop their NOT NULL constraint so "Received" can stand
-- alone with no client and "Owed" can stand alone with no matter. No existing
-- row is affected: every row written through the Malafat-fed paths (M2-M8)
-- already supplies both, and nothing here changes those paths.
-- Migrations are forward-only (DEPLOYMENT.md). To revert, ship a new migration:
--   ALTER TABLE "payments" DROP COLUMN "projectId", DROP COLUMN "createdByUserId", ALTER COLUMN "customerId" SET NOT NULL;
--   ALTER TABLE "receivables" DROP COLUMN "title", DROP COLUMN "createdByUserId", DROP COLUMN "deletedAt", ALTER COLUMN "projectId" SET NOT NULL;
-- (the revert is only safe if no row created after this migration actually
-- relies on a null customerId/projectId or the three new columns)

-- AlterTable: payments can stand alone with no client, and optionally carry a matter and its capturing user
ALTER TABLE "payments"
  ALTER COLUMN "customerId" DROP NOT NULL,
  ADD COLUMN "projectId" UUID,
  ADD COLUMN "createdByUserId" UUID;

-- CreateIndex
CREATE INDEX "payments_organizationId_projectId_idx" ON "payments"("organizationId", "projectId");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: "Owed" can stand alone with no matter; carries a free-text title, its capturing user, and a soft-delete for undo.
-- createdByUserId has no FK, matching this table's existing customerId/projectId/agreementId columns (no relation declared on any of them).
ALTER TABLE "receivables"
  ALTER COLUMN "projectId" DROP NOT NULL,
  ADD COLUMN "title" TEXT,
  ADD COLUMN "createdByUserId" UUID,
  ADD COLUMN "deletedAt" TIMESTAMP(3);
