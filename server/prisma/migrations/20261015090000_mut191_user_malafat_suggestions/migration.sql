-- MUT-191: a person's Malafat suggestion preferences (epic MUT-189, ADR-078).
-- Additive: one nullable JSONB column. NULL reads as "on, nothing dismissed".
-- Shape `{ "off": boolean, "dismissed": ["business-profile" | "client-threshold" | "second-business"] }`,
-- validated by the API; dismissals only ever grow (PATCH /v1/me/malafat-suggestions unions under a row lock).
ALTER TABLE "users" ADD COLUMN "malafatSuggestions" JSONB;
