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
| Status | **Project id 304889.** It already existed, empty, when MUT-153 ran: created 2026-10-13 and no events ingested. MUT-153 applied the settings below on 2026-10-17 (Basel's go) and read them back. No surface sends to it yet. |
| Required settings | Discard client IP (`anonymize_ips`) on. Cookieless tracking **on** (`cookieless_server_hash_mode: 2`, stateful): without it, every landing event is silently dropped; MUT-154 confirms with `system.ingestion_warnings`. Autocapture, exception autocapture, web vitals, performance capture, heatmaps, dead clicks, session recording, console-log capture and surveys off. **GeoIP transformation disabled** (2026-10-17, ADR-090 "no location"): it was on by default and would have added city and coordinates to portal and phone events. The test-account filter excludes localhost and the internal cohort. |
| Access (operator step) | **To do (Basel):** restrict the project to the people who need it, under PostHog › Project settings › Access control. The project shares the Barmajiyat org with Malafat. The old `access_control` field is deprecated and the MCP has no tool for the new system, which may need a paid plan. |
| Keys | `MUTABA3A_POSTHOG_KEY` everywhere (MUT-154/155/157). **Landing:** Netlify environment variable, scoped to the **production deploy context only** (never deploy previews or branch deploys); `vite.config.ts` bakes it into the landing chunk. **Portal:** a `MUTABA3A_POSTHOG_KEY=` line in `deploy.env` (or the operator's shell) when `make release server` builds `dist-hosted`; the Makefile exports it to `deploy.sh` (MUT-155). The same server release carries the CSP's `connect-src https://eu.i.posthog.com`, so the portal counts only from that release on. Without a key the portal never asks and drops the SDK at build time. **Phone:** a `MUTABA3A_POSTHOG_KEY=` line in the Flutter app's `.env` (read with `--dart-define-from-file` by `make run` and fastlane), used only by release builds; the app posts PostHog's capture API with its own client, no SDK (ADR-092), so there are no Info.plist or manifest keys. QA builds use a dummy `phc_` key that `qa/support/posthog.ts` answers locally. The `phc_` ingest token comes from `project-get 304889` (PostHog MCP) or the project settings; it is never committed. Host: `https://eu.i.posthog.com`. |
| Post-deploy checks (operator) | After the first keyed landing deploy:<br>• `system.ingestion_warnings` shows no `cookieless_*` warning;<br>• a stored landing event carries no `$raw_user_agent` (the policy says PostHog keeps no browser details; if it is kept, add a transformation that drops it — MUT-154 review F3);<br>• record the landing LCP before and after (review F4). |
| Dashboard | **"Acquisition and activation"** ([dashboard 1031822](https://eu.posthog.com/project/304889/dashboard/1031822), pinned), created 2026-10-17 through the MCP at Basel's go. Four insights, all on contract events, with test accounts filtered; they stay empty until the first keyed release:<br>• Activation: opt-in → first income, by `surface` (30-day window) — MUT-155/157;<br>• Phone activation: `app_first_opened` → `client_created` (optional) → `income_recorded`, by `surface` — MUT-157;<br>• Acquisition: landing `$pageview` → `landing_cta_clicked` within 1 day (cookieless links a visitor only within a day), by `$referring_domain` — MUT-154;<br>• Landing CTA clicks by `cta`.<br>Two pilot tiles were added 2026-10-20 (MUT-330), on the action **"Recorded an entry"** (170934 = `income_recorded` OR `expense_recorded` OR `payment_recorded`):<br>• Pilot activation: opt-in → first entry within 7 days (funnel, 90 days);<br>• Pilot weekly use: cumulative stickiness over four 7-day periods.<br>The barmajiyat PostHog MCP starts in project 125127 (Malafat), so run `switch-project 304889` first. |
| Defined in | Operator-defined SaaS, created through the PostHog MCP (D3). TODOS #15 tracks moving it to the PostHog Terraform provider. The event contract is `docs/analytics/events.json`. |

**Error reporting (ADR-091, MUT-146).**

| Item | State |
|------|-------|
| Host | Sentry SaaS, **EU region** (`de.sentry.io`, Frankfurt). A dedicated Mutaba3a org (suggested slug `mutaba3a`, the product, so no other product is added to it by habit), not shared with any other product. |
| Status | **Code-defined, not yet applied** (MUT-147, 2026-10-17). Basel creates the org and runs the apply and the settings script: `server/DEPLOYMENT.md` §1.5. No surface sends until MUT-148..151 wire the SDKs. Record the apply date here. Every DSN must point at `.ingest.de.sentry.io` (a Terraform postcondition refuses anything else), and the settings script refuses an org whose region isn't `https://de.sentry.io`. Never fall back to `sentry.io`. |
| Projects | `mutaba3a-api`, `mutaba3a-portal`, `mutaba3a-landing`, `mutaba3a-capture-app`, team `mutaba3a`. Each has `default_key = false` and one key, **capped per day** (D6): api 60, capture-app 60, portal 20, landing 20. That's 160/day, which over 31 days fits the 5,000/month `monthly_event_quota` (Terraform validates the sum). A surface that hits its cap drops the rest of its day, but can't use up the shared month. Surface keys are stable: renaming one destroys its project and rotates its DSN, and the capture-app DSN needs a phone release first. |
| Allowed origins | Portal: the Cloud Run URL. Landing: `https://mutaba3a.netlify.app`. Both set in `production.tfvars` (`portal_origins`, `landing_origins`). **Add the custom domain when MUT-112 ships**, or its errors are dropped. api and capture-app accept any origin. |
| Alerts | Per project: new issue, regression, and a spike (one issue over 10 events/hour; Terraform rejects a threshold at or above the smallest daily key cap, which could never be reached). Each emails the issue owners, falling through to all members, which is Basel on a one-seat org. |
| Cost guards | Developer (free) plan, about 5k errors/month (check at signup). **Pay-as-you-go budget $0** (operator step: overage is dropped, never billed). Spike protection on all four projects. Browser inbound filters (extensions, localhost, crawlers) on portal and landing. **Upgrade trigger:** a second person needs access, or the quota runs out two months running → Team plan. |
| Org privacy settings | Applied and verified by `scripts/sentry-org-settings.ts --apply|--check` (not in the provider). Turn on 2FA on your own account first, or Sentry refuses `require2FA`. Settings: Require Data Scrubber, default scrubbers, Prevent storing IP addresses, Enhanced Privacy on, shared issues off, 2FA required, no safe fields. Sensitive fields: the curated `orgSensitiveFields`, never `denyKeyTokens`, because Sentry's scrubber wipes any value containing an entry. Hand-added sensitive fields are kept by `--apply`. |
| Defined in | `server/infrastructure/sentry/` (state `gs://<bucket>/mutaba3a-sentry/production`; offline tests in `tests/`, run by server-ci). Rules: `docs/observability/`. |
| Tokens (operator-held) | **Admin token:** `SENTRY_ADMIN_TOKEN`, a personal (user) token `sntryu_…` from the 2FA-enabled owner account (an org token cannot carry the admin scopes), handed to each `terraform` / settings-script command and never exported as `SENTRY_AUTH_TOKEN` (D8). **Upload token:** `SENTRY_AUTH_TOKEN` = `sntrys_…`, release/upload scopes only, wherever builds run. It is never `VITE_`-prefixed, never in the Flutter `.env`, and in Netlify scoped to the Production context and marked secret. Where each DSN goes: `docs/observability/README.md`. |

The local app: zero cloud infrastructure; no telemetry; data stays on the device (ADR-001,
ADR-013, ADR-090, ADR-091). See `.claude/CI_CD.md`.

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
| Prisma pool per instance | `db_pool_size` = 10, as `connection_limit` in the DATABASE_URL secret Terraform writes (MUT-270) |
| Cloud SQL `max_connections` | `db_max_connections` = 50, an explicit flag (db-g1-small's own default) (MUT-270) |
| Terraform state | `gs://<bucket>/mutaba3a-api/production` |

> **Connection budget (MUT-270, 2026-10-18).** `GET /v1/entries` runs 4 queries per profile in parallel, so the API's pool is now chosen instead of inherited: Prisma's default is derived from the CPU count it sees, which inside a container can be the host's. Rule, enforced by a Terraform precondition: `2 × db_pool_size × max_instances + 10 ≤ db_max_connections` (× 2 because the old and new revisions both hold a pool while a deploy rolls; the 10 cover `prisma migrate deploy`, the operator's proxy session and Cloud SQL's reserved connections). Raise `db_max_connections` with a bigger tier or when `max_instances` grows (TD-017).
>
> **Applied 2026-10-18 14:56 IDT:** `max_connections = 50` is set on `mutaba3a-pg` (targeted apply of `google_sql_database_instance.postgres`, 34 s restart, `/health` and `/ready` back to 200). The next `deploy.sh` does not restart the database again; it only writes the DATABASE_URL with `connection_limit`. Changing `db_max_connections` later restarts it again. The note below is kept for that case.
>
> **The first deploy after this change restarts the Cloud SQL instance, at `deploy.sh` step 0** (review finding, 2026-10-18). Step 0's targeted apply names the DATABASE_URL secret version and `google_sql_user.api`; Terraform also applies what a target depends on, and both depend on the instance, so the `max_connections` flag (which needs a restart, even at the default value) lands there: before the image build and the migration, while the old revision still serves. Do it on purpose instead: in a quiet window, before that deploy, run `terraform apply -target=google_sql_database_instance.postgres` without `AUTO_APPROVE`, read the plan, and let the instance restart (the API errors for the minute or so the database is down). The same step writes a new DATABASE_URL version: Terraform destroys the old version before creating the new one (no `create_before_destroy`, which would spread to the fixed-name instance and secret), so a Cloud Run cold start in those seconds cannot read `latest`. It falls inside the same quiet window as the restart.

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
| Stripe: **Mutaba3a** account | Barmajiyat Ltd (UK) Stripe Organization. Malafat has its own account in the same Organization (MAL-30). | Pilot: Products Freelancer / Firm, priced in ILS + USD, monthly and yearly. Subscriptions are created by hand in the dashboard and collected by emailed invoice (`docs/commercial/pilot-offer.md` §5). Statement descriptor `MUTABA3A`. No keys are in code until MUT-332. |
| Terms of service version (MUT-324, ADR-102) | `server/src/legal.ts` `CURRENT_TERMS`; text in `src/content/legal/terms/` | **Release web first** (`make release full` is web, then server). The server preflight (`scripts/preflight.sh server`, so before the bump and push) runs `npm --prefix server run terms:check-live`, which reads `${MUTABA3A_PUBLIC_ORIGIN:-https://mutaba3a.netlify.app}/legal/terms-versions.json` and refuses a version the site doesn't list with the same sha256, naming the HTTP status or fetch error when it can't read it. `deploy.sh` checks again every time. Only `SKIP_TERMS_CHECK=1` skips it (`SKIP_REMOTE=1` does not). After a terms bump, wait for Netlify's build before releasing the server. `SKIP_TERMS_CHECK=1` is only for an emergency fix that keeps the version. `npm --prefix server run terms:report` lists who is behind. |
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
