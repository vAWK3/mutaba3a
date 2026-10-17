# INFRA.md — Infrastructure State

> **Purpose**: Where Mutaba3a runs, what is code-defined, and what an operator
> has to do by hand. **Rule**: every cloud resource is declared in code; this
> file records the state, not the steps (steps live in `server/DEPLOYMENT.md`).

---

## 1. Desktop / PWA (the product, unchanged by the hosted API)

| Target | Host | Defined in |
|--------|------|------------|
| PWA + landing | Netlify (`mutaba3a.netlify.app`; `mutaba3a.app` has no DNS yet, MUT-112) | `netlify.toml` |
| macOS / Windows installers | GitHub Releases, Tauri updater | `.github/workflows/build-windows.yml`, `deploy.sh` (macOS, operator) |
| `/hosted` request form | Netlify Forms (free tier: 100 submissions/month) | `vite.config.ts` `netlifyForms()` emits `__forms.html` (MUT-186) |
| Web CI (lint, typecheck, tests + coverage thresholds) | GitHub Actions, one `ubuntu-latest` job per push/PR, npm cache; Actions minutes only (MUT-24 D2) | `.github/workflows/web-ci.yml` |

> **Public origin (MUT-188).** `MUTABA3A_PUBLIC_ORIGIN` names where the landing is served. The **web** build puts it in the link-preview tags and the `/hosted` canonical; the **hosted** build puts it in the portal sign-in's "No account? Request one" link. Neither pipeline sets it today (Netlify's UI env for web; `server-ci.yml` / `server/scripts/deploy.sh` for hosted), so `DEFAULT_PUBLIC_ORIGIN` in `vite.config.ts` is what ships: the Netlify origin until the custom domain has DNS (MUT-112). A staging override on Netlify alone does not move the portal's link.

**Netlify Forms — operator steps, not settable from `netlify.toml` (MUT-186):**
1. Site → Forms → **Enable form detection**, once, before the deploy that first ships `__forms.html`; otherwise `hosted-request` is never registered and every POST 404s (visitors see the retry state).
2. Site → Forms → `hosted-request` → **Form notifications** → email Basel.
3. After that deploy, send one request from production and confirm the email arrives.
4. **Weekly:** open Forms › `hosted-request` › **Spam**. Akismet-flagged requests land there and no email is sent for them (short Arabic messages are plausible false positives). Mark real ones as verified and reply.
5. Set a Forms **usage alert**, and check what your Netlify plan does once a month's submission allowance (100 on the free tier) runs out, so a spam burst can't quietly block real requests. If spam starts arriving, build the Turnstile follow-up (MUT-197).
6. **Retention (privacy policy promise):** delete submissions older than 12 months from Forms › `hosted-request` **and the matching notification emails in your inbox**, and do the same for any request a visitor asks you to delete (info@malafat.app).

Form data (name, email, optional phone/profession/devices/message, page language, a random request id) plus Netlify's own technical details (IP address, browser) is stored by Netlify, checked by Akismet and emailed; the privacy policy says so. Duplicates of one request (a retry after a timeout, or an "edit and send again" correction) share the same `request-id`.

| `/hosted` link preview | Netlify rewrite `/hosted` → `hosted-offer.html` | `netlify.toml`; `vite.config.ts` `hostedOfferHtml()` emits the page copy with its own Arabic card (MUT-186) |
| Free app's portal sign-in link | Build-time `MUTABA3A_PORTAL_URL` (default: the `mutaba3a-api` Cloud Run URL), injected as `__PORTAL_URL__` in the web build only | `vite.config.ts` `DEFAULT_PORTAL_URL` / `portalUrl()`; `scripts/bundle-origins.json` (MUT-187, ADR-076). Moving the portal (MUT-112) changes both |
| App version a build reports | Build-time `MUTABA3A_APP_VERSION` (x.y.z, else the build fails; default `package.json`'s), injected as `__APP_VERSION__` | `vite.config.ts` `appVersion()`. Unset in release builds; QA builds set it to the version `release-notes.json` describes before the bump (MUT-24, ADR-151) |

**Product analytics (ADR-090, MUT-152).**

| Item | State |
|------|-------|
| Host | PostHog Cloud **EU** (`eu.posthog.com`), project "Mutaba3a" in the Barmajiyat org. Separate from Malafat's project 125127. |
| Status | **Not created yet.** MUT-153 T6 waits on Basel's go. |
| Required settings | Discard client IP (`anonymize_ips`) on. Cookieless server hash mode **on**: without it, every landing event is silently dropped. Autocapture, exception autocapture, web vitals, heatmaps, dead clicks, session recording, console-log capture and surveys off. The test-account filter excludes localhost. |
| Keys | Netlify env `VITE_POSTHOG_KEY` / `VITE_POSTHOG_HOST` for the web build (used by the landing chunk only); the hosted build env for the portal; `--dart-define` for Flutter. |
| Defined in | Operator-defined SaaS, created through the PostHog MCP (D3). TODOS #15 tracks moving it to the PostHog Terraform provider. The event contract is `docs/analytics/events.json`. |

The local app: zero cloud infrastructure; no telemetry; data stays on the device (ADR-001,
ADR-013, ADR-090). See `.claude/CI_CD.md`.

## 2. Hosted API (`server/`) — Money v1

Status (2026-10-11): **in production.** Project `malafat-production`, region
`me-west1`. The service runs `ced04f7` (API `1.11.0-mut42`): Money M1–M8 plus
the hosted epic's server side, i.e. users and sessions, server-enforced
writability, and expenses. Database migrations are applied through
`mut42_expenses`.

> **Release tags (ADR-081, 2026-10-15).** `make release web` pushes a `web-v<x>` tag with the release commit; `make release server` pushes `api-v<x>` once `deploy.sh` succeeds. release-qa reads its baseline from them (web ← `web-v*`, portal ← `api-v*`). Past releases were backfilled locally; push them once with `git push origin --tags`.

> **Observed 2026-10-14 (MUT-174 planning):** production `GET /health` reports `version: eb4a9c8` (main at the `release: api v0.3.7` commit), so production now carries everything on main through MUT-194, including MUT-61 capture and MUT-100/107 contingency. The rows below still show the last *recorded* deploy; whoever deploys next should refresh them.

One known defect: production applied the **original** M7 migration, so the
fee-proposal enum probably predates M8. The check and the fix are in
`server/DEPLOYMENT.md` §7. The revision history is there too.

Infrastructure is Terraform (ADR-026). Production only; no staging. Nothing
builds or migrates inside GCP: the image is built and pushed from the
operator's machine, and migrations run from `server/` through the Cloud SQL
Auth Proxy.

### Topology

```
Operator machine                      GCP project (me-west1)
────────────────                      ──────────────────────
docker build + push ───────────────▶  Artifact Registry  <region>-docker.pkg.dev/<project>/mutaba3a/mutaba3a-api:<sha>
prisma migrate deploy ──(proxy)────▶  Cloud SQL Postgres 16  mutaba3a-pg   db mutaba3a, user mutaba3a_api
terraform apply -var image_tag ────▶  Cloud Run service  mutaba3a-api  (min 1, max 1)  ◀── Malafat, Bearer mut_live_…
                                      Secret Manager  mutaba3a-api-database-url, mutaba3a-api-admin-token, mutaba3a-api-session-pepper
                                      Cloud Storage  <project>-mutaba3a-attachments (private; attachments + expense receipts)
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
| `malafat-production` | the `run.app` URL (`terraform output -raw service_url`; also in Malafat's `malafat-web-mutaba3a-api-url` secret) | `ced04f7` (revision `mutaba3a-api-00005-6wq`) | 2026-10-11 06:00 UTC |

Earlier revisions (`dd626ec`, `f1a558c`, `acb1144`, `4dd53b8`) are listed in
`server/DEPLOYMENT.md` §7. Update both after each `deploy.sh` run. Malafat
production is `web@2.2.4` (`8cd8fea19`, 2026-10-11 06:03 UTC), which carries
Money M8.

## 3. Costs (estimate, hosted API only)

| Item | Production |
|---|---|
| Cloud SQL | ~$50–60/mo (`db-g1-small`, REGIONAL) |
| Cloud Run | ~$10–15/mo (1 min instance, 512Mi, cpu idle) |
| Secret Manager, Artifact Registry, uptime check | < $1/mo |

ADR-005's "zero server costs" still holds for the desktop/PWA; the hosted API
is the first paid infrastructure and exists only for firms that connect from
Malafat (ADR-024).
