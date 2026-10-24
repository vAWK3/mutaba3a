-- MUT-367 (ADR-159 §7a, ADR-178): a self-service signup from a webmail, relay or unverified domain opens a
-- PENDING_REVIEW account. On its own migration (D29): Postgres refuses to use an enum value added in the same
-- transaction, and the next migration's index and CHECKs must not trip over that.
--
-- Forward-only (DEPLOYMENT.md). The value can stay on a revert; nothing writes it until signup is on.

-- AlterEnum
ALTER TYPE "UserStatus" ADD VALUE 'PENDING_REVIEW';
