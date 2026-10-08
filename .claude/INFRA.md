# INFRA.md — Infrastructure State

> **Purpose**: Where Mutaba3a runs, what is code-defined, and what an operator
> has to do by hand. **Rule**: every cloud resource is declared in code; this
> file records the state, not the steps (steps live in `server/DEPLOYMENT.md`).

---

## 1. Desktop / PWA (the product, unchanged by the hosted API)

| Target | Host | Defined in |
|--------|------|------------|
| PWA + landing | Netlify (`mutaba3a.app`) | `netlify.toml` |
| macOS / Windows installers | GitHub Releases, Tauri updater | `.github/workflows/build-windows.yml`, `deploy.sh` (macOS, operator) |

Zero cloud infrastructure; no telemetry; data stays on the device (ADR-001,
ADR-013). See `.claude/CI_CD.md`.

## 2. Hosted API (`server/`) — Money v1

Status (2026-10-08): **deployable, not yet deployed.** Infrastructure is
Terraform (ADR-026); the first apply is an operator step (`server/DEPLOYMENT.md`).

### Topology (one environment)

```
Malafat (Cloud Run, malafat-production, me-west1)
   │  HTTPS, Bearer mut_<env>_<prefix>_<secret>, server-side only
   ▼
Cloud Run service  mutaba3a-api[-staging]      ← image mutaba3a-api:<sha>
   │  unix socket /cloudsql/<connection>        (Cloud SQL connector, IAM)
   ▼
Cloud SQL Postgres 16  mutaba3a-pg[-staging]   db mutaba3a, user mutaba3a_api
   ▲
Cloud Run job  mutaba3a-api-migrate[-staging]  ← image mutaba3a-api-migrate:<sha>
                                                 (prisma migrate deploy, before every rollout)
Secret Manager  mutaba3a-api-database-url[-staging], mutaba3a-api-admin-token[-staging]
Artifact Registry  <region>-docker.pkg.dev/<project>/mutaba3a/
Cloud Monitoring  uptime check GET /health (alert optional)
```

| Setting | Staging | Production |
|---|---|---|
| `API_KEY_ENVIRONMENT` | `test` | `live` |
| Cloud SQL | `db-f1-micro`, ZONAL, no backups, no deletion protection | `db-g1-small`, REGIONAL, daily backups + PITR 7d, deletion protection |
| Cloud Run instances | min 0 · max 1 | min 1 · max 1 (TD-017) |
| Terraform state | `gs://<bucket>/mutaba3a-api/staging` | `gs://<bucket>/mutaba3a-api/production` |

### Code-defined

- `server/infrastructure/terraform/` — everything in the diagram. `image_tag`
  is the deployed version; `SERVICE_VERSION` reports it on `/health`.
- `server/cloudbuild.yaml` — the two images from `server/Dockerfile` targets.
- `server/scripts/deploy.sh` — the only rollout path.
- `.github/workflows/server-ci.yml` — verification only; never deploys.

### Operator-held (not in code, by design)

| Item | Where it lives | Notes |
|---|---|---|
| GCP project id and state bucket | operator's shell (`GCP_PROJECT_ID`, `TF_STATE_BUCKET`) and `*.tfvars` (git-ignored) | Decision pending: dedicated project vs `malafat-production` (DEPLOYMENT.md §1.1). Record the choice here once made. |
| Admin token, DB password | Terraform state + Secret Manager | generated; read with `gcloud secrets versions access` |
| Firm API keys | shown once by `npm run provision`; stored hashed in `api_keys` | Malafat stores the secret encrypted per tenant |
| Malafat's `malafat-web-mutaba3a-api-url` | Malafat's Secret Manager | the service URL; created by the operator after the first deploy |
| Custom domain `api.mutaba3a.app` | not set up | Cloud Run domain mapping unavailable in `me-west1`; Cloudflare CNAME or external LB later |

### Deployed environments

| Environment | Project | Service URL | Deployed tag | Date |
|---|---|---|---|---|
| staging | — | — | — | not yet |
| production | — | — | — | not yet |

Update this table after each `deploy.sh` run.

## 3. Costs (estimate, hosted API only)

| Item | Staging | Production |
|---|---|---|
| Cloud SQL | ~$10/mo (`db-f1-micro`, ZONAL) | ~$50–60/mo (`db-g1-small`, REGIONAL) |
| Cloud Run | ~$0 (scale to zero) | ~$10–15/mo (1 min instance, 512Mi, cpu idle) |
| Secret Manager, Artifact Registry, uptime check | < $1/mo | < $1/mo |

ADR-005's "zero server costs" still holds for the desktop/PWA; the hosted API
is the first paid infrastructure and exists only for firms that connect from
Malafat (ADR-024).
