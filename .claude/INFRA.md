# INFRA.md — Infrastructure State

> **Purpose**: Where Mutaba3a runs, what is code-defined, and what an operator
> has to do by hand. **Rule**: every cloud resource is declared in code; this
> file records the state, not the steps (steps live in `server/DEPLOYMENT.md`).

---

## 1. Desktop / PWA (the product, unchanged by the hosted API)

| Target | Host | Defined in |
|--------|------|------------|
| PWA + landing | Netlify (`mutaba3a.netlify.app`; moving to `mtb3a.com`, MUT-112) | `netlify.toml` |
| macOS / Windows installers | GitHub Releases, Tauri updater | `.github/workflows/build-windows.yml`, `deploy.sh` (macOS, operator) |
| `/hosted` request form | Netlify Forms (free tier: 100 submissions/month) | `vite.config.ts` `netlifyForms()` emits `__forms.html` (MUT-186) |
| Web CI (lint, typecheck, tests + coverage thresholds) | GitHub Actions, one `ubuntu-latest` job per push/PR, npm cache; Actions minutes only (MUT-24 D2) | `.github/workflows/web-ci.yml` |

> **Public origin (MUT-188).** `MUTABA3A_PUBLIC_ORIGIN` names where the landing is served. The **web** build puts it in the link-preview tags and the `/hosted` canonical; the **hosted** build puts it in the portal sign-in's "No account? Request one" link. Neither pipeline sets it today (Netlify's UI env for web; `server-ci.yml` / `server/scripts/deploy.sh` for hosted), so `DEFAULT_PUBLIC_ORIGIN` in `vite.config.ts` is what ships. It comes from `config/hosts.json` (MUT-326, ADR-155): the Netlify origin until that file's `stage` is `live`, then the apex. A staging override on Netlify alone does not move the portal's link.

**Netlify Forms — operator steps, not settable from `netlify.toml` (MUT-186):**
1. Site → Forms → **Enable form detection**, once, before the deploy that first ships `__forms.html`; otherwise `hosted-request` is never registered and every POST 404s (visitors see the retry state).
2. Site → Forms → `hosted-request` → **Form notifications** → email Basel.
3. After that deploy, send one request from production and confirm the email arrives.
4. **Weekly:** open Forms › `hosted-request` › **Spam**. Akismet-flagged requests land there and no email is sent for them (short Arabic messages are plausible false positives). Mark real ones as verified and reply.
5. Set a Forms **usage alert**, and check what your Netlify plan does once a month's submission allowance (100 on the free tier) runs out, so a spam burst can't quietly block real requests. If spam starts arriving, build the Turnstile follow-up (MUT-197).
6. **Retention (privacy policy promise):** delete submissions older than 12 months from Forms › `hosted-request` **and the matching notification emails in your inbox**, and do the same for any request a visitor asks you to delete (info@malafat.app).

Form data (name, email, optional phone/profession/devices/message, page language, a random request id) plus Netlify's own technical details (IP address, browser) is stored by Netlify, checked by Akismet and emailed; the privacy policy says so. Duplicates of one request (a retry after a timeout, or an "edit and send again" correction) share the same `request-id`.

| `/hosted` link preview | Netlify rewrite `/hosted` → `hosted-offer.html` | `netlify.toml`; `vite.config.ts` `hostedOfferHtml()` emits the page copy with its own Arabic card (MUT-186) |
| Free app's portal sign-in link | Build-time `MUTABA3A_PORTAL_URL` (default: the portal origin `config/hosts.json` names), injected as `__PORTAL_URL__` in the web build only | `vite.config.ts` `DEFAULT_PORTAL_URL` / `portalUrl()` (MUT-187, ADR-076); the bundle allowlist adds the config's origins itself (MUT-326) |
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
| Host | Sentry SaaS, **EU region** (`de.sentry.io`, Frankfurt). The company org **`barmajiyat-ltd`** (ADR-091 amendment 5). It also holds E33's `e33-api` and `e33-flutter`; the org settings apply to them too (ADR-091 amendment 9). Another product joins only by adding its prefix to the settings script's allow-list (TD-198). |
| Status | **Applied 2026-10-22** (MUT-147, §1.5 steps 1–7). Org `barmajiyat-ltd` (EU):
<br>• Four projects: two imported and two created. Team `mutaba3a`, with Basel as a member. Four uncapped keys, 12 `sentry_alert`s, spike protection and browser filters.
<br>• Org settings applied by `sentry-org-settings.ts --apply`. They cover E33's projects too.
<br>• In the two hand-made projects, the `Default` keys are disabled and the default rules removed. The spike alert was checked in the UI.
<br>**API (MUT-148):** `sentry_enabled = true` is set in `production.tfvars`. It takes effect on the next `make release server` (§1.5 step 8): the smoke must say `on vs on`, then run `npm run sentry:smoke` and record the date here. Until then the API reports nothing.
<br>**Phone (MUT-151):** wired on `feature/mut-151-phone-sentry` (mutaba3a-flutter). It reports from the first store build made with `barmajiyat/MUTABA3A_SENTRY_DSN` in the Keychain. Before that build, set by hand on `mutaba3a-flutter` › Settings › Security & Privacy › Advanced Data Scrubbing: **Remove** · **Anything** · from `contexts.device.name`, `$user.email`, `$user.username` and `$user.ip_address`. This is the second layer for native crashes, which skip the Dart scrubber (ADR-091 amendment 10). **Set 2026-10-23.** The upload token `barmajiyat/SENTRY_AUTH_TOKEN` is in the Keychain too (checked 2026-10-23). Store releases still use `SENTRY=off` until MUT-413 (store answers, landing privacy text, first-build symbol check).
<br>**Smokes (2026-10-24):** API `npm run sentry:smoke` sent from `server/` (DSN from Secret Manager `mutaba3a-api-sentry-dsn`); the portal console smoke arrived as MUTABA3A-WEB-1 with the user id only, the route template, locale and release `mutaba3a-portal@0.5.0+e01590a8`. Sentry derived `user.geo` (city) from the IP at ingest though it stores no IP: an open privacy question against the policy's "never your IP address".
<br>**iOS extensions (MUT-395, 2026-10-24):** merged on flutter main 83576390. The Share Extension, widgets and Siri intents report to the same project from the first store build carrying the DSN (ADR-091 amendment 13); the lane also uploads the archive's dSYM zip. The same Advanced Data Scrubbing rule covers them. Still open: the widget memory check and a forced crash per extension on the QA simulator.
<br>**Portal (MUT-149, 2026-10-23):** built on `feature/mut-149-portal-sentry`. It reports from the first `make release server` with `MUTABA3A_SENTRY_DSN` (the `mutaba3a-web` DSN) in `deploy.env` and the upload token in the Keychain (`DEPLOYMENT.md` §1.5 steps 3 and 6). The CSP and the build pin the org's ingest host, `o4512029835526144.ingest.de.sentry.io`. **Landing (MUT-150, 2026-10-24):** merged; reports from the first `make release web` after Netlify's production context gets `MUTABA3A_LANDING_SENTRY_DSN` and `SENTRY_AUTH_TOKEN` (`DEPLOYMENT.md` §1.5 step 9). Every DSN must point at `.ingest.de.sentry.io` (a Terraform postcondition refuses anything else), and the settings script refuses an org whose region isn't `https://de.sentry.io`. Never fall back to `sentry.io`. |
| Projects | `mutaba3a-api`, `mutaba3a-web` (portal), `mutaba3a-landing`, `mutaba3a-flutter` (capture app), team `mutaba3a`. `mutaba3a-web` and `mutaba3a-flutter` were made by hand in the UI (2026-10-22) and are imported (`import` block in `main.tf`); their automatic `Default` key and default alert rule are removed by hand (DEPLOYMENT.md §1.5 step 7). Each has one Terraform key, **uncapped**: per-key rate limits need a paid plan (ADR-091 amendment 8, TD-200). Surface keys are stable: renaming one destroys its project and rotates its DSN, and the capture-app DSN needs a phone release first. |
| Allowed origins | From `config/hosts.json` (MUT-326): the portal DSN accepts the portal origins, the landing DSN the landing origins, new and legacy. `production.tfvars` `portal_origins` / `landing_origins` list extras only. **Re-apply after the domain's stage goes `live`** (DEPLOYMENT.md §5a step 4), or its errors are dropped. api and capture-app accept any origin. |
| Alerts | Per project, as `sentry_alert` workflows on the project's default error monitor (the classic issue-alert endpoints are retired): new issue, regression, and a spike (one issue over 10 events/hour). Each emails the issue owners, falling through to all members, which is Basel on a one-seat org. |
| Cost guards | Developer (free) plan, about 5k errors/month (check at signup). **Pay-as-you-go budget $0** (operator step: overage is dropped, never billed). Spike protection on all four projects. Browser inbound filters (extensions, localhost, crawlers) on portal and landing. No per-key daily caps (the free plan can't set them, TD-200). **Upgrade trigger:** a second person needs access, the quota runs out once (TD-200), or two months running → a plan with key rate limits. |
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
                                      Cloud Storage  <project>-mutaba3a-attachments (private; attachments + expense receipts; soft delete 14d)
                                      Cloud Monitoring  uptime checks /health /ready portal /, Cloud SQL alerts → email (MUT-328; SMS not set up)
```

| Setting | Production |
|---|---|
| `API_KEY_ENVIRONMENT` | `live` |
| Cloud SQL | `db-g1-small`, REGIONAL, daily backups + PITR 7d, deletion protection |
| Encryption at rest (MUT-381, ADR-164) | `cmek_stage` = **off** (merged, not applied). From `prepared`: KMS key `mutaba3a-data` (ring `mutaba3a`, me-west1, 90-day rotation, `prevent_destroy`) on `mutaba3a-pg2` and as the attachments bucket's default. From `active` the API serves from `mutaba3a-pg2`. Procedure: DEPLOYMENT.md §6d. Secret Manager and Terraform state keep Google's default encryption |
| Cloud Run ingress | `api_ingress` = `INGRESS_TRAFFIC_ALL`; `INGRESS_TRAFFIC_INTERNAL_ONLY` only for the CMEK switch apply or a whole-database restore |
| Stripe sync (MUT-360, ADR-165) | `stripe_enabled` = **false** (merged, not applied). On: `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` mounted from Secret Manager. `MUTABA3A_JOB_TOKEN` (secret `mutaba3a-api-job-token`, a Terraform `random_password`) is mounted on every release regardless. Procedure: DEPLOYMENT.md §6e |
| Cloud Scheduler (MUT-360) | job `mutaba3a-stripe-reconcile`, created only when `stripe_enabled`: `POST <service uri>/jobs/v1/billing/stripe-reconcile` with header `X-Job-Token`, `30 3 * * *` Asia/Jerusalem, `attempt_deadline` 280s (under Cloud Run's 300 s request timeout; the server stops its own run at about 200 s, `TIME_BUDGET`), 3 retries, in `var.region`. Check at apply that Cloud Scheduler is offered in that region (me-west1); the job needs `cloudscheduler.googleapis.com`, which Terraform enables. A failed attempt (no 2xx: 502 `RECONCILE_FAILED`, 409 `RECONCILE_RUNNING`, 401, 503, the deadline) pages, see the alerts row. `scripts/cmek-cutover.sh` pauses the job while the database is closed, and pilot runbook §4.3 does by hand; no apply resumes it. The token sits in the job's config and in Terraform state (TD-197) |
| Cloud Scheduler trial mail (MUT-419) | job `mutaba3a-trial-mail`, created only when `mailer = "resend"`, `stripe_enabled` and `billing_gate_enabled`: `POST <service uri>/jobs/v1/billing/trial-mail` with `X-Job-Token`, `0 10 * * *` Asia/Jerusalem, `attempt_deadline` 280s (the run stops itself at about 200 s and answers `incomplete`), 3 retries (safe: a second run sends nothing new). No alert yet (TD-223) |
| Stripe alerts (MUT-360) | `google_monitoring_alert_policy.stripe` in `monitoring.tf`, only when `stripe_enabled` and an alert channel is set, on the MUT-328 channels, one notice per policy per hour at most. Three log-match policies: "Stripe sync needs the operator" (API `msg` `stripe sync needs the operator`, `stripe event failed; Stripe will redeliver`, `stripe refused a re-fetch`), "Stripe reconcile needs the operator" (`stripe reconcile needs the operator`, `stripe reconcile could not list`), "Stripe reconcile job failed" (`resource.type="cloud_scheduler_job"`, the job's id, `severity>=ERROR`). Filters unproven against live entries until each first fires. Procedure: DEPLOYMENT.md §6e "Alerts" |
| Stripe release guard (MUT-360) | `guard_stripe_release` in `server/scripts/lib/release-guard.sh`, called by `deploy.sh` with the CMEK guard: refuses a release whose checkout's `stripe_enabled` is false or unset while production runs Stripe (the job exists, or the service mounts `STRIPE_SECRET_KEY`). On by default; `SKIP_STRIPE_GUARD=1` skips it |
| Attachments bucket | no versioning; deleted objects restorable 14 days (`soft_delete_policy`, TD-190), as long as the 14 daily backups. **Applied 2026-10-20** (rode along with the §6b apply as a dependency; `retention_duration_seconds` 604800 → 1209600) |
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
- `server/infrastructure/terraform/monitoring.tf` — uptime checks, notification channels and alert policies (MUT-328, ADR-154). **Applied 2026-10-20, email only**: `alert_email` set in production.tfvars (channel `notificationChannels/14384563563247649611`), 3 checks + 5 policies live, 8 added / 1 changed (the §6c bucket) / 0 destroyed. No SMS channel yet (`alert_sms_number` unset; add it and re-run §6b steps 2–4 when wanted). The drill (§6b) has not been run. The checks probe `uptime_host`, else the Cloud Run host, so they follow the custom domain (MUT-112).
- `server/Dockerfile` — the one image.
- `server/scripts/deploy.sh` — the only rollout path; runs on the operator's machine.
- `server/scripts/cmek-cutover.sh` — the one-time move to `mutaba3a-pg2` under our key (MUT-381): rehearse, cutover, verify. The only instance it changes is `mutaba3a-pg2`.
- `docs/operations/pilot-runbook.md` — the pilot operator runbook (MUT-327): onboarding, resets, restores, incidents, support, offboarding. `server/scripts/restore-drill.sh` restores backups into scratch instances (**drill not yet run against production**; results go in the runbook's §10, one block per drill, every 60 days: `make release server` lists the drill as an open step when §10's newest `Drill date (UTC)` is missing or older), `server/scripts/profile-rows.sh` exports, restores or purges one profile.
- `.github/workflows/server-ci.yml` — verification only; never pushes or deploys.

### Operator-held (not in code, by design)

| Item | Where it lives | Notes |
|---|---|---|
| GCP project id and state bucket | operator's shell (`GCP_PROJECT_ID`, `TF_STATE_BUCKET`) and `production.tfvars` (git-ignored) | **Chosen 2026-10-08: `malafat-production`** (shared project, every resource prefixed `mutaba3a-`; DEPLOYMENT.md §1.1). A dedicated project would be a Terraform re-apply with a new `project_id` plus a data move. |
| Admin token, DB password | Terraform state + Secret Manager | generated; read with `gcloud secrets versions access`; `terraform output -raw local_database_url` for the proxy |
| Firm API keys | shown once by `npm run provision`; stored hashed in `api_keys` | Malafat stores the secret encrypted per tenant |
| Malafat's `malafat-web-mutaba3a-api-url` | Malafat's Secret Manager | the service URL; created by the operator after the first deploy |
| Stripe: **Mutaba3a** account | Barmajiyat Ltd (UK) Stripe Organization. Malafat has its own account in the same Organization (MAL-30). | Pilot: Products Freelancer / Firm, priced in ILS + USD, monthly and yearly. Subscriptions are created by hand in the dashboard and collected by emailed invoice (`docs/commercial/pilot-offer.md` §5). Statement descriptor `MUTABA3A`. **MUT-360 (ADR-165), merged, not applied:** the server reads a **restricted, read-only key** (Customers, Subscriptions, Products, Prices, Checkout Sessions, Invoices, Events) and the webhook signing secret from Secret Manager (`mutaba3a-api-stripe-secret-key`, `mutaba3a-api-stripe-webhook-secret`). Terraform creates both empty; Basel adds the values with `gcloud secrets versions add`. They are mounted only when `stripe_enabled` = true (default false); until then the Stripe routes answer 503. The webhook endpoint is `https://<api host>/v1/billing/stripe/webhook`: 9 events, API version `2026-09-30.endive`, set up by hand in the dashboard. Order: pilot runbook §1.7, DEPLOYMENT.md §6e. |
| Resend (transactional mail, MUT-359, ADR-174) | Barmajiyat's Resend account, shared with Malafat | **Merged, not applied, off.** Sending domain = the apex from `config/hosts.json`, region eu-west-1, tracking off. Secrets `mutaba3a-api-resend-api-key` (sending-only, domain-restricted) and `mutaba3a-api-resend-webhook-secret`, created empty by Terraform; mounted only with `mailer = "resend"`. DNS in `server/infrastructure/frontdoor/email.tf` (`resend_dkim_value`). `email:check --api` needs a full-access key in the Keychain (`release-kit` / `barmajiyat/RESEND_CHECK_API_KEY`), never on the server. Webhook `https://<portal host>/v1/email/resend/webhook`, created at go-live. Go-live: DEPLOYMENT.md §6f. |
| Cloudflare Turnstile (signup and recovery, MUT-366, ADR-175) | Barmajiyat's Cloudflare account; a widget for the portal host | **Merged, not applied.** Secret `mutaba3a-api-turnstile-secret`, created empty by Terraform, mounted as `TURNSTILE_SECRET` with `mailer = "resend"` (the server refuses to start without it then, and refuses Cloudflare's test secrets in production). The site key goes in the portal build (`MUTABA3A_TURNSTILE_SITE_KEY` in deploy.env, MUT-368); deploy.sh refuses a missing or test site key once mail is on. The portal loads the widget only on /signup and /recover, and `PORTAL_CSP` allows `challenges.cloudflare.com` for its script and frame. `self_signup_enabled` (default false, needs resend) opens `POST /v1/signups`. Free. DEPLOYMENT.md §6f "Signup and recovery". |
| Terms of service version (MUT-324, ADR-102) | `server/src/legal.ts` `CURRENT_TERMS`; text in `src/content/legal/terms/` | **Release web first** (`make release full` is web, then server). The server preflight (`scripts/preflight.sh server`, so before the bump and push) runs `npm --prefix server run terms:check-live`, which reads `${MUTABA3A_PUBLIC_ORIGIN:-https://mutaba3a.netlify.app}/legal/terms-versions.json` and refuses a version the site doesn't list with the same sha256, naming the HTTP status or fetch error when it can't read it. `deploy.sh` checks again every time. Only `SKIP_TERMS_CHECK=1` skips it (`SKIP_REMOTE=1` does not). After a terms bump, wait for Netlify's build before releasing the server. `SKIP_TERMS_CHECK=1` is only for an emergency fix that keeps the version. `npm --prefix server run terms:report` lists who is behind. |
| Custom domain | **stage `live`, released 2026-10-21 (api `5119667b`, web v0.1.18); §5a steps 1–4 done; step 5 merged, not released** (MUT-326, ADR-155; MUT-112 runs it) | `mtb3a.com` (Namecheap, bought 2026-10-21): landing → `mtb3a.com` (`www` 301s to it), portal + API → `app.mtb3a.com` through the Cloudflare Worker; the free web app stays at `mutaba3a.netlify.app/app` (`mtb3a.com/app/*` 302s there). Not a Cloudflare Registrar domain, so the frontdoor stack created the zone (16 added; name servers `destiny`/`duke.ns.cloudflare.com`) and Namecheap uses Custom DNS. The apex certificate had to be triggered (`netlify api provisionSiteTLSCertificate`). **Step 3 history:** `api-v0.4.0` (`2aab0d08`) set `FRONT_DOOR_TOKEN` and every portal sign-in and cookie write returned 500 (detached `req.header`, fixed `d4f4231e`). The first stage-live release failed in `terraform apply` (uptime checks replaced delete-first while alert policies named them; fixed `165b85f7`, `create_before_destroy`). **Verified on `5119667b`:** a wrong-password `POST /v1/sessions` returns 401 on `app.mtb3a.com` and on run.app (each with its own origin and `Sec-Fetch-Site: same-origin`), a foreign origin 403; smoke 8/8; AASA and `assetlinks.json` 200; the three uptime checks probe `app.mtb3a.com` and the policies follow them; the web bundle links to `app.mtb3a.com`, the portal bundle to `mtb3a.com`, `terms-versions.json` is served on the apex. A real sign-in on `app.mtb3a.com` worked (Basel, 2026-10-21). PostHog needs no change (no insight or action filters on a host). The Sentry stack has never been applied (no state in the bucket; MUT-147), so there is nothing to re-apply: it reads `config/hosts.json` when it is. **Step 5** merged to the Flutter repo's local main `2515fc4f` (not pushed, not released): the app claims `app.mtb3a.com` and the run.app host, and its local `.env` points the API at `app.mtb3a.com`. **Open:** that phone release; dropping the run.app claim one release later; step 6 only after the carry-over (MUT-291). On run.app, a request with only `Origin` (no `Sec-Fetch-Site`) gets 403 because Cloud Run sees an `http://` URL; this predates the move and only affects very old browsers. The Malafat OAuth client identity still names the unregistered `mutaba3a.app` (moving it: see Jira). `config/hosts.json` names it; `server/infrastructure/frontdoor` (Cloudflare zone + Worker front door + Netlify custom domain, own state `mutaba3a-frontdoor/<env>`) builds it; the operator runs DEPLOYMENT.md §5a. Needs `CLOUDFLARE_API_TOKEN`, `NETLIFY_API_TOKEN`, a deliberately chosen Cloudflare account (the Workers free tier is per account, TD-186) |

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
| Cloud KMS key `mutaba3a-data` (from `cmek_stage = prepared`, MUT-381) | ~$0.06 per key version per month (4–5 versions a year) plus cents of operations |
| Second Cloud SQL instance during the CMEK cutover (MUT-381) | about $2/day from `prepared` until MUT-383 deletes `mutaba3a-pg`, 14 days after the cutover: about $28 if the cutover follows within a day |
| Attachments bucket, incl. 14 days of soft-deleted receipts (TD-190) | cents/mo at pilot volume (STANDARD rate; soft-deleted bytes bill the same until purged) |
| Secret Manager, Artifact Registry, uptime checks + 5 alert conditions (MUT-328) | < $1/mo (checks within the 1M runs/month free; ~$0.10/condition/month if alerting charges apply) |
| Stripe sync (MUT-360): 3 secrets, 1 Cloud Scheduler job, 3 log-match alert policies, Stripe API reads | about $0.18/mo for the secrets; the job is within the 3 free jobs per billing account; the policies ~$0.10/condition/month if alerting charges apply; Stripe reads are free |
| Account deletion (MUT-333): 1 Cloud Scheduler job (hourly), 2 log-match alert policies, Stripe deletes | free while the billing account has at most 3 Scheduler jobs, $0.10/mo past that; the policies ~$0.10/condition/month if alerting charges apply |
| Mail (MUT-359) | the shared Barmajiyat Resend plan (free: 100/day across both products; Pro $20/mo for 50k); 2 secrets ≈ $0.12/mo; 2 log-match alerts ~$0.10/condition/month if charged |

ADR-005's "zero server costs" still holds for the desktop/PWA; the hosted API
is the first paid infrastructure and exists only for firms that connect from
Malafat (ADR-024).
