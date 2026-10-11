-- MUT-59: repair a database that applied the ORIGINAL M7 migration.
--
-- M8 edited 20261009120000_m7_fee_proposals in place (decision D20). Production
-- had already applied the original (commit acb1144, 2026-10-09), and
-- `prisma migrate deploy` never re-runs a recorded migration, so such a
-- database keeps FeeProposalStatus ('PROPOSED','CLIENT_APPROVED','AGREED',
-- 'CONVERTED','WITHDRAWN') and the columns agreedOn / agreedNote while the code
-- writes 'APPROVED'.
--
-- On a database that already has M8's shape (every fresh one) this does
-- nothing. Otherwise, in one statement (all or nothing):
--   1. Refuse, changing nothing, when a row cannot be mapped: a CONVERTED
--      proposal without an agreement, or a project that would be left with two
--      open proposals.
--   2. Record each touched row's previous values as a SYSTEM audit event
--      `fee_proposal.repaired` before anything is changed or dropped.
--   3. Map: CONVERTED -> APPROVED (approval date and final amount taken from
--      the M7 fields, else the agreement); CLIENT_APPROVED / AGREED -> PROPOSED
--      (still open; M8 approves and creates the agreement in one step).
--      PROPOSED and WITHDRAWN keep their status.
--   4. Recreate the enum with M8's three values; drop agreedOn and agreedNote.
--
-- If it refuses, fix the named rows by hand, then
-- `npx prisma migrate resolve --rolled-back 20261011120000_mut59_fee_proposal_enum_repair`
-- and re-run deploy.sh (DEPLOYMENT.md §7).

DO $$
DECLARE
  unmappable TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'FeeProposalStatus' AND e.enumlabel = 'CLIENT_APPROVED'
  ) THEN
    RAISE NOTICE 'MUT-59: FeeProposalStatus already has the M8 shape; nothing to repair';
    RETURN;
  END IF;

  SELECT string_agg(id::text, ', ') INTO unmappable
  FROM fee_proposals WHERE status::text = 'CONVERTED' AND "agreementId" IS NULL;
  IF unmappable IS NOT NULL THEN
    RAISE EXCEPTION 'MUT-59 repair refused: CONVERTED fee proposals without an agreement: %', unmappable;
  END IF;

  SELECT string_agg(DISTINCT "projectId"::text, ', ') INTO unmappable
  FROM (
    SELECT "projectId" FROM fee_proposals
    WHERE status::text IN ('PROPOSED', 'CLIENT_APPROVED', 'AGREED')
    GROUP BY "organizationId", "projectId" HAVING count(*) > 1
  ) crowded;
  IF unmappable IS NOT NULL THEN
    RAISE EXCEPTION 'MUT-59 repair refused: projects that would have more than one open fee proposal: %', unmappable;
  END IF;

  INSERT INTO audit_events (id, "organizationId", "actorType", "actorId", action, "entityType", "entityId", metadata, "requestId", "createdAt")
  SELECT
    gen_random_uuid(), fp."organizationId", 'SYSTEM'::"AuditActorType", NULL, 'fee_proposal.repaired', 'fee_proposal', fp.id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'repair', 'MUT-59',
      'fromStatus', fp.status::text,
      'toStatus', CASE fp.status::text WHEN 'CONVERTED' THEN 'APPROVED' WHEN 'CLIENT_APPROVED' THEN 'PROPOSED' WHEN 'AGREED' THEN 'PROPOSED' ELSE fp.status::text END,
      'clientApprovedOn', fp."clientApprovedOn",
      'clientApprovalNote', fp."clientApprovalNote",
      'agreedAmountMinor', fp."agreedAmountMinor"::text,
      'agreedOn', fp."agreedOn",
      'agreedNote', fp."agreedNote"
    )),
    NULL, CURRENT_TIMESTAMP
  FROM fee_proposals fp
  WHERE fp.status::text IN ('CLIENT_APPROVED', 'AGREED', 'CONVERTED') OR fp."agreedOn" IS NOT NULL OR fp."agreedNote" IS NOT NULL;

  -- APPROVED in M8 carries the approval date and the final amount.
  UPDATE fee_proposals fp SET
    "clientApprovedOn" = COALESCE(fp."clientApprovedOn", fp."agreedOn", (SELECT a."agreementDate" FROM agreements a WHERE a.id = fp."agreementId")),
    "agreedAmountMinor" = COALESCE(fp."agreedAmountMinor", (SELECT a."amountMinor" FROM agreements a WHERE a.id = fp."agreementId"), fp."proposedAmountMinor"),
    version = fp.version + 1,
    "updatedAt" = CURRENT_TIMESTAMP
  WHERE fp.status::text = 'CONVERTED';

  -- An open proposal in M8 carries no approval yet; the previous values are in the audit row.
  UPDATE fee_proposals SET
    "clientApprovedOn" = NULL,
    "clientApprovalNote" = NULL,
    "agreedAmountMinor" = NULL,
    version = version + 1,
    "updatedAt" = CURRENT_TIMESTAMP
  WHERE status::text IN ('CLIENT_APPROVED', 'AGREED');

  ALTER TABLE fee_proposals ALTER COLUMN status DROP DEFAULT;
  CREATE TYPE "FeeProposalStatus_m8" AS ENUM ('PROPOSED', 'APPROVED', 'WITHDRAWN');
  ALTER TABLE fee_proposals ALTER COLUMN status TYPE "FeeProposalStatus_m8" USING (
    CASE status::text WHEN 'CONVERTED' THEN 'APPROVED' WHEN 'CLIENT_APPROVED' THEN 'PROPOSED' WHEN 'AGREED' THEN 'PROPOSED' ELSE status::text END
  )::"FeeProposalStatus_m8";
  DROP TYPE "FeeProposalStatus";
  ALTER TYPE "FeeProposalStatus_m8" RENAME TO "FeeProposalStatus";
  ALTER TABLE fee_proposals ALTER COLUMN status SET DEFAULT 'PROPOSED';

  ALTER TABLE fee_proposals DROP COLUMN "agreedOn", DROP COLUMN "agreedNote";
END $$;
