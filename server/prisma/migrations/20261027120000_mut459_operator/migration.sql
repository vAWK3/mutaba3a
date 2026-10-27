-- MUT-459 (ADR-208): operators, their passkey step-up, and its challenge purpose.
-- The new enum value is only added here; nothing in this migration uses it, so one transaction is safe. The challenge
-- CHECK that uses it is the next migration (20261027120100).
ALTER TYPE "WebauthnChallengePurpose" ADD VALUE 'step_up';

ALTER TABLE "users" ADD COLUMN "operatorAt" TIMESTAMP(3);

ALTER TABLE "sessions" ADD COLUMN "stepUpAt" TIMESTAMP(3);
