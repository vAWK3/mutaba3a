# MUT-381 — Encrypt Cloud SQL and the receipts bucket with our own KMS key (CMEK)

Ticket: https://barmajiyat.atlassian.net/browse/MUT-381 (Task, parent MUT-322, `pilot-gate`).
Status at planning: Backlog → Planned. Plan only; Claude prepares code and Terraform, Basel applies (MUT-322 guardrail, CLAUDE.md "never deploy").

## Context

- Today: Cloud SQL `mutaba3a-pg`, bucket `<project>-mutaba3a-attachments` and Secret Manager use only Google's default encryption. The KMS API isn't enabled (`server/infrastructure/terraform/main.tf:60-69`, `:99-148`, `:494-523`).
- ADR-024 requires encrypted at rest, kept in region, deletable. Decision 2026-10-21 (Basel): harden plus CMEK; no field-level or end-to-end encryption.
- **Hard constraint:** Cloud SQL can't add CMEK to an existing instance. It needs a new instance, filled by restoring a backup with the new key.
- The project `malafat-production` is shared with Malafat. Malafat already has a key ring (`tenant_keys`) there.
  - Malafat's Cloud Run SA `run-me-west1` holds **project-level** `cloudkms.cryptoKeyEncrypterDecrypter`, `storage.objectAdmin` and `cloudsql.client` (`Barmajiyat/Malafat/dev/web/crm-platform/infrastructure/terraform/modules/regional-stack/main.tf:219-235`).
  - So CMEK adds **no isolation from Malafat's runtime**. Record this honestly in the ADR; the project split stays out of scope.
- ADR-161: a release never performs a Terraform rename or an operator step. This cutover is an operator procedure, not a `make release server` job.
- ADR-157: the restore tooling's safety is structural. Commands that mutate an instance name an allowlisted target and refuse anything else.

## Neighborhood

- Parent MUT-322 (pilot gate).
- Relates MUT-327 (restore drill and runbook, In Progress; the drill has not been run against production yet).
- Relates MUT-382 (the policy states at-rest encryption once this ships) and MUT-329 (release order; Basel runs it).
- No blockers.
- Overlap: the drill's scratch instances must keep working once the source is CMEK.
- Not covered here: Secret Manager CMEK, Terraform-state encryption, the GCP project split, RLS.

## Decisions (recommended defaults; change on the ticket)

- **D1. A new instance `mutaba3a-pg2` alongside the old one, switched by `var.db_instance = "legacy" | "cmek"`. No `moved` blocks and no in-place replacement.**
  - Why: rollback is a one-variable flip. The old instance keeps its address, so ADR-161's bootstrap targets stay valid until the cleanup.
  - Rejected: renaming the address to force replacement. `deletion_protection` blocks it, and if it went through it would point Cloud Run at an empty database.
- **D2. Fill the new instance with `gcloud sql backups restore <on-demand backup> --restore-instance=mutaba3a-pg2 --backup-instance=mutaba3a-pg`.**
  - Postgres users, `_prisma_migrations` and ownership come across intact.
  - `mutaba3a_api`'s password matches because both instances share `random_password.db`.
  - Fallback if a rehearsal shows the target losing its key: `pg_dump`/`pg_restore` with the v16 tools (runbook §4.3 B, already walked).
- **D3. Software-protection key** (`SOFTWARE`, ~$0.06 per key version per month), not HSM. 90-day rotation, `prevent_destroy`, and Google's 30-day `destroy_scheduled_duration` left as is (a scheduled destroy can be cancelled for 30 days).
- **D4. No KMS Data Access audit logs.**
  - `google_project_iam_audit_config` is project-wide and authoritative per service, so it would start logging every decrypt of Malafat's tenant keys too.
  - Admin Activity logs (key disable/destroy/IAM) are always on and free.
  - The ticket's "every use logged" is therefore narrowed to "every change to the key is logged". Note it on the ticket and in MUT-382.
- **D5. The old instance stays running for 14 days after cutover, then is deleted.**
  - This keeps pre-cutover backups and PITR available for the window the policy promises.
  - Cost: about $28 (db-g1-small REGIONAL).
- **D6. Existing receipt objects are rewritten under the key.** The replaced Google-encrypted generations sit in soft delete for 14 days, then purge. That's the same window as D5.

## Implementation (one branch `infra/mut-381-cmek`, in a worktree; nothing applied)

### Terraform — `server/infrastructure/terraform/`

1. `versions.tf`: add the `google-beta` provider (`~> 5.0`, same project and region), for `google_project_service_identity`. That's the documented way to create the Cloud SQL CMEK service agent.
2. `main.tf`, APIs: add `cloudkms.googleapis.com` to `google_project_service.apis`.
3. New `kms.tf`:
   - `google_kms_key_ring.mutaba3a` (`mutaba3a${suffix}`, location `var.region`).
   - `google_kms_crypto_key.data` (`mutaba3a-data`, `rotation_period = "7776000s"`, `purpose = ENCRYPT_DECRYPT`, `lifecycle { prevent_destroy = true }`, labels).
   - `google_project_service_identity.cloud_sql` (beta, `sqladmin.googleapis.com`).
   - `data "google_storage_project_service_account" "gcs"`.
   - Two `google_kms_crypto_key_iam_member` (role `cloudkms.cryptoKeyEncrypterDecrypter`) on **the key, not the project**: one for the Cloud SQL agent, one for the GCS agent.
4. `main.tf`, database:
   - Add `google_sql_database_instance.postgres_cmek` (`mutaba3a-pg2${suffix}`) with the same `settings` as `postgres`, plus `encryption_key_name = google_kms_crypto_key.data.id`.
   - It gets `depends_on` the Cloud SQL agent's key grant, its own `google_sql_database.mutaba3a_cmek` and `google_sql_user.api_cmek` (same `random_password.db`), and `deletion_protection = var.deletion_protection`.
   - Factor the shared settings so they are written once: either a `locals` object fed into both blocks, or a `dynamic` block over both instances. Pick whichever keeps `tests/database_pool.tftest.hcl` reading `settings[0]`.
5. A `locals` switch:
   - `active_db = var.db_instance == "cmek" ? google_sql_database_instance.postgres_cmek : google_sql_database_instance.postgres`, and `active_instance_id` to go with it.
   - The DATABASE_URL secret (`host=/cloudsql/<active>`), the Cloud Run `cloud_sql_instance.instances`, the outputs `cloud_sql_connection_name` / `local_database_url` (unchanged shape) and `monitoring.tf`'s `cloud_sql_database_id` all read `local.active_*`.
   - New output `cloud_sql_instance_name`.
6. `variables.tf`: `db_instance` (default `"legacy"`, validation `legacy|cmek`), documented as the cutover switch (DEPLOYMENT.md §6d).
7. Bucket: `encryption { default_kms_key_name = google_kms_crypto_key.data.id }`, with `depends_on` the GCS agent's key grant. This is an in-place update; signed V4 URLs keep working because the GCS agent does the encryption.

### Scripts — `server/scripts/`

8. `lib/db-checks.sh` (new): move `restore-drill.sh`'s read-only checks (exact row count per table, applied migrations, newest audit event) out of the drill, so the drill and the cutover share them (DRY). The drill sources it, and its existing tests stay green.
9. `restore-drill.sh`: CMEK-aware.
   - The scratch instance for a backup restore is created with `--disk-encryption-key=<source's kmsKeyName>`, read with a read-only `gcloud sql instances describe`. Dry-run prints a placeholder.
   - The PITR clone inherits the key.
   - `--instance` still defaults to `mutaba3a-pg`; the cleanup follow-up changes the default.
10. `cmek-cutover.sh` (new, Bash 3.2, `--dry-run`, follows the drill's shape):
    - Subcommands:
      - `rehearse`: on-demand backup of the source → restore into `mutaba3a-pg2` → check the key is still set → counts → timings. Ingress stays open, so counts aren't compared to live.
      - `cutover`: close ingress (`--ingress=internal`, runbook §4.3) → on-demand backup → restore → key check → **counts compared table by table with the source, which is frozen**. On any mismatch it stops, reopens ingress on the old instance and exits non-zero. On a match it prints the exact `terraform apply -var db_instance=cmek -var image_tag=<live /health version>` to run next, but doesn't run it (operators apply Terraform themselves).
      - `verify`: after the apply, `/ready` returns 200; the instance's `diskEncryptionStatus` names the key; the live connection name equals `mutaba3a-pg2`.
    - Structural safety: the only instance it mutates is the literal `mutaba3a-pg2`; the source is only read. It refuses if `mutaba3a-pg2` is already the active instance (read from `terraform output cloud_sql_instance_name`).

### Docs

11. ADR-162 in `.claude/DECISIONS.md`: CMEK on Cloud SQL and the bucket.
    - Record D1–D6.
    - **What it protects:** physical media and Google-internal access outside our project; the ability to revoke the key, making the whole store unreadable along with its backups.
    - **What it doesn't:** anyone with project roles (operators, and Malafat's runtime SA, which has project-wide KMS/storage/SQL roles); application-level reads.
    - Amend ADR-024's "encrypted at rest" with a pointer here.
12. TD entry (next free number): the project-wide roles of Malafat's runtime SA in the shared project cancel CMEK's isolation. The fix is the project split or Malafat narrowing to its own resources.
13. `server/DEPLOYMENT.md` §6d (new) — the operator steps: phase 1 apply, signed-URL check, object rewrite, rehearsal, cutover, verify, rollback, day-14 deletion.
14. `docs/operations/pilot-runbook.md`:
    - The §8 drill notes that CMEK scratch instances use the source's key.
    - A §5 incident line: "a disabled or destroyed key version = database and receipts down; re-enable the version (destroy can be cancelled for 30 days)".
    - Never disable an old key version: Cloud SQL does not re-encrypt on rotation.
15. `.claude/INFRA.md`: the topology and settings rows (key, instance name, switch state) and the cost row.

## Operator procedure (Basel; §6d)

1. **Phase 1 apply (no downtime).** `terraform apply` with the current `image_tag`, run from the merged main.
   - It creates the key, the agent and grants, `mutaba3a-pg2` (empty, about 10 min) and the bucket's default key.
   - Cloud Run stays on `mutaba3a-pg`.
2. **Bucket check.**
   - Attach a receipt in the portal and open it.
   - `gcloud storage objects describe` on the new object shows `kmsKeyName`.
   - Then run `gcloud storage objects update gs://<bucket>/** --encryption-key=<key>` (rewrite), and spot-check an old receipt.
3. **Rehearsal (no downtime):** `scripts/cmek-cutover.sh rehearse`. Record the timings in the runbook. They give the downtime estimate.
4. **Cutover (quiet window, announced to Malafat; the API is down for it).**
   - `scripts/cmek-cutover.sh cutover`.
   - Set `db_instance = "cmek"` in `production.tfvars`.
   - Run the printed `terraform apply`. Its Cloud Run update also resets ingress to ALL.
   - `scripts/cmek-cutover.sh verify`.
   - Smoke checks: portal sign-in, a phone save, one Malafat money call.
5. **Rollback:**
   - Before the apply: just reopen ingress; the old instance is untouched.
   - After the apply: set `db_instance = "legacy"` and apply. Writes made on `mutaba3a-pg2` since then are lost, so only roll back within the window.
6. **Day 14:** the cleanup follow-up.
   - Set `deletion_protection` off for `postgres`, then remove the legacy resources and the switch.
   - Update `BOOTSTRAP_TARGETS` (+ `deploy-bootstrap.test.ts`) and the drill's default `--instance` (+ test).
   - Run the restore drill against `mutaba3a-pg2` (MUT-327 step).
   - That's a separate ticket, filed at the end of planning.

No release (`make release server`) runs between steps 3 and 4. Between steps 1 and 3 a release is safe: it uses the outputs, which follow `db_instance`.

## Tests (TDD: written first)

- `tests/cmek.tftest.hcl` (new, mocked `google`, `google-beta`, `random`):
  - (a) the key ring and key are in `var.region`, and rotation is `7776000s`;
  - (b) `postgres_cmek.encryption_key_name` is the key's id; `postgres` has none;
  - (c) the bucket's `encryption[0].default_kms_key_name` is the key's id;
  - (d) both service agents are granted on the key, and no project-level KMS binding exists;
  - (e) `db_instance = "legacy"` gives a DATABASE_URL secret, Cloud Run volume and monitoring `database_id` that name `mutaba3a-pg`;
  - (f) `"cmek"` makes all three name `mutaba3a-pg2`;
  - (g) `db_instance = "other"` is refused;
  - (h) both instances keep `retained_backups = 14`, PITR and `deletion_protection`.
- `tests/monitoring.tftest.hcl:232`: still passes with the default `legacy`; plus one case under `cmek`.
- `tests/database_pool.tftest.hcl`, `attachments_bucket.tftest.hcl`: unchanged and green (settings factoring must not move `settings[0]`).
- `src/scripts/__tests__/restore-drill.test.ts`: the existing cases pass after the `lib/db-checks.sh` extraction. New: the dry-run shows `--disk-encryption-key=` on the scratch create.
- `src/scripts/__tests__/cmek-cutover.test.ts` (new, `--dry-run` plus a fake `gcloud`/`terraform` on PATH, like `deploy-bootstrap.test.ts`):
  - every mutate names `mutaba3a-pg2` and nothing else;
  - `cutover` closes ingress before the backup;
  - a count mismatch reopens ingress and exits non-zero without printing the apply;
  - it refuses when the active instance is already `mutaba3a-pg2`;
  - `rehearse` never touches ingress.
- `legal-terms.test.ts`: still reads `db_retained_backups` from `main.tf` (keep the local where it is).
- Commands:
  - `cd server/infrastructure/terraform && terraform init -backend=false && terraform test`
  - `npm --prefix server test`, `npm --prefix server run typecheck`, `npm --prefix server run lint`

## Cost

- KMS: about $0.06 per key version per month, 4–5 versions a year. Operations are pennies at pilot volume.
- Second instance during cutover plus 14 days: about $28, once.
- The rewrite's soft-deleted generations: cents.
- Steady state unchanged: the old instance is deleted, the new one is the same tier.

## Acceptance criteria → proof

| AC | Proof |
|---|---|
| `kmsKeyName` on the live instance | `cmek-cutover.sh verify` + `gcloud sql instances describe mutaba3a-pg2` (operator) |
| A new receipt object reports the key | §6d step 2 (operator), plus test (c) |
| The restore drill passes on the CMEK instance, backups and PITR as before | drill CMEK support + test (h); the drill run itself is the day-14 follow-up / MUT-327 |
| Cutover downtime measured and in the runbook | `rehearse` and `cutover` timings → runbook §10 |
| Claude prepares, Basel applies | no apply in the build; §6d is the operator's |

## Business / product impact

- Pilot firms can be told their records and receipts are encrypted with Mutaba3a's own key in me-west1, rotated every 90 days, and that revoking it makes every copy, backups included, unreadable. That is the at-rest answer MUT-382 can then publish.
- It sits on the MUT-322 pilot gate. Doing it before pilot data exists turns a migration into a short, rehearsed cutover.
- The cost is about $28 once plus cents a month. The main risk is a key-version mistake taking the API down, covered by `prevent_destroy`, the 30-day destroy delay and a runbook line.

---

# Eng review (plan-eng-review, 2026-10-21)

Target: `.claude/designs/mut-381-cmek.md` (the plan above, unchanged copy). Reviewer: Claude (native).

## Scope record

feature answers: none proposed (no cuts); structure: A "Original arrangement" (D1, 2026-10-21); accepted scope: plan as written (18 files, cmek-cutover.sh + lib/db-checks.sh); pending remedies: R1, R2, R3.

## Plan corrections (no behavior change, no question)

- C1 (Code quality, confidence 7): item 4's "factor the shared settings so they are written once" is dropped. Terraform cannot pass a `settings` block through a local, and a `for_each` instance map would rename `google_sql_user.api` / `google_sql_database.mutaba3a`, which `lib/tf-bootstrap.sh` BOOTSTRAP_TARGETS names (ADR-161). Write the second instance's settings out in full; test (h) pins parity (tier, availability, backups 14, PITR 7 days, `max_connections`, `ssl_mode`, maintenance window).
- C2 (Architecture, confidence 5, verify): a backup restores only into an instance with at least the source's storage. `mutaba3a-pg` has `disk_autoresize` and may have grown past 10 GB. `cmek-cutover.sh` reads both instances' `settings.dataDiskSizeGb` before the restore and refuses when the target is smaller. This is part of the approved script's safety checks.
- C3 (Scope, deferred ask): the ticket's "every use of it is logged" is narrowed by D4 to "every change to the key is logged". Note it on MUT-381 and MUT-382 at hand-off.

## Decision ledger

### R1: Cutover apply must not reopen ingress before the new revision serves
Finding: 1, P1, confidence 6, `server/infrastructure/terraform/main.tf:300` (`ingress  = "INGRESS_TRAFFIC_ALL"`), reviewer Claude (Architecture)
Plan baseline: Operator procedure step 4: run the printed `terraform apply`; "its Cloud Run update also resets ingress to ALL."
Runtime evidence: ingress is hard-coded ALL in Terraform. The runbook says the next deploy resets it (`pilot-runbook.md:297`). Whether Cloud Run applies a service-level ingress change before the new revision takes traffic is unknown (not probed).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 ingress during cutover apply | reopens in the same update as the instance switch | `var.api_ingress` (default ALL); the cutover apply runs with internal; `verify` checks 100% traffic on a revision whose volume is mutaba3a-pg2, then a second apply reopens | unchanged |
| R2 phase-1 gating | approved cmek_stage off/prepared/active (D3) | same | same |
| R3 drill source | pending | pending | pending |
Question D2: see below. Header: Ingress race
Options:
A) Two-step reopen (recommended)
Add var api_ingress (default INGRESS_TRAFFIC_ALL). The cutover apply passes internal; cmek-cutover.sh verify confirms the serving revision mounts mutaba3a-pg2 and takes 100% traffic; a second apply with the default reopens. Tests: tftest for the variable; cutover test that the printed apply carries internal ingress. (human: ~2h / CC: ~15 min)
B) Keep as planned
One apply switches the instance and reopens ingress together. No new variable; relies on Cloud Run never routing outside traffic to the old revision during the rollout.
State: approved
Actual answer: A "Two-step reopen" (D2, 2026-10-21)
Accepted scope: var api_ingress (default INGRESS_TRAFFIC_ALL) on google_cloud_run_v2_service.api; the cutover apply printed by cmek-cutover.sh passes internal ingress; `verify` confirms the serving revision mounts mutaba3a-pg2 and takes 100% traffic; a second apply with the default reopens. Tests: tftest for the variable (default ALL, internal accepted, other values refused); cmek-cutover.test.ts asserts the printed apply carries internal ingress.
History: none

### R2: Merging the PR makes the next release create the key, mutaba3a-pg2 and the bucket key
Finding: 2, P2, confidence 9, `server/scripts/deploy.sh:145` (`terraform apply "${TF_ARGS[@]}" "${APPROVE[@]}"`), reviewer Claude (Scope Challenge)
Plan baseline: Operator procedure step 1: a separate operator "phase 1 apply".
Runtime evidence: deploy.sh step 4 is a full apply without -target, so any release after the merge applies every new resource.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 ingress | approved two-step reopen (D2) | same | same |
| R2 phase-1 gating | next release creates KMS, pg2 (~$2/day idle) and switches the bucket key | `var.cmek_stage = off|prepared|active` (replaces `db_instance`); `off` (default) creates nothing new; Basel sets `prepared` in production.tfvars when ready; `active` is the switch | document that the next release performs phase 1 |
| R3 drill source | pending | pending | pending |
Header: Phase-1 gating
Options:
A) Opt-in stage variable (recommended)
One variable cmek_stage (off/prepared/active) replaces db_instance. off = no KMS, no pg2, no bucket key, so a release after merge changes nothing; prepared = phase 1; active = cutover switch. Tests: off plans no KMS/pg2 resources and no bucket encryption. (human: ~2h / CC: ~15 min)
B) Ride the next release
Keep db_instance. The first release after merge creates the key, mutaba3a-pg2 and the bucket key; DEPLOYMENT.md and the before-release note say so. pg2 bills ~$2/day until the cutover.
State: approved
Actual answer: A "Opt-in stage variable" (D3, 2026-10-21)
Accepted scope: `var.cmek_stage` = off | prepared | active (default off, validated) replaces `db_instance`. off: no KMS key ring/key/grants/service identity, no mutaba3a-pg2, no bucket encryption block (count/dynamic on cmek_stage). prepared: all CMEK resources exist, Cloud Run/secret/outputs/monitoring still on mutaba3a-pg. active: they all follow mutaba3a-pg2. Basel sets it in production.tfvars. Tests: one tftest run per stage (off creates none of the new resources and no bucket encryption; prepared creates them with legacy active; active switches), plus an invalid value refused. Section 6d step 1 becomes "set cmek_stage = prepared, apply".
History: none

### R3: The drill's default source stays mutaba3a-pg after the cutover
Finding: 3, P2, confidence 7, `server/scripts/restore-drill.sh:39` (`SOURCE="mutaba3a-pg"`), reviewer Claude (Code quality)
Plan baseline: item 9: "--instance still defaults to mutaba3a-pg; the cleanup follow-up changes the default."
Runtime evidence: the default is a literal. For the 14 days between cutover and cleanup, a drill run without --instance drills the frozen legacy instance and passes.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 ingress | approved two-step reopen (D2) | same | same |
| R2 phase-1 gating | approved cmek_stage off/prepared/active (D3) | same | same |
| R3 drill source | literal mutaba3a-pg until the cleanup PR | without --instance, read `terraform output -raw cloud_sql_instance_name` (as db.sh does); dry-run prints a placeholder; test for both | literal default plus a runbook warning |
Header: Drill source
Options:
A) Follow Terraform's active (recommended)
Without --instance the drill reads terraform output cloud_sql_instance_name, so it always drills the live instance; dry-run shows <active instance>. Tests in restore-drill.test.ts. (human: ~1h / CC: ~10 min)
B) Literal plus warning
Keep the literal default; the runbook §8 says to pass --instance mutaba3a-pg2 after the cutover until the cleanup PR lands.
State: approved
Actual answer: A "Follow Terraform's active" (D4, 2026-10-21)
Accepted scope: without --instance, restore-drill.sh reads `terraform output -raw cloud_sql_instance_name` (new output) the way db.sh reads its outputs; --dry-run prints `<active instance>` and calls nothing; --instance still overrides. Tests in restore-drill.test.ts: dry-run shows the placeholder; a fake terraform on PATH returning mutaba3a-pg2 makes the source mutaba3a-pg2; the existing refusal of drill-named sources stays.
History: none

- C4 (Code quality, confidence 8): once `cmek-cutover.sh cutover` has closed ingress, it reopens ingress on the old instance **on every exit path** (an EXIT trap: failed backup, failed restore, key check, size check, count mismatch, Ctrl-C), until it has printed the switch apply. This is the drill's "on every exit path" rule (`restore-drill.sh:10`) applied to ingress, and part of the approved script's safety. Test: a fake `gcloud` that fails the restore leaves the transcript ending with `--ingress=all` on the old service and a non-zero exit.

## Amendments to the plan (authoritative over the sections above)

1. `db_instance` is replaced by `cmek_stage = off | prepared | active` (R2, D3). Everything new (KMS, the service identity, grants, `mutaba3a-pg2` and its database and user, the bucket `encryption` block) exists only when the stage is not `off`. `local.active_*` follows `mutaba3a-pg2` only at `active`.
2. `api_ingress` variable on the Cloud Run service (R1, D2). The cutover's printed apply passes `-var cmek_stage=active -var api_ingress=INGRESS_TRAFFIC_INTERNAL_ONLY -var image_tag=<live>`. `verify` checks that the serving revision mounts `mutaba3a-pg2` and takes 100% traffic. Then a second apply without `api_ingress` reopens.
3. The drill finds its source through `terraform output -raw cloud_sql_instance_name` when `--instance` is absent (R3, D4).
4. The second instance's settings are written out in full and pinned by test (h) (C1). The cutover checks disk sizes (C2) and reopens ingress on every failure exit (C4).
5. Operator procedure:
   - Step 1 becomes "set `cmek_stage = "prepared"` in production.tfvars, apply".
   - Step 4 becomes "cutover → set `cmek_stage = "active"` → printed apply (internal ingress) → `verify` → apply again (ingress ALL) → smoke".
   - A release between step 1 and step 4 is safe: the outputs still name `mutaba3a-pg`.

## Section 1: Architecture review

- [P1] (confidence 6/10) `server/infrastructure/terraform/main.tf:300` `ingress  = "INGRESS_TRAFFIC_ALL"`: the cutover's one apply reopens ingress in the same update that switches the instance. R1.
- [P2] (confidence 5/10, verify) the restore target must be at least the source's storage size. C2.
- Recorded honestly, not a defect of this plan: CMEK gives no isolation from Malafat's runtime SA, which holds project-wide KMS, storage and SQL roles (`Malafat/.../regional-stack/main.tf:219-235`). This goes in the ADR and a TD entry.

Dispositions: R1 accepted (D2); C2 accepted as part of the approved script (D1).

## Section 2: Code quality review

- [P2] (confidence 7/10) `server/scripts/restore-drill.sh:39` `SOURCE="mutaba3a-pg"`: drills the frozen instance after the cutover. R3.
- [P2] (confidence 7/10) plan item 4's settings factoring can't be expressed in Terraform without renaming bootstrap targets. C1.
- [P2] (confidence 8/10) the cutover's failure paths don't say they reopen ingress. C4.
- Shared code: moving the drill's read-only checks into `lib/db-checks.sh` has two first-party callers (`restore-drill.sh` today, `cmek-cutover.sh` proposed).
  - The contract is the same: read-only counts by table, applied migrations and newest audit event, against one connection.
  - Estimate: about 60–90 lines moved (counted once), about 10 added for sourcing, about 50 net saved against duplicating them in the cutover. Tests grow by the cutover's own cases.
  - Approved with the structure (D1).

Dispositions: R3 accepted (D4); C1, C4 accepted as necessary implementation of D1's arrangement.

## Section 3: Test review

Framework: Vitest for `server/` (`npm --prefix server test`; script tests drive Bash with `--dry-run` and a fake CLI on PATH, as in `deploy-bootstrap.test.ts`). Terraform `terraform test` with mocked providers, run by server-ci (`.github/workflows/server-ci.yml:113-120`).

```
CODE PATHS (proposed)                                      OPERATOR FLOWS
[+] terraform (cmek_stage)                                 [+] Phase 1 (prepared)
  ├── off: no KMS/pg2/bucket encryption   [GAP→cmek.tftest]  ├── [manual] signed-URL upload+download on CMEK bucket
  ├── prepared: KMS+pg2 exist, legacy active [GAP→cmek]      ├── [manual] objects update rewrite, spot-check old receipt
  ├── active: secret/volume/monitoring/outputs → pg2 [GAP]   └── [manual] describe pg2 shows kmsKeyName
  ├── invalid stage refused               [GAP→cmek.tftest]  [+] Rehearse
  ├── api_ingress default ALL / internal / invalid [GAP]     ├── [GAP→cutover.test] never touches ingress
  ├── pg2 settings parity (backups 14, PITR, flags) [GAP]    └── [manual] timings → runbook §10
  ├── grants on the key, none project-wide [GAP→cmek]        [+] Cutover
  └── existing: pool / bucket soft delete / monitoring       ├── [GAP→cutover.test] closes ingress before backup
      [★★★ TESTED] database_pool, attachments_bucket,        ├── [GAP→cutover.test] mutates only mutaba3a-pg2
      monitoring.tftest (database_id mutaba3a-pg :232)       ├── [GAP→cutover.test] count mismatch → reopen + exit≠0, no apply printed
[+] lib/db-checks.sh (moved)                                  ├── [GAP→cutover.test] restore failure → reopen (C4)
  └── [★★ TESTED via restore-drill.test.ts] counts/migrations ├── [GAP→cutover.test] target smaller than source → refuse (C2)
[+] restore-drill.sh                                          ├── [GAP→cutover.test] refuses when pg2 already active
  ├── source from terraform output (R3)  [GAP→drill.test]    ├── [GAP→cutover.test] printed apply carries internal ingress (R1)
  ├── CMEK scratch: --disk-encryption-key [GAP→drill.test]   └── [manual] verify + second apply + smoke (portal, phone, Malafat)
  └── existing scratch-name guard        [★★★ TESTED :67,79] [+] Rollback
[+] cmek-cutover.sh verify                                    └── [manual] cmek_stage=prepared + apply (documented)
  └── /ready, kmsKeyName, active name, 100% traffic [GAP→cutover.test dry-run]
[+] legal-terms.test.ts reads db_retained_backups from main.tf [★★★ TESTED :105], keep the local

COVERAGE: 4/27 paths tested today (the rest are proposed)  |  GAPS: 17 automated, 6 manual operator checks
QUALITY: ★★★:4 ★★:1  |  every GAP above is a planned test in the amended plan
```

Regression rule: existing behavior at risk is (a) the drill's commands and guards, (b) the pool, bucket and monitoring Terraform contracts, and (c) `legal-terms.test.ts`'s read of `main.tf`. The contract is that the existing tests stay green unchanged, except `monitoring.tftest.hcl:232`, which keeps its assertion for stage off/prepared and gains one case for active. This is required proof of the approved arrangement (D1), not a new choice.

Tests made obsolete: none.

Dispositions: all GAP rows are required proof of approved decisions D1–D4. No pending test choices.

## Section 4: Performance review

No issues found.
- Cloud SQL CMEK has no per-query cost.
- GCS with a default KMS key calls KMS on object writes and reads, at pilot volume (receipts, tens a day [estimated]). That is far under the default KMS quota and costs pennies.
- The bucket rewrite is a one-time pass over all objects. Pilot data is small (unknown count; measure with `gcloud storage du` before step 2).

## Outside voice

Unavailable. Codex isn't installed, and the native Plan-subagent fallback produced no complete report within the five-minute limit, so it was stopped. No outside coverage and no clean-review credit.

### R4: Day-14 cleanup of the legacy instance
Finding: TODO, P3, confidence 9, plan "Operator procedure" step 6, reviewer Claude (Final planning)
Plan baseline: step 6 lists a separate cleanup ticket, "filed at the end of planning".
Runtime evidence: none (future work). The project tracks follow-ups in Jira MUT; TODOS.md is not where MUT follow-ups live.
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R4 cleanup tracking | named, not filed | Jira MUT Task under MUT-322, blocked by MUT-381 | TODOS.md entry | not tracked |
Header: Cleanup follow-up
Options:
A) Jira follow-up (recommended)
File a MUT Task under MUT-322, blocked by MUT-381: after 14 days at cmek_stage=active, turn off deletion_protection on mutaba3a-pg and remove it with its database and user, set BOOTSTRAP_TARGETS to the pg2 addresses (+ deploy-bootstrap.test.ts), drop the prepared/legacy branches, run the restore drill against mutaba3a-pg2 (MUT-327).
B) TODOS.md entry
The same content as a TODOS.md item instead of a ticket.
C) Skip
Don't track it; rely on the runbook line.
State: approved
Actual answer: A "Jira follow-up" (D5, 2026-10-21)
Accepted scope: file one MUT Task under MUT-322, linked "is blocked by MUT-381", with the steps in option A. No code in this PR.
History: none

Approval readiness: PASS. Checked R1 (D2), R2 (D3), R3 (D4), R4 (D5), structure (D1); C1–C4 are necessary implementation of D1's approved arrangement.

## NOT in scope

- Secret Manager CMEK, and encrypting the Terraform state bucket: the ticket covers Cloud SQL and the bucket only.
- Postgres RLS, operator-access controls, and the GCP project split from Malafat: the user left these out of the privacy intake (2026-10-21). Malafat's project-wide roles go in a TD entry.
- KMS Data Access audit logs (D4): project-wide, and they would also log Malafat's tenant-key decrypts.
- Field-level and end-to-end encryption: decided against on 2026-10-21.
- The day-14 legacy cleanup: a separate Jira task (R4, D5).

## What already exists

- Restore tooling: `restore-drill.sh` (scratch-name guard `:118`, timings, teardown on every exit path), reused through `lib/db-checks.sh` (D1).
- Ingress close and reopen commands: `pilot-runbook.md` §4.3, reused by `cmek-cutover.sh`.
- Terraform outputs read by the scripts: `deploy.sh:105-106` and `db.sh:100-101` (`local_database_url`, `cloud_sql_connection_name`), which now follow `cmek_stage`.
- Offline `terraform test` with mocked providers: `tests/*.tftest.hcl`, run in server-ci (`server-ci.yml:113-120`).
- Malafat's KMS pattern (`regional-stack/main.tf:201`): we copy the key ring's shape, not its project-wide grant.

## Diagram: cutover flow

```
off ──(tfvars: prepared, apply)──▶ prepared ──rehearse──▶ prepared (timings)
                                       │
                                cutover (ingress internal)
                                       │  on-demand backup(pg) ─▶ size check ─▶ restore → pg2 ─▶ key check ─▶ counts(pg) == counts(pg2)?
                                       │        any failure / mismatch ──▶ reopen ingress on pg, exit≠0 (C4)
                                       ▼
                     tfvars: active; apply (api_ingress internal) ─▶ verify (pg2 serves 100%, kmsKeyName, /ready)
                                       ▼
                     apply (ingress ALL) ─▶ smoke ─▶ day 14: cleanup task (R4)
rollback before the second apply: tfvars prepared + apply (writes to pg2 since the switch are lost)
```

## Failure modes

| Path | Realistic failure | Covered by | User sees |
|---|---|---|---|
| Phase 1 apply | Cloud SQL agent lacks the key grant, so pg2 creation fails | `depends_on` the grant; the apply fails loudly; prod untouched | nothing (legacy keeps serving) |
| Bucket default key | GCS agent can't use the key, so uploads fail | `depends_on` the grant; §6d step 2 checks right after the apply | a receipt upload error on the portal, caught in step 2 |
| Cutover restore | restore or size error mid-window | C2 precheck; C4 trap reopens ingress; cutover.test cases | brief downtime, then the old service is back |
| Count mismatch | a row written after the backup, or a partial restore | count compare; reopen; exit≠0 | brief downtime, no data loss |
| Switch apply | traffic hits the old revision | R1: ingress stays internal until verify | none |
| Key version disabled later | API and receipts down | runbook §5 line; `prevent_destroy`; 30-day destroy delay | an outage until it's re-enabled (loud) |

Critical gaps: none (no row is silent and untested with no handling).

## Worktree parallelization strategy

| Step | Modules touched | Depends on |
|---|---|---|
| Terraform (stage, KMS, pg2, ingress, tests) | server/infrastructure/terraform | — |
| Scripts (db-checks, drill, cutover + tests) | server/scripts, server/src/scripts/__tests__ | Terraform output name `cloud_sql_instance_name` (agree first) |
| Docs (ADR-162, TD, DEPLOYMENT §6d, runbook, INFRA) | .claude, server/DEPLOYMENT.md, docs/operations | both above |

Sequential implementation, no parallelization opportunity worth a second worktree. The two code lanes share the output contract, and the whole job is about 1.5 CC-hours.

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **T1 (P1, human: ~3h / CC: ~20min)** — terraform — add `cmek_stage` with KMS, service identity, key grants, `mutaba3a-pg2`, the bucket encryption block, and `local.active_*` wiring
  - Surfaced by: Scope Challenge R2 (D3); C1
  - Files: server/infrastructure/terraform/{versions.tf,main.tf,kms.tf,variables.tf,outputs.tf,monitoring.tf}
  - Verify: `terraform init -backend=false && terraform test`
- [ ] **T2 (P1, human: ~1h / CC: ~10min)** — terraform — add the `api_ingress` variable on the Cloud Run service
  - Surfaced by: Architecture R1 (D2)
  - Files: server/infrastructure/terraform/{main.tf,variables.tf}
  - Verify: `terraform test` (cmek.tftest ingress cases)
- [ ] **T3 (P1, human: ~2h / CC: ~15min)** — terraform tests — `tests/cmek.tftest.hcl`, one run per stage, plus settings parity, grants and invalid values; monitoring.tftest active case
  - Surfaced by: Test review GAP rows
  - Files: server/infrastructure/terraform/tests/{cmek.tftest.hcl,monitoring.tftest.hcl}
  - Verify: `terraform test`
- [ ] **T4 (P1, human: ~2h / CC: ~15min)** — scripts — extract `lib/db-checks.sh`; make the drill CMEK-aware (`--disk-encryption-key`) and take its source from terraform output
  - Surfaced by: Code quality R3 (D4); D1
  - Files: server/scripts/{lib/db-checks.sh,restore-drill.sh}, server/src/scripts/__tests__/restore-drill.test.ts
  - Verify: `npm --prefix server test -- restore-drill`
- [ ] **T5 (P1, human: ~4h / CC: ~25min)** — scripts — `cmek-cutover.sh` rehearse/cutover/verify, with the size precheck, the EXIT-trap reopen and the printed two-step apply
  - Surfaced by: D1; C2; C4; R1
  - Files: server/scripts/cmek-cutover.sh, server/src/scripts/__tests__/cmek-cutover.test.ts
  - Verify: `npm --prefix server test -- cmek-cutover`
- [ ] **T6 (P2, human: ~2h / CC: ~15min)** — docs — ADR-162 (amends ADR-024), TD entry (Malafat's project-wide roles), DEPLOYMENT.md §6d, pilot-runbook §5/§8/§10, INFRA.md rows
  - Surfaced by: Architecture (honest limits); plan items 11–15
  - Files: .claude/DECISIONS.md, .claude/TECH_DEBT.md, server/DEPLOYMENT.md, docs/operations/pilot-runbook.md, .claude/INFRA.md
  - Verify: review; `npm --prefix server test` (legal-terms test still green)
- [ ] **T7 (P3, human: ~10min / CC: ~2min)** — Jira — file the day-14 cleanup task under MUT-322, blocked by MUT-381
  - Surfaced by: Final planning R4 (D5)
  - Files: none
  - Verify: the ticket exists with its link

## Completion summary

- Step 0: Scope Challenge — scope accepted as-is (structure A, D1)
- Reality rows: 9/9 applicable rows emitted, 2 unverified premises (restore keeps the target's key; signed URLs with a default key), both checked in §6d steps 2–3
- Architecture Review: 2 issues found (R1, C2)
- Code Quality Review: 3 issues found (R3, C1, C4)
- Test Review: diagram produced, 17 gaps identified (all now planned tests)
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 1 item proposed to the user (filed as a Jira follow-up, D5)
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex, unavailable (not installed; the native fallback timed out at 5 min)
- Parallelization: 1 lane, 0 parallel / 3 sequential
- Lake Score: 4/4 = answers picking a 10/10 option / answers scored for Completeness

## Suppressed findings (appendix)

- (confidence 4/10) `gcloud sql backups restore --help` says the "Compute Engine Service Agent" needs the key permission; for Cloud SQL CMEK it's the Cloud SQL agent. This is probably generic help text. The rehearsal's key check settles it.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex (native Plan fallback), auto in eng review | Independent 2nd opinion | 1 | unavailable | no complete report in 5 min |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open | 22 issues, 0 critical gaps (all resolved: D1–D5) |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — (infra plan, no UI) |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review phase, unavailable (CLI not installed; the native fallback was stopped at the five-minute limit). No outside findings.
- **VERDICT:** No review CLEAR. Eng review has issues, all mapped to approved tasks T1–T7. Ready to implement against the amended plan.

NO UNRESOLVED DECISIONS
