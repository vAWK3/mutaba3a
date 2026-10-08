# Mutaba3a API (`server/`)

The hosted, organization-scoped financial API that Malafat's Money section calls (MUT/MAL Money v1, Option B — see ADR-024/025 in `../.claude/DECISIONS.md`). Milestone 1 ships the control plane: organizations, API keys with scopes, the Malafat tenant binding, audit, idempotency, rate limiting, and the OpenAPI contract. Financial resources arrive in M2–M6.

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

CI (`.github/workflows/server-ci.yml`) runs all of the above, the Postgres
contract suite, both Docker image builds and `terraform validate` on every
change under `server/`.

## API shape

- `GET /health`, `GET /ready`
- `GET /v1/integration` — validate the key; organization, masked key, scopes, missing scopes, binding, server version
- `POST /v1/integration/bind` — bind to a Malafat tenant (requires `Idempotency-Key`)
- `POST /v1/integration/disconnect` — disconnect and revoke the calling key; history preserved
- `POST /admin/v1/organizations`, `GET /admin/v1/organizations/{id}`, `POST …/{id}/api-keys`, `POST /admin/v1/api-keys/{id}/revoke`, `GET …/{id}/audit` — operator only, `X-Admin-Token`
- `GET /openapi.json` — the live contract; `openapi/openapi.yaml` is the committed copy

Errors are always `{"error":{"code","message","details?","requestId"}}`; codes are listed in `src/errors.ts` and in the OpenAPI description.

## Deploy (operator runs these; nothing here deploys itself)

Infrastructure is Terraform (`infrastructure/terraform/`: Cloud SQL 16, Cloud
Run service + migration job, Secret Manager, service account, Artifact
Registry, uptime check) and the rollout is one script:

```bash
GCP_PROJECT_ID=<project> TF_STATE_BUCKET=<bucket> ./scripts/deploy.sh staging
```

It builds both images with Cloud Build, runs `prisma migrate deploy` as a Cloud
Run job, rolls the service, and runs `npm run smoke`. Staging runs with
`API_KEY_ENVIRONMENT=test`, production with `live`, so keys can never cross
environments. The step-by-step runbook, including provisioning the first firm
and wiring Malafat, is **[DEPLOYMENT.md](./DEPLOYMENT.md)**.
