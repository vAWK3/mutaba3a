-- MUT-182: users create and manage their own hosted profiles.
-- Additive: a new enum, three columns, two indexes, one foreign key and two CHECKs.
--
-- `ownerUserId` (not unique, up to MAX_OWNED_PROFILES per user) says who owns
-- and controls a profile; `personalOwnerUserId` (unique) stays the MUT-120
-- marker of the account's one built-in personal profile. Operator firms keep
-- NULL in both and NULL `profileType`, so nothing about them changes.
--
-- The backfill runs before the CHECKs, so every existing personal profile
-- satisfies them: it becomes owned by its user and typed PERSONAL.
-- `organizations_personal_owned_check` also locks the built-in profile to
-- PERSONAL (eng review D2): no code path can flip it to BUSINESS.
--
-- Migrations are forward-only (DEPLOYMENT.md). To revert, ship a new migration:
--   ALTER TABLE "organizations" DROP CONSTRAINT "organizations_personal_owned_check";
--   ALTER TABLE "organizations" DROP CONSTRAINT "organizations_owner_type_check";
--   ALTER TABLE "organizations" DROP CONSTRAINT "organizations_ownerUserId_fkey";
--   DROP INDEX "expenses_categoryId_idx";
--   DROP INDEX "organizations_ownerUserId_idx";
--   ALTER TABLE "organizations" DROP COLUMN "version", DROP COLUMN "profileType", DROP COLUMN "ownerUserId";
--   DROP TYPE "ProfileType";

-- CreateEnum
CREATE TYPE "ProfileType" AS ENUM ('PERSONAL', 'BUSINESS');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "ownerUserId" UUID,
ADD COLUMN     "profileType" "ProfileType",
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- Backfill: the MUT-120 personal profiles become owned, PERSONAL profiles.
UPDATE "organizations" SET "ownerUserId" = "personalOwnerUserId", "profileType" = 'PERSONAL' WHERE "personalOwnerUserId" IS NOT NULL;

-- CreateIndex
CREATE INDEX "organizations_ownerUserId_idx" ON "organizations"("ownerUserId");

-- CreateIndex: a type change hard-deletes categories (the first path that does), and each delete's ON DELETE SET NULL
-- looks expenses up by categoryId alone; the (organizationId, categoryId) index can't serve that.
CREATE INDEX "expenses_categoryId_idx" ON "expenses"("categoryId");

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- An owned profile always has a type, and only an owned one does.
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_owner_type_check" CHECK (("ownerUserId" IS NULL) = ("profileType" IS NULL));

-- The built-in personal profile, once stamped, is owned by its user and is always PERSONAL. "Once stamped" on purpose
-- (qa-reconcile D1): the old revision, serving between this migration and the roll or again after a rollback, still
-- inserts personal profiles with neither column; post-roll's repairPersonalOwnership stamps them, and until then
-- profileOwnerOf() reads personalOwnerUserId, so no guard treats them as firms.
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_personal_owned_check" CHECK ("personalOwnerUserId" IS NULL OR "ownerUserId" IS NULL OR ("ownerUserId" = "personalOwnerUserId" AND "profileType" = 'PERSONAL'));
