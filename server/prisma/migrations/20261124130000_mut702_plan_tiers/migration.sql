-- MUT-702 Part A (ADR-275): the Solo and Business plans join Freelancer (legacy), Firm and Accountant. Additive: no row
-- changes. Nothing uses the new values in this migration (Postgres refuses a new enum value inside the transaction that
-- adds it), so there is no follow-up.
--
-- To revert: no row may hold SOLO or BUSINESS; Postgres can't drop an enum value, so recreate the type without them.

-- AlterEnum
ALTER TYPE "BillingTier" ADD VALUE 'SOLO';
ALTER TYPE "BillingTier" ADD VALUE 'BUSINESS';
