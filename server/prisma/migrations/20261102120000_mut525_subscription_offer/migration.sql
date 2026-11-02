-- MUT-525: the launch offer a subscription's Checkout carried (Stripe metadata `mutaba3a_offer`), mirrored by the webhook.
-- Nullable, no default backfill: every existing subscription carried none.
ALTER TABLE "billing_subscriptions" ADD COLUMN "offerId" VARCHAR(40);
