# Money v1 (MUT/MAL) — handover and operator checklist

- **Date:** 2026-10-08 · **Status:** Milestones 1–6 implemented in both repositories on branch `claude/stoic-ritchie-d6yiog`, tested end to end against Postgres (see `.claude/TEST_PLAN.md` "End-to-end"). Nothing is deployed, merged or scheduled: every step below is the operator's.
- **Branches:** `vAWK3/mutaba3a` and `vAWK3/malafat`, both `claude/stoic-ritchie-d6yiog`. Mutaba3a: M4–M6 server, briefs, e2e scripts. Malafat: M3–M6 UI, routes, services, i18n, knowledge files.

## 1. Review and merge (both repositories)

1. Mutaba3a: `server/` M4–M6, the two e2e scripts, Terraform (bucket + IAM), briefs under `.claude/designs/money-v1-m{4,5,6}-*.md`. CI (`server-ci.yml`) runs unit + Postgres contract tests, OpenAPI check, Docker build, `terraform validate`.
2. Malafat: `crm-platform/apps/web/src/features/money/**`, `api/admin/money/**`, `admin/money/**`, the client page Money card, `packages/core/src/i18n/messages/{en,ar,he}/money.json`, `openapi/openapi.yaml`, `.claude/` knowledge files. No Prisma schema change (ADR-150): no tenant migration.
3. Malafat's vendored contract is pinned to Mutaba3a API `1.5.1-m6` (commit `a923a92`). Deploy Mutaba3a first or together; an older Mutaba3a answers the cancel route with the old shape (Malafat's UI ignores that body, so the order is not critical).

## 2. Mutaba3a deployment (operator runs these; `server/DEPLOYMENT.md` has the full runbook)

1. **Database:** `npm run prisma:migrate:deploy` through the Cloud SQL proxy — applies `20261008*_m4_*`, `20261008220000_m5_retainer_versions_proration`, `20261008230000_m6_attachments_audit_index`.
2. **Terraform:** `terraform plan` then `apply` in `server/infrastructure/terraform` — creates the private attachments bucket (`<project>-mutaba3a-attachments`), grants the API service account `roles/storage.objectAdmin` on it and `roles/iam.serviceAccountTokenCreator` on itself (V4 signed URLs without a key file), and passes `ATTACHMENTS_BUCKET` / `ATTACHMENTS_URL_TTL_SECONDS` (variable `attachments_url_ttl_seconds`, default 900) to Cloud Run. Review the plan: the bucket is new; nothing is destroyed.
3. **Image + release:** build and push the image, roll Cloud Run with `SERVICE_VERSION` = the tag, then `npm run smoke -- --url https://<service> --expect-version <tag>` with `MUTABA3A_ADMIN_TOKEN` set (provision → key → validate → revoke round trip).
4. **Scheduled reconcile:** create the Cloud Scheduler → Cloud Run job (or a cron) running `npm run reconcile` daily around 00:30 Asia/Jerusalem. It posts dated installments and retainer charges for organizations nobody reads; idempotent, hourly is harmless. Until it exists, posting happens lazily on the first read of the day — correct, but overview figures for an idle firm lag until someone opens Money.
5. **Optional staging e2e:** against a staging URL and database, run the two e2e scripts from `server/README.md` "Verify". They create organizations that are never deleted; do not run them against production.

## 3. Malafat deployment

1. Deploy `apps/web` as usual (`pnpm release`); no `pnpm migrate:all` is needed for Money.
2. `MUTABA3A_API_URL` must point at the deployed Mutaba3a; the per-tenant API key is entered by the Partner in Settings › Money & Mutaba3a (encrypted with the tenant DEK, ADR-150).
3. Pilot firm: provision its organization and key (`npm run provision` in Mutaba3a), connect in Malafat, link clients and matters from the Money overview, then walk `.claude/TEST_PLAN.md` "Still manual (runbook)" items for M3–M6 (record / reverse / corrected payment, RTL check of the Allocate table, forced connection drop, documents upload / download / delete, Money card visibility, overview tiles vs rows).

## 4. Still open (decisions or work for the owner)

- **Native review of Arabic and Hebrew strings** in `money.json` (M1–M6 were written without a native speaker; the parity test only proves every key exists).
- **No malware scan on attachments** (M6 decision 4): `complete` verifies size and content type and the UI offers download, never inline rendering. A Cloud Storage → event → scanner → status pipeline is the listed follow-up. Decide whether it gates the pilot.
- **Office Admin access to Money** stays a separate decision (MAL-870); v1 is Partner-only in every cell.
- **Flutter / mobile:** the `/api/admin/money/*` routes are in `openapi.yaml` (ADR-033); no client work was done.
- **Confluence:** Malafat forbids design briefs in its tree, so all Money briefs live in the Mutaba3a repo under `.claude/designs/`. Move or link them from the MAL-939 epic when convenient.
- **Jira:** MAL-939 epic status, and tickets for the two follow-ups above (malware scan, native i18n review).

## 5. What the end-to-end run proved (2026-10-08, Postgres 16, API 1.5.1-m6)

- 84 HTTP checks through Malafat's client, 34 attachment checks in process, smoke round trip, reconcile dry + real — all passing after two server fixes the run found (a supplement's IMMEDIATE installment never posted; cancel answered with the wrong shape).
- Security edges exercised: forged / revoked keys, narrow scopes per route family, cross-organization reads and writes answer 404, a tenant cannot bind to a second organization, idempotency key reuse with a different body is refused and replay returns the stored outcome, stale `If-Match` is refused, forged or stale preview tokens are refused, a cancellation that credits a posted month requires the token, writes before binding are refused, filenames with path separators are refused and object keys never carry user input, signed URLs expire within the configured TTL, logs redact credentials.
