-- ADR-278 (the legal pages rewrite): a person's opt-out from promotional mail (the come-back offer).
-- 'OFF' once they opted out; NULL is the default (on). Additive and nullable: a rollback ignores it.
ALTER TABLE "users" ADD COLUMN "offerMail" VARCHAR(8);
