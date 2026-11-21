-- MUT-535 (D6): the monthly summary mail choice: 'OFF' | 'ON_ALL'; NULL = the default (on, without the profiles
-- Malafat covers). Existing accounts: NULL. Additive.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "monthlySummaryMail" VARCHAR(8);
