-- MUT-752 (ADR-296): the pilot marker on operator grants and the pilot Welcome on the person.
-- Additive only: three nullable columns, one foreign key and two CHECKs that every existing row passes (cohort is
-- NULL on all of them), so old and new code run together.
-- Rollback: ALTER TABLE "entitlement_grants" DROP CONSTRAINT "entitlement_grants_pilot_expiry_check",
--   DROP CONSTRAINT "entitlement_grants_pilot_referral_check", DROP CONSTRAINT "entitlement_grants_referredByUserId_fkey",
--   DROP COLUMN "referredByUserId", DROP COLUMN "cohort"; ALTER TABLE "users" DROP COLUMN "pilotWelcomeSeenAt";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "pilotWelcomeSeenAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "entitlement_grants" ADD COLUMN     "cohort" VARCHAR(64),
ADD COLUMN     "referredByUserId" UUID;

-- A pilot always ends; a referring accountant is named only on a pilot.
ALTER TABLE "entitlement_grants"
  ADD CONSTRAINT "entitlement_grants_pilot_expiry_check" CHECK ("cohort" IS NULL OR "expiresAt" IS NOT NULL),
  ADD CONSTRAINT "entitlement_grants_pilot_referral_check" CHECK ("referredByUserId" IS NULL OR "cohort" IS NOT NULL);

-- AddForeignKey
ALTER TABLE "entitlement_grants" ADD CONSTRAINT "entitlement_grants_referredByUserId_fkey" FOREIGN KEY ("referredByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
