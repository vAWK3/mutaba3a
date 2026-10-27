# Mutaba3a API (`server/`)

The hosted, organization-scoped financial API that Malafat's Money section calls (MUT/MAL Money v1, Option B — see ADR-024/025 in `../.claude/DECISIONS.md`). Milestone 1 ships the control plane: organizations, API keys with scopes, the Malafat tenant binding, audit, idempotency, rate limiting, and the OpenAPI contract. Milestone 2 adds customers, projects, external references and batch import. Milestone 3 adds VAT rates, fixed-fee agreements with installments, basic retainers and receivables. Milestone 4 adds payments with previewed allocations, reversals, credits against posted receivables and the operations lookup.

The desktop/PWA app in `../src` is unchanged and still works fully offline. This directory is a separate npm package with its own lockfile; nothing from `../src` is imported yet.

## Run locally

```bash
docker run -d --name mutaba3a-test-pg -p 54329:5432 \
  -e POSTGRES_PASSWORD=mutaba3a -e POSTGRES_USER=mutaba3a -e POSTGRES_DB=mutaba3a_test postgres:16-alpine
cp .env.example .env            # DATABASE_URL points at the container
# real secrets in place of the replace-with-… placeholders, which the server refuses (MUT-472)
perl -pi -e 's/replace-with-\S+/my $s = qx(openssl rand -hex 32); chomp $s; $s/ge' .env
npm install                     # .npmrc sets legacy-peer-deps (npm 10.9 arborist bug with zod 4 peers)
npm run prisma:migrate:deploy
npm run dev                     # http://localhost:8787
```

Provision a firm and its first key (the secret prints once):

```bash
MUTABA3A_ADMIN_TOKEN=$(grep MUTABA3A_ADMIN_TOKEN .env | cut -d= -f2) \
  npm run provision -- --name "Sader Law Firm" --currency ILS --timezone Asia/Jerusalem
```

Then from Malafat, Settings › Money & Mutaba3a › Connect, paste the secret.

Give a person access to the hosted portal (MUT-37). Users are operator-issued
only: there is no signup, invite or "forgot password" anywhere. Since MUT-235
(ADR-088) the operator never handles a password: `provision:user` and
`rotate:password` print a one-time **setup link** once, on its own line (72 hours;
`--valid-hours 1–720`). Send it over a secure channel. The person opens it, sets
their own password (12–128 characters) on the portal's `/setup` page (MUT-236),
then signs in on the portal or the app. The link points at `PORTAL_ORIGIN` when it is set; otherwise at the
host you called, always over https except on `localhost`/`127.0.0.1`/`[::1]`, so a LAN or docker-compose
development host needs `PORTAL_ORIGIN` set to its plain-http origin:

```bash
export MUTABA3A_ADMIN_TOKEN=$(grep MUTABA3A_ADMIN_TOKEN .env | cut -d= -f2)
npm run provision:user -- --email nour@firm.ps --name "Nour Haddad" --organization-id <uuid> --locale ar
npm run provision:user -- --email solo@me.ps --name "Solo" --currency ILS --timezone Asia/Jerusalem   # no firm (MUT-120)
npm run grant:user -- --email nour@firm.ps --organization-id <another uuid>   # a second firm
npm run revoke:user -- --email nour@firm.ps --organization-id <uuid>
npm run rotate:password -- --email nour@firm.ps                               # reset: a new link; their current password works until it is used
npm run rotate:password -- --email nour@firm.ps --lock                        # suspected takeover: the password and every session stop now
npm run disable:user -- --email nour@firm.ps                                  # enable:user undoes it
```

Every user is created with exactly one personal profile (`Personal` / `شخصي`, MUT-120); with no
`--organization-id`, `--currency` and `--timezone` set it. A personal profile is never shared,
issued an API key or bound to Malafat.

Sign a person out everywhere: `npm run revoke:sessions -- --email nour@firm.ps`
(an operator reset or a disable does this too).

**Seed a demo account (MUT-136).** The iOS app (`mutaba3a-flutter`) needs a
hosted account that looks populated for App Store screenshots. Against a
*local* dev server only, get-or-create `qa@mutaba3a.test` (a personal profile,
no firm) and fill it with 8 realistic clients/projects and a spread of
received/owed/settled/overdue income, plus expenses — every date is relative
to "now", so it's never future-dated (ADR-038) no matter when you run it:

```bash
export MUTABA3A_ADMIN_TOKEN=$(grep MUTABA3A_ADMIN_TOKEN .env | cut -d= -f2)
npm run seed:demo-account
```

Safe to re-run: the account is reused (its password is rotated fresh every
run and printed once at the end — sign in with the latest one — unless
`MUTABA3A_SEED_PASSWORD` holds the current one, see below), and every write carries a deterministic Idempotency-Key, so a same-day
re-run replays instead of duplicating. A later re-run reuses the same
customers/projects and just adds another batch of recent-looking transactions.

**Store-review account.** App Store and Play reviewers need a populated
account in the environment the store build talks to (the build's
`MUTABA3A_API_BASE_URL`). Use the same script against that URL with a
dedicated address, and enter the printed password in App Store Connect
(App Review Information › Sign-in required) and Play Console (App content ›
App access):

```bash
export MUTABA3A_ADMIN_TOKEN=$(gcloud secrets versions access latest \
  --secret=mutaba3a-api-admin-token --project=$GCP_PROJECT_ID)
npm run seed:demo-account -- --url "$URL" --email review@mtb3a.com --name "App Review"
```

To refresh its data later **without** breaking the credentials you handed out
(a rotation also signs the reviewer out), pass the current password back:
`MUTABA3A_SEED_PASSWORD='<current>' npm run seed:demo-account -- --url "$URL" --email review@mtb3a.com`.
A wrong value fails without touching the account. Pass the address the existing
account actually has: a different `--email` creates a second account with a new
password. An account created before MUT-387 may still use the old, unowned
`mutaba3a.app` domain; keep using its address until the stored email is migrated
(see MUT-359), then hand the reviewers the new one.

Every script takes `--url` (default `http://localhost:8787`). Password hashing
is argon2id; `ARGON2_MEMORY_KIB` / `ARGON2_TIME_COST` / `ARGON2_PARALLELISM`
default to OWASP profile 1 and the service refuses to start below it.

**Sessions (MUT-38).** `POST /v1/sessions` signs a person in and sets an
httpOnly, `SameSite=Strict` cookie on the API's own origin (`__Host-mut_session`;
plain `mut_session` without `Secure` only when `NODE_ENV=development`). The
service needs `SESSION_TOKEN_PEPPER` (≥ 32 characters) to boot — add it to an
existing `.env`. Session calls to organization-scoped routes send
`X-Mutaba3a-Profile: <organizationId>`; `GET /v1/me` lists the profiles a
person may open and the currency codes this server accepts (`currencies`,
MUT-280). Try it locally:

```bash
curl -si -c /tmp/jar -H 'origin: http://localhost:8787' -H 'content-type: application/json' \
  -d '{"token":"<the part of the setup link after #>","password":"a-password-you-choose"}' http://localhost:8787/v1/account-setup
curl -si -c /tmp/jar -H 'origin: http://localhost:8787' -H 'content-type: application/json' \
  -d '{"email":"nour@firm.ps","password":"a-password-you-choose"}' http://localhost:8787/v1/sessions
curl -s -b /tmp/jar http://localhost:8787/v1/me
```

**Expenses (MUT-42).** A hosted profile's own record, written by the signed-in
person and reachable by sessions only: `/v1/expenses*` (with receipts, in the
attachments bucket under `org/{id}/expense-receipts/`), `/v1/expense-categories*`
(the first list seeds a preset) and `/v1/summaries/expenses?from&to` (per
currency). Malafat's key can't reach any of it, and expense activity is left out
of `GET /v1/audit` and `GET /v1/operations/{key}`.

**Receipts library (MUT-255).** `/v1/receipts*`, hosted only and sessions only: a receipt uploaded with no expense
waits as To review on its profile, is listed and counted, and `POST /v1/receipts/{id}/approve` records its expense
and files it in one transaction. The operator reads how often people change what the reader suggested at
`GET /admin/v1/receipts/edit-rates?from&to`. ADR-167.

## Verify

```bash
npm run typecheck && npm run lint && npm test      # unit + route tests, no database
npm run test:db                                   # adds the Postgres contract tests
npm run openapi:check                             # committed openapi/openapi.yaml matches the code
npm run smoke -- --url http://localhost:8787        # post-deploy checks, also runnable against a dev server
npm run db:migrate:status                         # pending migrations: local with DATABASE_URL, production through the Cloud SQL proxy with TF_STATE_BUCKET
```

End-to-end, against a dev or staging database (both scripts create throwaway
organizations, which are never deleted):

```bash
MUTABA3A_ADMIN_TOKEN=… E2E_BASE_URL=http://localhost:8787 MALAFAT_WEB_DIR=../../malafat/crm-platform/apps/web \
  npx tsx e2e/money-v1.e2e.mts                      # Malafat's client driving every Money v1 flow (84 checks)
E2E_DATABASE_URL=postgresql://… npx tsx e2e/attachments.e2e.mts   # attachments on Postgres with in-memory storage (34 checks)
```

CI (`.github/workflows/server-ci.yml`) runs all of the above, the Postgres
contract suite, the Docker image build and `terraform validate` on every
change under `server/`. It never pushes or deploys.

## API shape

- `GET /health`, `GET /ready`
- `GET /v1/integration` — validate the key; organization, masked key, scopes, missing scopes, binding, server version
- `POST /v1/integration/bind` — bind to a Malafat tenant (requires `Idempotency-Key`)
- `POST /v1/integration/disconnect` — disconnect and revoke the calling key; history preserved
- `POST /v1/customers`, `GET /v1/customers[?status=&externalId=&limit=&cursor=]`, `GET|PATCH /v1/customers/{id}`, `POST /v1/customers/{id}/archive` — M2; `PATCH` needs `If-Match: <version>`
- `POST /v1/projects`, `GET /v1/projects[?customerId=&currency=&status=&externalId=…]`, `GET|PATCH /v1/projects/{id}`, `POST /v1/projects/{id}/archive` — one currency per project, locked once anything is posted
- `POST /v1/import/preview`, `POST /v1/import/commit` — batch link of an external system's customers and projects (≤ 500 rows; commit needs the preview's `previewToken`)
- `GET /v1/vat-rates`, `PUT /v1/settings/vat` — the firm's effective-dated standard rate (basis points)
- `POST /v1/agreements/preview`, `POST /v1/agreements`, `GET /v1/agreements[/{id}]`, `POST /v1/agreements/{id}/supplements`, `POST /v1/agreements/{id}/cancel`, `POST /v1/installments/{id}/trigger` — fixed-fee agreements; VAT treatment per item; installments post immediately, on a date, or manually; due dates from payment terms (default end of month)
- MUT-100: the same `POST /v1/agreements(/preview)` with `contingency { commissionRateBasisPoints, upfrontTreatment }` creates a CONTINGENCY agreement (upfront in `amount`, ₪0 allowed); `PATCH /v1/agreements/{id}/contingency` (If-Match) changes the terms before the outcome; `POST /v1/agreements/{id}/outcome/preview`, `/outcome` and `/outcome/correct` record the outcome — AWARDED posts one commission installment on the outcome date at the VAT rate in force then, NO_RECOVERY posts nothing, a correction credits the old commission in full while it is unpaid (ADR-059)
- `POST /v1/fee-proposals`, `GET /v1/fee-proposals[/{id}]`, `POST /v1/fee-proposals/{id}/approve`, `POST /v1/fee-proposals/{id}/withdraw` — propose a fee on a project (one open per project), then approve (creates the agreement in the same transaction) or withdraw; MUT-107: both routes take the same optional `contingency { commissionRateBasisPoints, upfrontTreatment }` to propose and approve a CONTINGENCY deal (upfront in `amount`, ₪0 allowed); approve's `schedule` is optional, required only when the agreed amount is `> 0` (422 `SCHEDULE_REQUIRED`, also for FIXED); the proposal's `contingency` always reflects what was proposed, never an approval's override — the created agreement carries the agreed terms (ADR-060)
- `POST /v1/retainers/preview`, `POST /v1/retainers`, `GET /v1/retainers/{id}/charges`, `POST /v1/retainers/{id}/changes/preview`, `POST /v1/retainers/{id}/changes`, `POST /v1/retainers/{id}/cancel/preview`, `POST /v1/retainers/{id}/cancel`, `POST /v1/retainers/reconcile` — recurring retainers, one charge per service month; effective-dated changes of terms (versions); cancel with FULL / PRORATE / WAIVE and a credit on an already-posted final month
- `POST /v1/allocations/preview`, `POST /v1/payments`, `GET /v1/payments[/{id}]`, `POST /v1/payments/{id}/allocations`, `POST /v1/payments/{id}/reverse`, `POST|GET /v1/receivables/{id}/credits`, `GET /v1/operations/{idempotencyKey}` — payments, allocations, reversals, credits, lost-response lookup
- `GET /v1/receivables[/{id}]` — what is owed, statuses computed in the organization timezone
- `GET /v1/fx-rates?base=` — MUT-228: ECB reference rates (via Frankfurter, `FX_RATES_URL`) for every supported currency against `base`; JOD from its USD peg (`USD_PEGS`, ADR-098; the Gulf currencies were removed by MUT-388, ADR-166), every pair through USD; sessions and device sessions only, display only, cached per instance (`FX_RATES_TTL_MINUTES`); 503 `FX_RATES_UNAVAILABLE` when there is nothing to serve (ADR-087)
- `GET /v1/entries[?profileId=&profileId=&limit=&cursor=]` — MUT-270: one newest-first feed (by when logged) of expenses, received payments, Owed entries and conversions across every profile you belong to, or the `profileId`s named (404 outside your memberships); sessions and device sessions only, no `X-Mutaba3a-Profile`, never lazy-posts (ADR-093)
- `GET /v1/summaries/organization[?currency=]`, `GET /v1/summaries/customers/{id}`, `GET /v1/summaries/projects/{id}` — outstanding split into overdue / due today / not yet due, unallocated, last payment, statuses, and per customer and currency the oldest overdue due date with its days overdue (MUT-482); computed on read
- `GET /v1/audit?entityType=&entityId=&action=` — the organization's financial history (API keys with `audit:read`)
- `POST /v1/attachments/uploads`, `POST /v1/attachments/{id}/complete`, `GET /v1/attachments?customerId=|projectId=|paymentId=`, `GET /v1/attachments/{id}/download`, `DELETE /v1/attachments/{id}` — invoices and receipts behind short-lived signed URLs (needs `ATTACHMENTS_BUCKET`; otherwise 503 `ATTACHMENTS_NOT_CONFIGURED`)
- `POST /admin/v1/organizations`, `GET /admin/v1/organizations/{id}`, `POST …/{id}/api-keys`, `POST /admin/v1/api-keys/{id}/revoke`, `GET …/{id}/audit` — operator only, `X-Admin-Token`
- `GET /openapi.json` — the live contract; `openapi/openapi.yaml` is the committed copy

Errors are always `{"error":{"code","message","details?","requestId"}}`; codes are listed in `src/errors.ts` and in the OpenAPI description.

## Attachments bucket (operator)

Terraform creates a private bucket (`<project>-mutaba3a-attachments`) and gives
the API's service account object access plus `iam.serviceAccountTokenCreator`
on itself, which is how V4 signed URLs are minted without a key file. The
bucket name reaches the service as `ATTACHMENTS_BUCKET`; without it the
attachments routes answer 503 and everything else works. Locally, set
`ATTACHMENTS_BUCKET` to any bucket your `gcloud auth application-default
login` identity can write to, or leave it unset.

## Scheduled reconcile (operator)

Charges and dated installments post lazily on reads. For organizations nobody
reads for a while, run the reconcile on a schedule (Cloud Scheduler → Cloud Run
job, or cron on any host with `DATABASE_URL`):

```bash
npm run reconcile            # every organization, in its own timezone; idempotent
npm run reconcile -- --dry   # list organizations and "today" per timezone, post nothing
```

Daily at 00:30 in the firms' timezone is enough; running it hourly is harmless.

## Database through the Cloud SQL proxy (operator)

`scripts/db.sh` opens the Cloud SQL Auth Proxy on 127.0.0.1:5440 for one
command and closes it afterwards; the connection name and URL come from
`terraform output`, so only `TF_STATE_BUCKET` is needed (and a gcloud
application-default login with `roles/cloudsql.client`):

```bash
TF_STATE_BUCKET=<project>-terraform-state npm run db:migrate:status   # what is pending (read-only)
TF_STATE_BUCKET=<project>-terraform-state npm run db:migrate          # prisma migrate deploy, forward-only
TF_STATE_BUCKET=<project>-terraform-state npm run db:psql             # interactive psql
TF_STATE_BUCKET=<project>-terraform-state npm run db:proxy            # proxy up until Ctrl-C, for other tools
```

`scripts/deploy.sh` runs the same migration as its own step, so a normal
release needs none of these; they are for checking before a release, for
migrating ahead of a roll, and for day-2 work. With `DATABASE_URL` set the
same commands run against a local database with no proxy.

## Deploy (operator runs these; nothing here deploys itself)

Infrastructure is Terraform (`infrastructure/terraform/`: Cloud SQL 16, Cloud
Run service, Secret Manager, service account, Artifact Registry, uptime
check) and the rollout is one script that runs on your machine, like Malafat's
`pnpm release`:

```bash
GCP_PROJECT_ID=<project> TF_STATE_BUCKET=<bucket> ./scripts/deploy.sh
```

It builds the image with your Docker daemon and pushes it, runs
`prisma migrate deploy` from here through the Cloud SQL Auth Proxy, applies
Terraform with the new tag, and runs `npm run smoke`. Production only for now;
it issues `live` keys. The step-by-step runbook, including provisioning the
first firm and wiring Malafat, is **[DEPLOYMENT.md](./DEPLOYMENT.md)**.
