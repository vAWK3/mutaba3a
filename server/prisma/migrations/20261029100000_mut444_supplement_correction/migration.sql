-- MUT-444 (ADR-226): a CORRECTION supplement row records an agreement's terms corrected through
-- POST /v1/agreements/{id}/correct. The new enum value is only added here; nothing in this migration uses it, so one
-- transaction is safe (PATTERNS "a new enum value gets its own migration"). The allocation column is the next
-- migration (20261029100100).
--
-- Migrations are forward-only (DEPLOYMENT.md). The value can stay on a revert; rolling back past it while CORRECTION
-- rows exist is refused by rollback-check (MUT-444 hazard): an older Prisma client cannot read them.
ALTER TYPE "SupplementDistribution" ADD VALUE 'CORRECTION';
