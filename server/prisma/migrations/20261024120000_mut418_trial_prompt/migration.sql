-- MUT-418 (D1, D2): the person's answers to the free trial's card prompt, as JSON on their user row (the MUT-191
-- malafatSuggestions pattern). NULL = nothing answered yet. Additive and nullable: no backfill, no lock beyond the
-- catalog change.
ALTER TABLE "users" ADD COLUMN "trialPrompt" JSONB;
