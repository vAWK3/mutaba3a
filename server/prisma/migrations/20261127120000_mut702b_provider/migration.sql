-- MUT-702 Part B (ADR-288): each subscription records its payment provider and its seller. Barmajiyat sells every
-- subscription on Stripe (Basel, 2026-11-26), so every row, old and new, is stripe / barmajiyat. Additive only.
ALTER TABLE "billing_subscriptions" ADD COLUMN "provider" VARCHAR(16) NOT NULL DEFAULT 'stripe';
ALTER TABLE "billing_subscriptions" ADD COLUMN "seller" VARCHAR(16) NOT NULL DEFAULT 'barmajiyat';
