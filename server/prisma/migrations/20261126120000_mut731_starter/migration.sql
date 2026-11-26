-- MUT-731 (ADR-284): the free Starter plan. Additive and nullable: nothing is backfilled, a rollback ignores them.
-- Everything Starter decides is derived at read time (billing/entitlement.ts), so STARTER_PLAN can go on and off.

-- Why and when Stripe ended a subscription's trial / the subscription (`cancellation_details.reason`, `trial_end`).
-- A null reason on a lapsed row reads as a deliberate cancel (read-only, today's behaviour) until the reconcile fills it.
ALTER TABLE "billing_subscriptions" ADD COLUMN "endedReason" VARCHAR(32);
ALTER TABLE "billing_subscriptions" ADD COLUMN "trialEnd" TIMESTAMP(3);

-- When the person chose "Continue free on Starter" after a cancel (or MUT-734's downgrade scheduled it).
ALTER TABLE "users" ADD COLUMN "starterChosenAt" TIMESTAMP(3);
-- The businesses the person keeps active when they own more than their plan allows (Basel, Q5: they must pick).
ALTER TABLE "users" ADD COLUMN "activeBusinessIds" UUID[];
-- The one-time 14-day Solo trial (Basel, Q7): when the web onboarding step was shown, and when a trial started.
ALTER TABLE "users" ADD COLUMN "paidTrialOfferedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "paidTrialUsedAt" TIMESTAMP(3);
