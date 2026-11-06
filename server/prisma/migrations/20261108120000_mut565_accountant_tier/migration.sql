-- MUT-565 (ADR-251): the Accountant plan reuses the billing tables with a new tier. Additive: no row changes.
-- Postgres refuses to use a new enum value in the transaction that adds it, so the grant CHECK is the next migration.
--
-- To revert: no row may hold ACCOUNTANT; Postgres can't drop an enum value, so recreate the type without it.

-- AlterEnum
ALTER TYPE "BillingTier" ADD VALUE 'ACCOUNTANT';
