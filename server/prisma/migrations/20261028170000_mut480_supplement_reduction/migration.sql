-- MUT-480 (ADR-222): a REDUCTION supplement row records a fee lowered through POST /v1/agreements/{id}/reduce.
-- The new enum value is only added here; nothing in this migration uses it, so one transaction is safe (PATTERNS "a
-- new enum value gets its own migration"). The columns the rows carry are the next migration (20261028170100).
--
-- Migrations are forward-only (DEPLOYMENT.md). The value can stay on a revert; no row uses it until the route ships.
ALTER TYPE "SupplementDistribution" ADD VALUE 'REDUCTION';
