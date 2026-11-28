-- MUT-777 (ADR-333): the pilot tester's one yes to watched and recorded sessions, with its instant, on the person.
-- Additive only: one nullable column that every existing row reads as NULL (not asked), so old and new code run together.
-- Rollback: ALTER TABLE "users" DROP COLUMN "pilotWatchConsentAt";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "pilotWatchConsentAt" TIMESTAMP(3);
