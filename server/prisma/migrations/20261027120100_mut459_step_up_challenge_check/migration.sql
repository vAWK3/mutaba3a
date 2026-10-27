-- MUT-459 (ADR-208): a step_up challenge names its person, like a creation one; only a sign-in challenge names no one.
-- Its own migration: a CHECK can't use an enum value added in the same transaction (the MUT-367 D29 rule).
ALTER TABLE "webauthn_challenges" DROP CONSTRAINT "webauthn_challenges_user_check";
ALTER TABLE "webauthn_challenges" ADD CONSTRAINT "webauthn_challenges_user_check" CHECK (("purpose" = 'authentication') = ("userId" IS NULL));
