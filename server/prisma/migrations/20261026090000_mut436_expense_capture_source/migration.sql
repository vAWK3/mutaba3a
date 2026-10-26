-- MUT-436 (ADR-201): where an expense was captured — the phone's siri/widget/quick_action/share/app, or 'mcp' for a
-- person's own Claude — so the portal can mark "Added by Claude" in the expense drawer. Nullable and additive: rows
-- written before this keep null, and a revision that predates it inserts without it during a rolling deploy.
--
-- Migrations are forward-only (DEPLOYMENT.md). To revert, ship a new migration:
--   ALTER TABLE "expenses" DROP COLUMN "captureSource";
ALTER TABLE "expenses" ADD COLUMN "captureSource" VARCHAR(20);
