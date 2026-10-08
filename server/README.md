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
```

## API shape

- `GET /health`, `GET /ready`
- `GET /v1/integration` — validate the key; organization, masked key, scopes, missing scopes, binding, server version
- `POST /v1/integration/bind` — bind to a Malafat tenant (requires `Idempotency-Key`)
- `POST /v1/integration/disconnect` — disconnect and revoke the calling key; history preserved
- `POST /admin/v1/organizations`, `GET /admin/v1/organizations/{id}`, `POST …/{id}/api-keys`, `POST /admin/v1/api-keys/{id}/revoke`, `GET …/{id}/audit` — operator only, `X-Admin-Token`
- `GET /openapi.json` — the live contract; `openapi/openapi.yaml` is the committed copy

Errors are always `{"error":{"code","message","details?","requestId"}}`; codes are listed in `src/errors.ts` and in the OpenAPI description.

## Deploy (operator runs these; nothing here deploys itself)

Cloud Run service `mutaba3a-api` in the same region as the Cloud SQL instance; a `mutaba3a` database with a `mutaba3a_api` role; secrets `mutaba3a-api-database-url` and `mutaba3a-api-admin-token` in Secret Manager; a Cloud Run job `mutaba3a-api-migrate` running `npx prisma migrate deploy` before each deploy. Staging runs with `API_KEY_ENVIRONMENT=test`, production with `live`, so keys can never cross environments.
