# MUT-327 — Restore drill and pilot operator runbook

Ticket: MUT-327 (epic MUT-322, pilot gate). Status at planning: Backlog → Planned (2026-10-20).
Relates: MUT-235 (setup links), MUT-185 (decision 5: move a free-app user's data by hand),
MUT-300 (firm switch), MUT-325 (signed-in export), MUT-333 (close account), MUT-328 (alerts), MUT-323 (offer).

## 1. Problem and acceptance criteria

`production.tfvars` turns on daily backups (14 kept, 03:00 UTC) and point-in-time recovery
(7 days of logs), but nobody has ever restored one. The steps for running 10 paying users are
spread over `server/DEPLOYMENT.md`, `.claude/INFRA.md` and memory.

| AC | Text | Proved by |
|---|---|---|
| AC1 | The drill ran once against production backups, with timings in the runbook | **Basel** runs `server/scripts/restore-drill.sh` and fills runbook §10. Claude never touches production (hard limit for this ticket) |
| AC2 | Each runbook step walked once on staging or a scratch DB | Local walk on copies of `mutaba3a_dev` (§7 below). There's no staging. Steps that need GCP are marked "needs production" in the runbook's walk log |
| AC3 | The runbook is linked from DEPLOYMENT.md and INFRA.md | One link line each (MUT-326 edits both files too, so the edit stays small) |

Basel's decisions (Jira, 2026-10-19): support is email only, a reply within 2 working days
(inbox `info@malafat.app`, as in the terms). Offboarding: the user exports first (MUT-325), then
a 30-day grace period, a hard delete, and backups age out 14 days later; the operator does this
by hand until MUT-333. Outage alerts reach Basel by email + SMS (MUT-328).

## 2. What exists (reuse)

- `server/scripts/db.sh`: proxy + `DATABASE_URL` for production (`db:psql`, `db:run`). The new
  profile tool runs **through** `db:run`, so it never handles production credentials itself.
- `server/src/scripts/users.ts`: `provision:user`, `rotate:password [--lock]`, `revoke:user`,
  `disable:user`, `revoke:sessions`. On the MUT-300 branch: `firm:requests|enable|disable|decline`.
- Terraform (`main.tf`): instance `mutaba3a-pg` (POSTGRES_16, `db-g1-small`, REGIONAL); bucket
  `<project>-mutaba3a-attachments`, **versioning off**; Cloud Run ingress `INGRESS_TRAFFIC_ALL`.
- Test pattern for scratch databases: `repositories/__tests__/migration-mut182.test.ts`.

## 3. Deliverables

### 3.1 `server/scripts/restore-drill.sh` (Basel runs it; Claude validates with dry runs + shellcheck)

```
scripts/restore-drill.sh --project <id> [--instance mutaba3a-pg] [--receipt-id <uuid>]
                         [--pitr-minutes 60] [--only backup|pitr] [--keep] [--dry-run]
scripts/restore-drill.sh teardown --project <id> [--name <scratch>] [--dry-run]
```

1. Preflight: tools, gcloud account, `instances describe` on the source (region, tier, edition,
   disk size, PITR on). Read-only.
2. Last night's backup: `gcloud sql backups list --filter='status=SUCCESSFUL AND type=AUTOMATED'
   --sort-by=~windowStartTime --limit=1`.
3. **Prompt (costs money).** Create `mutaba3a-pg-drill-<stamp>-b` (same version/tier/edition/disk,
   ZONAL, no backups, no deletion protection, label `purpose=restore-drill`), then
   `gcloud sql backups restore <id> --restore-instance=<scratch> --backup-instance=<source>`.
4. **Prompt (costs money).** `gcloud sql instances clone <source> mutaba3a-pg-drill-<stamp>-p
   --point-in-time=<now − 60 min>`, then patch the clone: label, no deletion protection, no backups.
5. Per scratch instance: set a throwaway password for `mutaba3a_api` **on the scratch copy only**
   (so the drill never needs the production password), start `cloud-sql-proxy` on its own port,
   and in a read-only session: exact row count of every table, applied migrations vs the repo,
   newest `audit_events.createdAt` (proves which moment was restored).
6. Receipt opens: the receipt row (`--receipt-id`, else the newest READY one) from the scratch copy,
   then `gcloud storage objects describe` + `cp` of its object, size and file signature checked
   against the row. Also prints the bucket's soft-delete window (see §5, R3).
7. Comparison: backup vs PITR counts side by side; audit rows in PITR ≥ backup (append-only).
8. Timings for each step, printed as Markdown rows for runbook §10.
9. Teardown on exit (unless `--keep`): stop proxies, delete only the instances this run created.
   `teardown` subcommand removes leftovers (by name prefix + label), each confirmed.

Safety:
- Every mutating gcloud call goes through `mutate <instance> …`, which refuses unless the name
  matches `^mutaba3a-pg-drill-[0-9]{8}t[0-9]{6}-[bp]$` **and** differs from the source. The source
  only ever appears in read-only commands, as `--backup-instance`, or as the clone's source.
- `--dry-run` prints every command with placeholders and calls nothing (not even read-only gcloud).
- Bash 3.2 compatible (macOS `/bin/bash`), `set -euo pipefail`, shellcheck clean.

### 3.2 `server/scripts/profile-rows.sh` (walkable locally; production only through `db:run`)

Catalog-driven, so it follows the schema as migrations change it:
- "Profile tables" = public tables with an `organizationId` column. FK order comes from
  `pg_constraint` through `tsort`. Column lists come from `information_schema`.

```
profile-rows.sh export     --organization-id <uuid> --out <dir>        # DATABASE_URL
profile-rows.sh restore    --organization-id <uuid> [--dry-run] [--yes] # SOURCE_DATABASE_URL → DATABASE_URL
profile-rows.sh purge-user --user-id <uuid>          [--dry-run] [--yes] # DATABASE_URL
```

- **export**: one CSV per profile table (minus `api_keys`, `idempotency_keys`; no secrets) plus the
  organization row and a `receipts.txt` with the exact `gcloud storage cp` lines. This is the
  "we export your records for you on request" promise in pilot-offer §4 until MUT-325 ships.
- **restore** (one profile back to a restored copy): schema parity check (same columns in both
  databases, else refuse), then **one transaction** on the target: delete the profile's rows in
  reverse FK order, `\copy` the source rows in FK order. Kept as they are now, never rolled back:
  `api_keys`, `memberships`, `integrations`, `idempotency_keys` (rolling back access could re-grant
  revoked access) and the `organizations` row. `audit_events` are merged (missing ids added, none
  removed), then one `SYSTEM` event `organization.restored` is appended. `--dry-run` does the whole
  thing and ends in `ROLLBACK`, printing before/after counts.
- **purge-user** (offboarding hard delete after the 30-day grace period): deletes every row of each
  profile the person owns (`ownerUserId` / `personalOwnerUserId`), the profiles, then every row in
  user-only tables (sessions, setup tokens, terms acceptances, user idempotency keys, inbox), the
  person's `user.terms_accepted` audit rows on other profiles (MUT-333 comment), then the user.
  **Refuses** if the person still has a membership in a profile they don't own (run `revoke:user`
  first, which audits it) or if rows in someone else's profile still point at them (RESTRICT FKs:
  MUT-333's decision, not the operator's). Prints the `gcloud storage rm` lines for the profiles'
  objects. `--dry-run` ends in `ROLLBACK`.
- Refuses when `SOURCE_DATABASE_URL` and `DATABASE_URL` name the same host, port and database.
- A typed confirmation (the profile or user id) unless `--yes`.

### 3.3 `docs/operations/pilot-runbook.md`

Sections: 0 before you start (tools, `TF_STATE_BUCKET`, `URL`, admin token) · 1 onboard
(provision:user, setup link, profiles, firm switch once MUT-300 lands) · 2 password reset ·
3 move a free-app user's data · 4 restore one profile vs the whole database · 5 incident response ·
6 support · 7 offboard (export, grace period, delete, backups age out) · 8 restore drill ·
9 walk log (walked locally / needs production) · 10 drill results (empty timing fields).
Every step has exact commands. Placeholders are marked **⚠ Basel decides**.

### 3.4 Links and knowledge files

- `server/DEPLOYMENT.md` §6 table: one row "Pilot operator runbook, restore drill".
  `.claude/INFRA.md` §2 "Code-defined": one bullet. Nothing else in those files (MUT-326 edits them).
- ADR-157 (restore policy), TD-190 (receipts aren't in the database backups), TD-191 (manual moves
  from the free app have no tool until MUT-290), CHANGELOG, COMPONENT_REGISTRY (two scripts),
  TEST_PLAN, SYSTEM_OVERVIEW (ops line).

## 4. Tests (TDD)

`server/src/scripts/__tests__/restore-drill.test.ts` (no database; always runs):
- `--dry-run` prints the create/restore/clone/delete commands, names only `mutaba3a-pg-drill-*`
  as targets, and never executes `gcloud` (a fake `gcloud` on PATH fails the test if called).
- `teardown --name mutaba3a-pg` (the source) and `--name anything-else` are refused, exit ≠ 0.
- `--instance mutaba3a-pg-drill-…` as the source is refused.
- Missing `--project` → usage, exit 2.

`server/src/scripts/__tests__/profile-rows.test.ts` (Postgres; skipped without
`MUTABA3A_TEST_DATABASE_URL` or `psql`, like the migration tests): two scratch databases migrated
from `prisma/migrations`, seeded with raw rows:
- restore: rows changed/deleted/added in the target after the "backup" come back exactly as the
  source; another profile is untouched; memberships/api_keys unchanged; audit rows only grow, with
  one `organization.restored`; `--dry-run` leaves the target unchanged.
- restore refuses identical source/target and a schema mismatch.
- purge-user: owned + personal profiles and every row gone; another person's data untouched;
  refuses while a shared-profile membership exists; removes `user.terms_accepted` rows elsewhere.
- export writes one CSV per table, no `api_keys` file.

Run: `npm --prefix server test -- restore-drill profile-rows` (with the test DB URL for the second).

## 5. Review (self-run eng review; `/plan-eng-review` is interactive and this is a side session)

- **R1 Access rollback.** Restoring `memberships`/`api_keys` to an hour ago could re-grant access
  that was revoked in between. → excluded from restore; the runbook says to re-check access by hand.
- **R2 Audit loss.** Replacing `audit_events` would erase the record of what happened since the
  backup. → merge-only plus an `organization.restored` event.
- **R3 Receipts aren't backed up.** Deleting a receipt deletes its object (`expenses.ts:330`) and the
  bucket has no versioning, so a restored row can point at a missing object. GCS soft delete (7 days
  by default on new buckets) may still hold it; the drill prints the bucket's soft-delete window and
  the runbook gives `gcloud storage restore`. → TD-190, and a follow-up card for bucket versioning or
  a set soft-delete window (an infra change that Basel applies).
- **R4 Cost.** Two `db-g1-small` instances for about an hour: the clone inherits REGIONAL. That's well
  under $1. Prompts state it; teardown on every exit path (`trap`), plus the `teardown` subcommand.
- **R5 Password exposure.** The scratch password is passed to `gcloud sql users set-password` in argv
  for an instance deleted within the hour. It's random, only ever set on a scratch copy, and never
  printed. Accepted.
- **R6 Whole-DB restore in place** loses everything after the restore point and restarts the instance.
  The runbook always takes an on-demand backup first (so the restore can be undone) and closes ingress
  (`gcloud run services update --ingress=internal`; the next deploy resets it to Terraform's value).
- **R7 The promise "nothing to type again"** (/hosted, pilot-offer §4) has no tool behind it until
  MUT-290. The runbook says so honestly (re-enter together, or wait for MUT-290) and it's flagged to
  Basel as a decision, not hidden.

## 6. Out of scope

Running the drill or anything against production · building MUT-290's importer · MUT-333's
self-service close · changing the bucket's versioning (follow-up) · staging.

## 7. Local walk plan (AC2)

Against copies of `mutaba3a_dev` in the `mutaba3a-test-pg` container, and the shared local API on
:8787 for the account steps (one throwaway account `pilot-runbook-walk@mutaba3a.test`, purged at the end):
provision → setup link → set password → sign in → create a Business profile → rotate → reset →
export → restore one profile (copy A → copy B) → revoke → purge-user. The drill itself: dry run only.
Firm switch: not on main (MUT-300) → "walk when MUT-300 lands". Incident/support: written routines,
not walkable.

## Business / product impact

- The pilot gate (MUT-322) needs a proven way back from a bad day: a tested backup is the difference
  between "we lost your books" and "we restored them by lunch" for 10 paying users.
- One place for every operator step means onboarding, resets and offboarding happen the same way each
  time, and the privacy promises in the terms (30-day delete, backups gone 14 days later) are things
  Basel can actually carry out.
