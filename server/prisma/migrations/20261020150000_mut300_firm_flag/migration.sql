-- MUT-300: the firm switch (ADR-099, amended by the MUT-300 eng review D4/D6).
-- Additive: a new enum, one membership column, three organization columns, one foreign key and two CHECKs.
--
-- `firmEnabledAt` turns firm features on in place: an owned Business profile stays owned (D4), and an
-- operator firm keeps its NULL owner. `firmRequestedAt` / `firmRequestedByUserId` record an owner's
-- request until an operator enables or declines it. `memberships.role` is read only while firm features
-- are on; the OWNER default every existing membership gets is inert until then (O10), and enabling
-- always rewrites the roles of the organization it enables.
--
-- Migrations are forward-only (DEPLOYMENT.md). To revert, ship a new migration:
--   ALTER TABLE "organizations" DROP CONSTRAINT "organizations_firm_not_personal_check";
--   ALTER TABLE "organizations" DROP CONSTRAINT "organizations_firm_request_pair_check";
--   ALTER TABLE "organizations" DROP CONSTRAINT "organizations_firmRequestedByUserId_fkey";
--   ALTER TABLE "organizations" DROP COLUMN "firmRequestedByUserId", DROP COLUMN "firmRequestedAt", DROP COLUMN "firmEnabledAt";
--   ALTER TABLE "memberships" DROP COLUMN "role";
--   DROP TYPE "MembershipRole";

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('OWNER', 'BOOKKEEPER', 'SUBMITTER');

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "role" "MembershipRole" NOT NULL DEFAULT 'OWNER';

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "firmEnabledAt" TIMESTAMP(3),
ADD COLUMN     "firmRequestedAt" TIMESTAMP(3),
ADD COLUMN     "firmRequestedByUserId" UUID;

-- AddForeignKey (O8): RESTRICT like ownerUserId; SET NULL would break the pair CHECK below.
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_firmRequestedByUserId_fkey" FOREIGN KEY ("firmRequestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A request always names who made it, and only a request does.
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_firm_request_pair_check" CHECK (("firmRequestedAt" IS NULL) = ("firmRequestedByUserId" IS NULL));

-- The built-in personal profile never gets firm features (D4; covers an unstamped MUT-120 profile too, O9).
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_firm_not_personal_check" CHECK ("firmEnabledAt" IS NULL OR "personalOwnerUserId" IS NULL);
