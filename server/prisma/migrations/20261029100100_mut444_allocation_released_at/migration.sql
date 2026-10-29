-- MUT-444 (ADR-226): an allocation row is released, never edited: a terms correction sets "releasedAt" on the rows it
-- moves to the corrected charges, and every reader counts live rows only. Additive and nullable, with no CHECK, so a
-- revision that predates it inserts without it during a rolling deploy and gets null (a live row).
--
-- Migrations are forward-only (DEPLOYMENT.md). Rolling back past this while released rows exist is refused by
-- rollback-check (MUT-444 hazard): an older revision counts released rows. To revert, ship a new migration:
--   ALTER TABLE "payment_allocations" DROP COLUMN "releasedAt";

-- AlterTable
ALTER TABLE "payment_allocations" ADD COLUMN "releasedAt" TIMESTAMP(3);
