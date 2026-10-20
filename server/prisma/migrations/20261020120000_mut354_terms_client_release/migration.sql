-- MUT-354 (MUT-348 decision 1): the client release that showed the terms, recorded with each acceptance so it maps
-- to the git tag holding the page code. Purely additive and nullable: rows from before it, and clients that don't
-- send it, keep null.

-- AlterTable
ALTER TABLE "terms_acceptances" ADD COLUMN "clientRelease" VARCHAR(64);
