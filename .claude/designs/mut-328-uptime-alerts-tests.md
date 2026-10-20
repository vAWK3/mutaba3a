# MUT-328 — test plan

Brief: `mut-328-uptime-alerts.md`. TDD: `tests/monitoring.tftest.hcl` is written before `monitoring.tf`.
Run offline (mocked providers, no credentials): `cd server/infrastructure/terraform && terraform init -backend=false && terraform test`.
server-ci runs the same (`terraform fmt -check -recursive`, `validate`, `test`).

## `server/infrastructure/terraform/tests/monitoring.tftest.hcl`

1. **Defaults = today's behaviour plus two checks.** No channel variables: checks `health`, `ready`, `portal` exist with paths `/health`, `/ready`, `/`, period 300s, SSL on port 443, all on the Cloud Run host; no notification channel, no alert policy; `health` keeps its display name `mutaba3a-api /health`.
2. **Portal check matches the SPA shell**: one `CONTAINS_STRING` matcher on `id="root"`; `health` has none.
3. **Host follows `uptime_host`**: `uptime_host = "app.example.com"` → every check's `monitored_resource.labels.host` is it; `output.uptime_host` reports it.
4. **A host with a scheme, path or port is refused** (`expect_failures = [var.uptime_host]`).
5. **Email + SMS create two channels and five policies**: types `email` / `sms`; each uptime policy and both SQL policies list both channels plus an extra id from `alert_notification_channels`.
6. **Uptime policy pages on 2 failed rounds, not 1**: threshold `> 1` region, duration `360s`, alignment `300s` `ALIGN_NEXT_OLDER` + `REDUCE_COUNT_FALSE`; `auto_close` 1800s; severity CRITICAL (`notification_prompts` needs provider 6.x, so it is not settable here, TD-185).
7. **SQL alerts**: disk `> 0.8` and CPU `> 0.9`, duration `900s`, filtered to `test-project:mutaba3a-pg`; severity WARNING.
8. **An SMS number not in E.164 is refused** (`expect_failures = [var.alert_sms_number]`).
9. **Existing channel ids alone still alert** (backward compatible with today's variable).
10. **Drill**: `uptime_drill_path = "/v1/uptime-drill"` adds a `drill` check + policy; a path without a leading `/` is refused.
11. **`enable_uptime_check = false`**: no checks and no uptime policies; SQL alerts still exist when a channel is set.

## Regression

`tests/database_pool.tftest.hcl` unchanged and green. Repo gates (lint, typecheck, test:run, build) run once to confirm nothing else moved; server gates unaffected (no `server/src` change) but `terraform` CI job is the one that matters.
