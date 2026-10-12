-- MUT-120: every user gets exactly one personal profile, created with the account.
-- Purely additive: one nullable column, one unique index, one foreign key. Every
-- existing organization keeps NULL (a firm), and Postgres allows any number of
-- NULLs under a UNIQUE index, so no existing row or reader is affected.
--
-- The unique index IS the "one personal profile per user" guarantee: a second
-- organization naming the same owner fails here, whatever the application does.
-- ON DELETE RESTRICT: users are disabled, never deleted (ADR-037), so a delete
-- that would orphan a personal organization is refused rather than cascaded.
--
-- Migrations are forward-only (DEPLOYMENT.md). To revert, ship a new migration:
--   ALTER TABLE "organizations" DROP CONSTRAINT "organizations_personalOwnerUserId_fkey";
--   DROP INDEX "organizations_personalOwnerUserId_key";
--   ALTER TABLE "organizations" DROP COLUMN "personalOwnerUserId";

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "personalOwnerUserId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "organizations_personalOwnerUserId_key" ON "organizations"("personalOwnerUserId");

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_personalOwnerUserId_fkey" FOREIGN KEY ("personalOwnerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
