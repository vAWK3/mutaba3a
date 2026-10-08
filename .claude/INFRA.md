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

Status (2026-10-08): **first production apply in progress.** Project
`malafat-production`, region `me-west1`. The 2026-10-08 run created Cloud SQL
(`mutaba3a-pg`, migrated through M3), both secrets, the service account and
IAM, then Cloud Run rejected the template over the reserved `PORT` env
(fixed the same day; `DEPLOYMENT.md` §2.1). The service exists once
`scripts/deploy.sh` is re-run. Infrastructure is Terraform (ADR-026).
Production only; no staging for now. Nothing builds or migrates inside GCP:
the image is built and pushed from the operator's machine and migrations run
from `server/` through the Cloud SQL Auth Proxy.

### Topology

```
Operator machine                      GCP project (me-west1)
────────────────                      ──────────────────────
docker build + push ───────────────▶  Artifact Registry  <region>-docker.pkg.dev/<project>/mutaba3a/mutaba3a-api:<sha>
prisma migrate deploy ──(proxy)────▶  Cloud SQL Postgres 16  mutaba3a-pg   db mutaba3a, user mutaba3a_api
terraform apply -var image_tag ────▶  Cloud Run service  mutaba3a-api  (min 1, max 1)  ◀── Malafat, Bearer mut_live_…
                                      Secret Manager  mutaba3a-api-database-url, mutaba3a-api-admin-token
                                      Cloud Monitoring  uptime check GET /health (alert optional)
```

| Setting | Production |
|---|---|
| `API_KEY_ENVIRONMENT` | `live` |
| Cloud SQL | `db-g1-small`, REGIONAL, daily backups + PITR 7d, deletion protection |
| Cloud Run instances | min 1 · max 1 (TD-017) |
| Terraform state | `gs://<bucket>/mutaba3a-api/production` |

### Code-defined

- `server/infrastructure/terraform/` — everything on the GCP side of the
  diagram. `image_tag` is the deployed version; `SERVICE_VERSION` reports it on
  `/health`.
- `server/Dockerfile` — the one image.
- `server/scripts/deploy.sh` — the only rollout path; runs on the operator's machine.
- `.github/workflows/server-ci.yml` — verification only; never pushes or deploys.

### Operator-held (not in code, by design)

| Item | Where it lives | Notes |
|---|---|---|
| GCP project id and state bucket | operator's shell (`GCP_PROJECT_ID`, `TF_STATE_BUCKET`) and `production.tfvars` (git-ignored) | **Chosen 2026-10-08: `malafat-production`** (shared project, every resource prefixed `mutaba3a-`; DEPLOYMENT.md §1.1). A dedicated project would be a Terraform re-apply with a new `project_id` plus a data move. |
| Admin token, DB password | Terraform state + Secret Manager | generated; read with `gcloud secrets versions access`; `terraform output -raw local_database_url` for the proxy |
| Firm API keys | shown once by `npm run provision`; stored hashed in `api_keys` | Malafat stores the secret encrypted per tenant |
| Malafat's `malafat-web-mutaba3a-api-url` | Malafat's Secret Manager | the service URL; created by the operator after the first deploy |
| Custom domain `api.mutaba3a.app` | not set up | Cloud Run domain mapping unavailable in `me-west1`; Cloudflare CNAME or external LB later |

### Deployed

| Project | Service URL | Deployed tag | Date |
|---|---|---|---|
| `malafat-production` | — (Cloud Run service not created yet; re-run pending) | `88f0b0d` migrated to the database (M1–M3), image pushed | 2026-10-08 partial, see §2.1 of the runbook |

Update this table after each `deploy.sh` run.

## 3. Costs (estimate, hosted API only)

| Item | Production |
|---|---|
| Cloud SQL | ~$50–60/mo (`db-g1-small`, REGIONAL) |
| Cloud Run | ~$10–15/mo (1 min instance, 512Mi, cpu idle) |
| Secret Manager, Artifact Registry, uptime check | < $1/mo |

ADR-005's "zero server costs" still holds for the desktop/PWA; the hosted API
is the first paid infrastructure and exists only for firms that connect from
Malafat (ADR-024).
