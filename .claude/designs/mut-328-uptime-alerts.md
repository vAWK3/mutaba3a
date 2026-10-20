# MUT-328: uptime checks and alerts for the API and the portal

Epic MUT-322 (pilot gate). Guardrail: Claude prepares the Terraform and Basel applies it.
Status: planned 2026-10-20 and built in the same session. The decisions marked **(default)** were not reviewed by Basel. They are listed in the Jira comment.

## Problem

When the hosted service goes down, nobody finds out until a user writes in. Sentry (MUT-146) reports errors, not outages. Production already has one Cloud Monitoring uptime check on `GET /health` (`main.tf`). Its alert policy is created only when `alert_notification_channels` is set, and production's tfvars leaves it empty, so **no alert reaches anyone today**.

## Acceptance criteria (from the ticket, plus Basel's 2026-10-19 comment)

1. Uptime checks on `/health`, `/ready` and one portal page, run from at least 3 regions every 5 minutes.
2. An alert policy that notifies Basel by **email + SMS** (comment 12132) after 2 failed checks in a row, and closes itself when the service recovers.
3. Cloud SQL alerts: disk above 80%, and CPU above 90% for 15 minutes.
4. The host is a variable, so the checks follow the custom domain (MUT-112, prepared by MUT-326).
5. The phone number stays out of the repo. It is a Terraform variable set in the operator's tfvars.
6. `terraform plan` shows only additions (plus a `moved` for the existing check). Cost is free tier or close to it.
7. Firing an alert and having recovery close it are both proven and written into the runbook. **There is no staging** (INFRA.md: production only), so a drill check replaces "scale staging to zero". See D6.

## Design

Everything stays in the API root, `server/infrastructure/terraform/`, because the existing check and its state are there, and so is the Cloud SQL instance the database alerts point at. The monitoring section moves from `main.tf` into a new `monitoring.tf`, so MUT-326's edits to `main.tf` and mine don't collide.

```
var.uptime_host ──┐ (empty: the Cloud Run host; MUT-326 puts the domain first)
                  ▼
local.uptime_host ─► uptime check "health" /health  ─► alert policy "health"  ─┐
                  ─► uptime check "ready"  /ready   ─► alert policy "ready"   ─┤
                  ─► uptime check "portal" /        ─► alert policy "portal"  ─┼─► email channel (var.alert_email)
                  ─► uptime check "drill"  (opt-in) ─► alert policy "drill"   ─┤   SMS channel   (var.alert_sms_number, sensitive)
Cloud SQL mutaba3a-pg ─► alert "sql-disk" (>80%, 15 min)                       ─┤   + var.alert_notification_channels (existing ids)
                      ─► alert "sql-cpu"  (>90%, 15 min)                       ─┘
```

### Decisions

- **D1. Host input.** `variable "uptime_host"` takes a bare hostname. When it is empty, `local.uptime_host` falls back to the Cloud Run host, which is today's behaviour. MUT-326 then changes the fallback to read its domain variable first. Validation rejects a value with a scheme, a path or a port.
- **D2. Portal page.** `GET /` with a `CONTAINS_STRING` matcher on `id="root"`. The portal is served by the same Cloud Run service (MUT-45), so that page proves the SPA shell is being served, not a JSON 404, a parked-domain page or a proxy error page. `/health` stays exactly as it is, so its check is moved and not modified.
- **D3. Regions.** Leave `selected_regions` unset, which means all six regions. That satisfies "at least 3", matches the existing check (so it isn't modified), and gives the "2 regions failing" rule more independent vantage points. Cost: 3 checks × 6 regions × 12 runs/h ≈ 158k runs/month. That is well under the 1M runs/month free per project, even after adding whatever Malafat runs in `malafat-production`.
- **D4. "2 failed checks in a row" (default).** Each check gets one alert policy. It reads `uptime_check/check_passed` with alignment = period (300 s), `ALIGN_NEXT_OLDER`, then `REDUCE_COUNT_FALSE` grouped per check, and fires on **more than 1 failing region** held for **360 s** (period + 60 s). A single failed round holds the count for about 300 s at most (until the next round replaces it), so it never pages. Two failed rounds in a row hold it for about 600 s, so it pages roughly 6 minutes after the second round starts failing. A blip in one region never pages, whatever its length. Incidents close when the condition clears, and `auto_close = 1800s` covers a check that stops reporting (the drill's removal). The close *notice* can't be pinned in Terraform: `alert_strategy.notification_prompts` only exists in google provider 6.x, and this root is locked to 5.45.2. A provider major bump is out of scope for a monitoring ticket. So the close notice relies on Cloud Monitoring's default. Drill step 2 checks it, and the runbook has the console fallback (TD-185).
- **D5. Channels.** Email (`alert_email`) and SMS (`alert_sms_number`, `sensitive`, validated as E.164) are created only when set. Ids already in `alert_notification_channels` keep working and are added on top. With no channel at all there are no policies and no channels, only the checks, which is today's behaviour. Cloud Monitoring leaves an SMS channel **unverified** until a code is confirmed. The runbook has that step, and email works without it.
- **D6. Proving it without staging (default).** `variable "uptime_drill_path"` (empty by default) adds a fourth check plus its policy on the same host and the same channels. Setting it to `/v1/uptime-drill` (a JSON 404, outside the SPA fallback) fires a real alert in about 10 minutes. Setting it to `/health` makes it recover, and the incident closes. Emptying it removes both. No production behaviour changes, and no scale-to-zero on the only environment.
- **D7. Cloud SQL alerts.** Two policies on `cloudsql_database` with `database_id = "<project>:mutaba3a-pg"`, aligned with `ALIGN_MEAN` over 300 s: `database/disk/utilization > 0.8` for 900 s and `database/cpu/utilization > 0.9` for 900 s. Their severity is WARNING, while the uptime policies are CRITICAL. Note: `disk_autoresize` is on, so disk alerts are rare, but a growing disk means a growing bill, which is worth knowing.
- **D8. Plan is additions only.** `moved` blocks map `google_monitoring_uptime_check_config.health[0]` to `.endpoint["health"]`, and `google_monitoring_alert_policy.health[0]` to `.endpoint_down["health"]`. In production the policy has count 0 (no channels), so its `moved` is a no-op there. Where channels *are* set, the policy is updated in place (its condition changes). That's expected, and the operator note says so.
- **D9. Who applies.** The next `deploy.sh` step 5 (a full apply) would also create the new checks, but the channels and policies exist only once Basel sets `alert_email` / `alert_sms_number`. The operator note gives a targeted plan/apply so the monitoring rollout is reviewed on its own, before or apart from a release.

### Cost

Uptime checks: free (D3). Notification channels: free. Alert policies: 5 conditions (3 uptime, 2 SQL). If Google's announced alerting charge applies (about $0.10 per condition per month), that's roughly $0.50/month. SMS: no Cloud Monitoring charge.

### Out of scope

The custom domain itself (MUT-112/326). Runbook content beyond this alert (MUT-327 links to this section). Cloud Run latency and error-rate alerts (Sentry covers errors). PagerDuty or similar.

## Files

- `server/infrastructure/terraform/monitoring.tf` (new): checks, channels, policies, moved blocks, locals.
- `server/infrastructure/terraform/main.tf`: the monitoring section is removed (it moves to monitoring.tf).
- `server/infrastructure/terraform/variables.tf`: `uptime_host`, `uptime_drill_path`, `alert_email`, `alert_sms_number`.
- `server/infrastructure/terraform/outputs.tf`: `uptime_host`, `uptime_check_ids`, `alert_sms_channel`.
- `server/infrastructure/terraform/production.tfvars.example`: the new settings, commented.
- `server/infrastructure/terraform/tests/monitoring.tftest.hcl` (new): offline tests.
- `server/DEPLOYMENT.md`: new §6b, "Uptime alerts (MUT-328)" (apply, verify SMS, drill, verify). The §0 table row is updated.
- `.claude/INFRA.md`, `CHANGELOG.md`, `DECISIONS.md` (ADR), `TEST_PLAN.md`.

## i18n

None. These are operator-only alerts in English, with nothing user-visible.

## QA scenarios (release-QA)

Not applicable: no app, portal or phone code changes, and no user-visible flow. The proof is the offline `terraform test` suite (server-ci runs it) plus the drill in DEPLOYMENT.md §6b, which Basel runs after the apply.
