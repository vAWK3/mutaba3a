# Mutaba3a API (`server/`)

The hosted, organization-scoped financial API that Malafat's Money section calls (MUT/MAL Money v1, Option B — see ADR-024/025 in `../.claude/DECISIONS.md`). Milestone 1 ships the control plane: organizations, API keys with scopes, the Malafat tenant binding, audit, idempotency, rate limiting, and the OpenAPI contract. Milestone 2 adds customers, projects, external references and batch import. Milestone 3 adds VAT rates, fixed-fee agreements with installments, basic retainers and receivables. Milestone 4 adds payments with previewed allocations, reversals, credits against posted receivables and the operations lookup.

The desktop/PWA app in `../src` is unchanged and still works fully offline. This directory is a separate npm package with its own lockfile; nothing from `../src` is imported yet.

## Run locally

```bash
docker run -d --name mutaba3a-test-pg -p 54329:5432 \
  -e POSTGRES_PASSWORD=mutaba3a -e POSTGRES_USER=mutaba3a -e POSTGRES_DB=mutaba3a_test postgres:16-alpine
cp .env.example .env            # DATABASE_URL points at the container
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

## Verify

```bash
npm run typecheck && npm run lint && npm test      # unit + route tests, no database
npm run test:db                                   # adds the Postgres contract tests
npm run openapi:check                             # committed openapi/openapi.yaml matches the code
npm run smoke -- --url http://localhost:8787        # post-deploy checks, also runnable against a dev server
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
- `POST /v1/retainers/preview`, `POST /v1/retainers`, `GET /v1/retainers/{id}/charges`, `POST /v1/retainers/{id}/changes/preview`, `POST /v1/retainers/{id}/changes`, `POST /v1/retainers/{id}/cancel/preview`, `POST /v1/retainers/{id}/cancel`, `POST /v1/retainers/reconcile` — recurring retainers, one charge per service month; effective-dated changes of terms (versions); cancel with FULL / PRORATE / WAIVE and a credit on an already-posted final month
- `POST /v1/allocations/preview`, `POST /v1/payments`, `GET /v1/payments[/{id}]`, `POST /v1/payments/{id}/allocations`, `POST /v1/payments/{id}/reverse`, `POST|GET /v1/receivables/{id}/credits`, `GET /v1/operations/{idempotencyKey}` — payments, allocations, reversals, credits, lost-response lookup
- `GET /v1/receivables[/{id}]` — what is owed, statuses computed in the organization timezone
- `GET /v1/summaries/organization[?currency=]`, `GET /v1/summaries/customers/{id}`, `GET /v1/summaries/projects/{id}` — outstanding split into overdue / due today / not yet due, unallocated, last payment, statuses; computed on read
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
