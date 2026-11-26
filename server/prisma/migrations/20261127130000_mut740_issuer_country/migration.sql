-- MUT-740 (ADR-287 D1): the issuer's country, the jurisdiction whose invoicing rules the profile follows.
-- Additive: every existing row reads 'IL' (Israel, the only pack there is). Not null with a default, so a rollback past
-- this migration is harmless (the column can stay); the INSERT-only issuing tables are not touched.
ALTER TABLE "issuer_details" ADD COLUMN "country" VARCHAR(2) NOT NULL DEFAULT 'IL';
ALTER TABLE "issuer_details" ADD CONSTRAINT "issuer_details_country_iso" CHECK ("country" ~ '^[A-Z]{2}$');
