-- MUT-370 (D1): the "Add a passkey" suggestion's state, as JSON on the person's user row (the MUT-418 trialPrompt
-- pattern). NULL = never answered. Additive and nullable: no backfill, no lock beyond the catalog change.
ALTER TABLE "users" ADD COLUMN "passkeyPrompt" JSONB;
