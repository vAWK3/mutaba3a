# Money v1 (MUT/MAL) — handover and operator checklist

- **Updated:** 2026-10-10 (first written 2026-10-08 for M1–M6).
- **Code:** Milestones 1–8 are merged to `main` and pushed in both repositories: Mutaba3a `e7754f3` (API `1.7.0-m8`), Malafat `1477e55f5` (vendored contract `1.7.0-m8`). The `claude/stoic-ritchie-d6yiog` and `feature/money-v1-m8` branches and worktrees are gone.
- **Deployed:**
  - **Mutaba3a server:** deployed by the owner; a redeploy from `main` (M8) was under way on 2026-10-10.
  - **Malafat production:** `web@2.2.2` (`f21fabada`, 2026-10-10 10:51 +03) carries **M1–M7** (contract `1.6.0-m7`) but **not M8**.
- **Pilot:** the pilot firm was onboarded on 2026-10-10. Its organization and API key are provisioned, it is connected in Malafat, its clients and matters are linked, and real payments are recorded. The manual runbook (§4) has **not** been walked yet.

## 1. Review and merge — done

Both repositories carry M1–M8 on `main`. The Mutaba3a CI (`server-ci.yml`) runs unit and Postgres contract tests, the OpenAPI check, the Docker build and `terraform validate`.

## 2. Ship M8 to both sides together

M8 changed the fee-proposal API without keeping the old shape. Malafat `web@2.2.2` (M7) talking to Mutaba3a M8 breaks **only the fee-proposal actions** on a matter's Money tab:

- `POST /v1/fee-proposals/{id}/agree` no longer exists, so it returns 404.
- `POST /v1/fee-proposals/{id}/approve` now creates the agreement and expects M8's body (amount, `approvedOn`, schedule). M7's client-approval call fails validation.
- An agreement created from a proposal (`feeProposalId`) is no longer accepted on the agreements route.
- Proposals now come back as `APPROVED`, a status the M7 proposal card does not render.

Everything else keeps working: overview, clients, agreements, payments, allocation and documents. M8's response changes are additive, and Malafat's client casts responses without strict validation.

**Rule:** run the Malafat release that carries `1477e55f5` right after the Mutaba3a M8 deploy. Until it lands, Partners should not act on fee proposals.

### 2a. Check which M7 migration production ran (before or right after the M8 deploy)

M8 **edited the M7 migration in place** (D20, on the premise that nothing was deployed). The original M7 (`acb1144`) was on `main` from 2026-10-09 04:46 UTC until `227c005` on 2026-10-10 14:31 +03. A database that applied the original keeps it: `prisma migrate deploy` skips migrations it has already recorded and does not re-run an edited one.

```bash
cd server && TF_STATE_BUCKET=<bucket> npm run db:psql
```

```sql
SELECT enum_range(NULL::"FeeProposalStatus");
SELECT status, count(*) FROM fee_proposals GROUP BY 1;
```

- `{PROPOSED,APPROVED,WITHDRAWN}`: the database has the M8 shape and nothing to do.
- `{PROPOSED,CLIENT_APPROVED,AGREED,CONVERTED,WITHDRAWN}`: the database has the **original** M7. M8 cannot write `APPROVED`, so approving a proposal fails with a Postgres enum error, and reading any proposal in a removed status fails too. A forward repair migration is needed. It must add `APPROVED`, map or refuse rows in the removed statuses, recreate the enum without them, and drop `agreedOn`/`agreedNote`. It is **not written yet**. Until it ships, nobody should approve a proposal.

## 3. Mutaba3a deployment runbook

`server/DEPLOYMENT.md` has the full runbook.

1. **Check what is pending (optional, read-only):** `TF_STATE_BUCKET=<bucket> npm run db:migrate:status`. This lists unapplied migrations only; it does not catch §2a.
2. **One command does the release:** from `server/` on a clean `main`, `GCP_PROJECT_ID=<project> TF_STATE_BUCKET=<bucket> ./scripts/deploy.sh`.
   - It builds and pushes the image tagged with the short SHA, runs `prisma migrate deploy` through the Cloud SQL proxy, applies the full Terraform plan and smoke-tests the service.
   - The plan includes the private attachments bucket (`<project>-mutaba3a-attachments`) and its IAM, plus `ATTACHMENTS_BUCKET` / `ATTACHMENTS_URL_TTL_SECONDS` (default 900).
   - Nothing is destroyed. Answer **yes** twice, or set `AUTO_APPROVE=1`.
3. **If the migration step fails:** the service is not rolled. Fix, commit and re-run, or migrate by hand with `TF_STATE_BUCKET=<bucket> npm run db:migrate`. `npm run db:psql` opens psql through the same proxy.
4. **Scheduled reconcile — confirm it exists.** Run `npm run reconcile` daily around 00:30 Asia/Jerusalem via Cloud Scheduler → Cloud Run job, or cron. Without it, dated installments and retainer charges post lazily on the first read of the day. That is correct, but an idle firm's overview figures lag.
5. **Optional staging e2e:** run the two scripts from `server/README.md` "Verify" against a staging URL and database. They create organizations that are never deleted, so never run them against production.

## 4. Malafat deployment and the pilot

1. **M1 tenant migration.** The pilot's working connection proves `20261008_money_integration` ran on the pilot tenant. `scripts/release-steps.ts` still lists "Apply the Money v1 M1 migration … to all tenants" as open. Confirm with `pnpm db:update_tenants`, which is idempotent, so every tenant has `money_integrations`. Until a tenant has it, its Money settings page fails with Prisma P2021.
2. **`MUTABA3A_API_URL`** is mounted from the `malafat-web-mutaba3a-api-url` secret (it exists). Each tenant's API key is entered by its Partner in Settings › Money & Mutaba3a and encrypted with the tenant DEK (ADR-150).
3. **Release M8** (§2): the next `pnpm release` from `main` ships `1477e55f5` along with the other unreleased commits.
4. **Pilot runbook — still to do.** Walk `.claude/TEST_PLAN.md` "Still manual (runbook)" for M3–M8:
   - record, reverse and correct a payment
   - RTL check of the Allocate table
   - forced connection drop
   - documents upload, download and delete
   - Money card visibility
   - overview strip vs rows
   - approve and withdraw a proposal (after §2a)

   Do anything that writes on a **test organization**, not on the pilot firm's books, because Mutaba3a never deletes ledger history. MAL-951 (the 375px LTR/RTL pass) fits in the same session.

## 5. Still open

| Ticket | What | Gates |
| --- | --- | --- |
| MUT-56 | Malware scanning before attachments can be downloaded (ADR-028 follow-up) | General availability, not the pilot |
| MAL-950 | Native Arabic and Hebrew review of `money.json` (778 strings per locale) | — |
| MAL-951 | Manual 375px pass of every Money surface in en, ar and he | — |
| MAL-952 | Closing a matter archives its Mutaba3a project; D19 refusal copy finally shown | — |
| MUT-28 | Mutaba3a as an OAuth client of Malafat: staging walk-through outstanding | Not the pilot (API keys) |
| MAL-870 | OAuth scope vocabulary, add-on lapse behaviour, $0 add-on backfill | Not the pilot |
| MAL-150 | Original "simple financial tracker" request: rewrite to the v1 scope or close | — |

Also open, with no ticket:

- **Flutter / mobile:** the `/api/admin/money/*` routes are in `openapi.yaml` (ADR-033); no client work was done.
- **Confluence:** Malafat forbids design briefs in its tree, so all Money briefs live here under `.claude/designs/`. Link them from MAL-939 when convenient.

Decided on 2026-10-10 and no longer open:

- **Attachments:** download-only for the pilot; no scanner gates it (ADR-028).
- **Office Admin:** does not get Money; Partner-only is the rule (ADR-150 addendum).

**Jira (2026-10-10):**

- MUT-25 and MAL-939 are In Progress (pilot), and MAL-939's acceptance criteria are all met.
- Done: MUT-35, MUT-40/41 and MAL-940…943.
- Spikes closed as answered by ADR-024/025/150: MUT-26/27/29/30/31/32 and MAL-869/871.

## 6. What the end-to-end run proved (2026-10-08, Postgres 16, API 1.5.1-m6)

- 84 HTTP checks through Malafat's client, 34 attachment checks in process, a smoke round trip, and reconcile dry and real runs all passed. They passed after two server fixes the run found: a supplement's IMMEDIATE installment never posted, and cancel answered with the wrong shape.
- Security edges exercised:
  - forged and revoked keys
  - narrow scopes per route family
  - cross-organization reads and writes answer 404
  - a tenant cannot bind to a second organization
  - reusing an idempotency key with a different body is refused, and a replay returns the stored outcome
  - a stale `If-Match` is refused
  - forged or stale preview tokens are refused
  - a cancellation that credits a posted month requires the token
  - writes before binding are refused
  - filenames with path separators are refused, and object keys never carry user input
  - signed URLs expire within the configured TTL
  - logs redact credentials
- M8 added e2e 103/103 with Malafat's client against the M8 server (2026-10-10).
