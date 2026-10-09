# Money v1 — Mutaba3a API contract proposal

- **Date:** 2026-10-08 · **Architecture:** Option B (ADR-025) · **Artifact 2 of 3** required by the plan before build
- **Source of truth:** `server/openapi/openapi.yaml`, generated from the zod route definitions (`npm run openapi:generate`, verified by `openapi:check`). This page explains the conventions and proposes the M2–M6 resources; it never overrides the YAML.
- **Base URL:** `https://api.mutaba3a.app` (production, `live` keys) · `https://api.staging.mutaba3a.app` (staging, `test` keys)

## 1. Conventions (implemented in M1, binding for every later resource)

| Convention | Rule |
|---|---|
| Versioning | Path prefix `/v1`. Additive changes ship freely; a breaking change needs `/v2` and a deprecation period (mirrors Malafat rule 15) |
| Authentication | `Authorization: Bearer mut_<live|test>_<prefix8>_<secret43>`. Validated every request: format → environment → prefix lookup → constant-time hash compare → revoked → expired → organization → rate limit |
| Authorization | Closed scope vocabulary (`integration customers projects agreements payments attachments summaries audit` × `read/write`, `summaries:read`, `audit:read`). Non-hierarchical. Route declares one required scope; `INSUFFICIENT_SCOPE` carries `{required, granted}` |
| Organization scoping | Never a request parameter. Resolved from the key. No route can address another organization's id |
| Errors | `{ "error": { "code", "message", "details?", "requestId" } }`. Codes: `UNAUTHENTICATED INVALID_API_KEY API_KEY_REVOKED API_KEY_EXPIRED API_KEY_ENVIRONMENT_MISMATCH ADMIN_UNAUTHORIZED INSUFFICIENT_SCOPE NOT_FOUND ORGANIZATION_MISMATCH CONFLICT OPERATION_IN_PROGRESS VALIDATION_FAILED IDEMPOTENCY_KEY_REUSED IDEMPOTENCY_KEY_REQUIRED RATE_LIMITED INTERNAL`. M3+ adds financial codes (below) |
| Idempotency | Every state-changing `POST` requires `Idempotency-Key` (8–128 chars). Same key + same body → stored outcome replayed with `Idempotent-Replayed: true`; same key + different body → `422 IDEMPOTENCY_KEY_REUSED`; concurrent → `409 OPERATION_IN_PROGRESS`; 5xx releases the key |
| Request ids | `X-Request-Id` echoed or generated; present in every error envelope and audit event |
| Rate limiting | Per key, sliding 60 s window; `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After` on 429 |
| Money | `{ "amount": "10000.00", "currency": "ILS" }` — canonical decimal string, exactly the currency's exponent, no separators. The server rejects anything else (`VALIDATION_FAILED`) |
| Dates | `date` fields are `YYYY-MM-DD` in the organization's timezone; `*At` fields are RFC 3339 UTC |
| Pagination | `?limit=` (≤ 200) + `?cursor=` opaque; responses `{ items, nextCursor }` |
| Concurrency | Mutable financial records carry `version`; writes send `If-Match: <version>`; mismatch → `409 CONFLICT` with the current version. Previews carry a `previewToken`; posting a stale token → `409 CONFLICT` code `PREVIEW_STALE` |
| Audit | Every write appends an `audit_events` row with actor (API key), action, entity, metadata, request id. Readable with `audit:read` |

## 2. Milestone 1 — implemented

| Method & path | Scope | Purpose |
|---|---|---|
| `GET /health`, `GET /ready` | — | liveness / readiness |
| `GET /v1/integration` | `integration:read` | validate credential; organization, masked key, scopes, `requiredScopes`, `missingScopes`, current binding, server version |
| `POST /v1/integration/bind` | `integration:write` + Idempotency-Key | bind organization ↔ Malafat tenant; `201` created, `200` already bound, `409 ORGANIZATION_MISMATCH` otherwise; reconnect keeps the integration id |
| `POST /v1/integration/disconnect` | `integration:write` | mark DISCONNECTED, revoke the calling key, preserve everything |
| `POST /admin/v1/organizations`, `GET /admin/v1/organizations/{id}`, `POST …/{id}/api-keys`, `POST /admin/v1/api-keys/{id}/revoke`, `GET …/{id}/audit` | `X-Admin-Token` | operator provisioning (TD-018) |
| `GET /openapi.json` | — | live contract |

## 3. Proposed resources, M2–M6 (names and shapes to be generated into the YAML as each milestone lands)

### M2 — Customers and projects (plan §3.2–3.3, §10.2–10.3) — **implemented 2026-10-08** (`money-v1-m2-customers-projects.md`)

| Method & path | Scope | Notes |
|---|---|---|
| `POST /v1/customers` | `customers:write` | `{ name, externalReference?: { provider: "MALAFAT", externalId } }`. Idempotent on external reference within the organization's integration: a repeat returns `200` with the existing customer, never a duplicate |
| `GET /v1/customers`, `GET /v1/customers/{id}` | `customers:read` | filters `?externalId=` |
| `POST /v1/projects` | `projects:write` | `{ customerId, name, currency, externalReference? }`; currency immutable once anything is posted (`409 CONFLICT` code `CURRENCY_LOCKED`) |
| `GET /v1/projects`, `GET /v1/projects/{id}` | `projects:read` | filters `?customerId=&externalId=` |
| `POST /v1/import/preview`, `POST /v1/import/commit` | `customers:write`+`projects:write` | batch upsert by external reference; preview reports `create / link / conflict` per row; commit is idempotent and reports partial failures per row |

External reference uniqueness as built: `(organization, provider, entityType, externalId)` — entity type added because a Malafat client and matter may share an id; plus one reference per entity per provider. Also shipped: `PATCH` with `If-Match`, `POST …/archive` (never delete), `GET` filters `status`, `customerId`, `currency`, `externalId`; conflicts carry `details.reason`. Import rows: `{ entityType: CUSTOMER|PROJECT, externalId, name, email?, phone? | currency, customerExternalId }`, ≤ 500 per call; commit is per-row and needs the preview's `previewToken`.

### M3 — Fixed-fee agreements, installments, VAT (plan §3.4, §4, §6) — **implemented 2026-10-08** (`money-v1-m3-agreements-installments-vat.md` rev. 2; Malafat side `money-v1-m3-malafat-ui.md`, same day)

| Method & path | Scope | Notes |
|---|---|---|
| `POST /v1/agreements/preview` | `agreements:read` | returns net / VAT / gross, installment amounts with deterministic rounding (last installment absorbs), due dates, `previewToken` |
| `POST /v1/agreements` | `agreements:write` + Idempotency-Key | `{ projectId, type: "FIXED", amount, pricingBasis: "VAT_EXCLUSIVE"|"VAT_INCLUSIVE", vatTreatment: "STANDARD_RATED"|"ZERO_RATED"|"EXEMPT"|"OUT_OF_SCOPE", agreementDate, description?, installments: [{ label, amount|percent, trigger: { type: "IMMEDIATE"|"DATE"|"MANUAL", date? } }], previewToken }` |
| `POST /v1/agreements/{id}/supplements` | `agreements:write` + Idempotency-Key | positive or negative; response distinguishes contractual change, effect on unposted installments, and `requiresAdjustment` with a structured reason when posted receivables are touched (plan §12.5 safeguard) |
| `GET /v1/agreements?projectId=`, `GET /v1/agreements/{id}` | `agreements:read` | includes installments with status `PENDING / DUE / PARTIALLY_PAID / PAID / OVERDUE` |
| `POST /v1/installments/{id}/trigger` | `agreements:write` + Idempotency-Key | manual milestone; creates/activates the receivable; idempotent |
| `GET /v1/receivables?customerId=&projectId=&currency=&status=` , `GET /v1/receivables/{id}` | `payments:read` | gross outstanding, due date, origin (installment / retainer charge / adjustment) |
| `GET /v1/vat-rates`, `PUT /v1/settings/vat` | `agreements:read` / `agreements:write` | effective-dated rates per organization; posted records keep the rate they were posted with |

As built (rev. 2 of the M3 brief): VAT **treatment** is per item with a default chain installment → agreement → project → customer → STANDARD_RATED; installments split the contractual amount in its pricing basis and compute VAT each; `paymentTerms` (`IMMEDIATE | EOM | EOM_15 | EOM_30 | EOM_45 | EOM_60`, default `EOM`) per agreement with per-installment override and an optional `dueDate`; `POST /v1/agreements/{id}/cancel` while nothing is posted; receivables carry `origin INSTALLMENT | RETAINER_CHARGE | ADJUSTMENT` and `outstanding`; business-rule 422s carry `details.reason` from the published list.

### M4 — Payments, allocations, reversals (plan §7) — **implemented 2026-10-08** (`money-v1-m4-payments-allocations.md`, all eight decisions approved as proposed); Malafat side `money-v1-m4-malafat-ui.md`, same day (payment wizard, detail with reversal and allocate-later, credits). The brief adds `POST /v1/receivables/{id}/credits` (the explicit adjustment M3 reserved), `GET /v1/receivables/{id}/credits`, `{ paymentId }` previews for unallocated funds, and amends `GET /v1/operations/{key}` to `PENDING | COMPLETED | 404` (a released key is retryable; no `FAILED` state is stored)

| Method & path | Scope | Notes |
|---|---|---|
| `POST /v1/allocations/preview` | `payments:read` | `{ customerId, amount, currency, strategy?: "OLDEST_FIRST"|"SETTLE_MATTERS", allocations?: [...] }` → validated allocation set, unallocated remainder, resulting balances per receivable/project/customer, `previewToken` |
| `POST /v1/payments` | `payments:write` + Idempotency-Key | `{ customerId, amount, currency, receivedOn, method: "CASH"|"BANK", reference?, notes?, allocations: [{ receivableId, amount }], previewToken }`; atomic with its allocations; `422` codes `ALLOCATION_EXCEEDS_PAYMENT`, `ALLOCATION_EXCEEDS_OUTSTANDING`, `CURRENCY_MISMATCH` |
| `GET /v1/payments?customerId=&projectId=`, `GET /v1/payments/{id}` | `payments:read` | status `POSTED / REVERSED`; allocations; `reversedByPaymentId` / `replacesPaymentId` links |
| `POST /v1/payments/{id}/allocations` | `payments:write` + Idempotency-Key | allocate previously unallocated funds |
| `POST /v1/payments/{id}/reverse` | `payments:write` + Idempotency-Key | `{ reason }`; undoes allocations atomically; second reversal → `409 CONFLICT` code `ALREADY_REVERSED` |
| `GET /v1/operations/{idempotencyKey}` | `payments:read` | reconcile an unknown outcome: `PENDING / COMPLETED / FAILED` with the stored response (plan §12.7, §14.2) |

### M5 — Recurring retainers (plan §5) — **basic form implemented in M3**; **changes, proration, cancel preview and the reconcile script implemented 2026-10-08** (`money-v1-m5-retainer-changes.md`, API `1.4.0-m5`): `POST /v1/retainers/{id}/changes/preview` + `/changes` (effective-dated versions, charges keep their terms), `POST /v1/retainers/{id}/cancel/preview`, cancel with `PRORATE` and a credit on an already-posted final month, `npm run reconcile` for a scheduler

| Method & path | Scope | Notes |
|---|---|---|
| `POST /v1/retainers/preview` | `agreements:read` | next charge, service period, due date for `{ monthlyAmount, pricingBasis, vatTreatment, startMonth, billingDay?, paymentTerms: "EOM"|"EOM_15"|"EOM_30"|"EOM_45"|"EOM_60", endDate? }` |
| `POST /v1/retainers` | `agreements:write` + Idempotency-Key | creates agreement type `RECURRING` version 1 |
| `POST /v1/retainers/{id}/changes` | `agreements:write` + Idempotency-Key | effective-dated new version; history immutable |
| `POST /v1/retainers/{id}/cancel/preview`, `POST /v1/retainers/{id}/cancel` | `agreements:read` / `agreements:write` + Idempotency-Key | `{ effectiveDate, finalMonth: "FULL"|"PRORATE"|"WAIVE" }`; calendar-day proration; explicit adjustment rows for already-posted charges |
| `GET /v1/retainers/{id}/charges` | `payments:read` | generated charges; unique per (agreement version, service period) |
| `POST /v1/retainers/reconcile` | `agreements:write` | operator/scheduler: generate any missing charges up to today, idempotent, organization-scoped; the scheduler calls this per organization in its timezone |

### M6 — Attachments, summaries, audit (plan §9, §11) — **implemented 2026-10-08** (`money-v1-m6-summaries-audit-attachments.md`, API `1.5.0-m6`). As built: `GET /v1/summaries/organization[?currency=]` returns per-currency blocks with per-customer rows; `POST /v1/attachments/uploads` takes `customerId | projectId | paymentId`; `DELETE /v1/attachments/{id}` added; no malware scan (`complete` verifies size and type); `GET /v1/audit` filters by `entityType`, `entityId`, `action`

| Method & path | Scope | Notes |
|---|---|---|
| `POST /v1/attachments/uploads` | `attachments:write` | returns a short-lived signed upload URL + attachment id for `{ kind: "INVOICE"|"RECEIPT"|"OTHER", filename, mimeType (pdf/jpeg/png), sizeBytes, projectId? | paymentId?, invoiceNumber?, invoiceDate? }`; finalize with `POST /v1/attachments/{id}/complete`; scanned before `READY` |
| `GET /v1/attachments?projectId=|paymentId=`, `GET /v1/attachments/{id}/download` | `attachments:read` | signed download URL, short-lived, never public |
| `GET /v1/summaries/organization?currency=` | `summaries:read` | total outstanding (with not-yet-due), overdue, unallocated — per currency, plus per-customer breakdown |
| `GET /v1/summaries/customers/{id}`, `GET /v1/summaries/projects/{id}` | `summaries:read` | the figures the Malafat UX brief renders; statuses are computed here, never by the client |
| `GET /v1/audit?entityType=&entityId=&cursor=` | `audit:read` | financial history |

Financial status enums returned by summaries: fixed-fee project `OUTSTANDING / PARTIALLY_PAID / OVERDUE / PAID_IN_FULL` (never `PAID_IN_FULL` with a pending installment); retainer `UP_TO_DATE / OUTSTANDING / OVERDUE / CANCELLED / SETTLED`; installment `PENDING / DUE / PARTIALLY_PAID / PAID / OVERDUE`; payment `POSTED / REVERSED`.

### M7 — Fee proposals (negotiations before an agreement) — **implemented 2026-10-09** (`money-v1-m7-fee-proposals.md`, API `1.6.0-m7`). The pre-agreement state the plan never had: a proposed amount, the client's approval, a final agreed figure, converted by the agreement the wizard creates. Fixed fee only; one open proposal per project; scopes reused.

| Method & path | Scope | Notes |
|---|---|---|
| `POST /v1/fee-proposals` | `agreements:write` + Idempotency-Key | `{ projectId, amount, pricingBasis, proposedOn?, note? }` → 201 `FeeProposal` (project currency); 409 `PROPOSAL_OPEN { openProposalId, status }`; 422 `PROJECT_NOT_FOUND` / `PROJECT_ARCHIVED` / `AMOUNT_INVALID` / `DATE_INVALID` |
| `GET /v1/fee-proposals?projectId=&customerId=&status=&open=true|false&cursor=&limit=`, `GET /v1/fee-proposals/{id}` | `agreements:read` | keyset pages; `open=true` = `PROPOSED | CLIENT_APPROVED | AGREED` |
| `POST /v1/fee-proposals/{id}/approve` | `agreements:write` + Idempotency-Key | `{ approvedOn?, note? }`: `PROPOSED → CLIENT_APPROVED`, `agreedAmount` = `proposedAmount`; else 409 `PROPOSAL_NOT_OPEN { status, allowedFrom }` |
| `POST /v1/fee-proposals/{id}/agree` | `agreements:write` + Idempotency-Key | `{ amount, agreedOn?, note? }`: `PROPOSED | CLIENT_APPROVED → AGREED`; else 409 `PROPOSAL_NOT_OPEN` |
| `POST /v1/fee-proposals/{id}/withdraw` | `agreements:write` + Idempotency-Key | `{ reason? }`: any open state → `WITHDRAWN`; idempotent; 409 `PROPOSAL_NOT_OPEN` once converted |
| `POST /v1/agreements` (M3) | — | optional `feeProposalId` (not in the preview token): 422 `PROPOSAL_NOT_FOUND` / `PROPOSAL_PROJECT_MISMATCH` / `PROPOSAL_NOT_AGREED`; on success the proposal is `CONVERTED` with `agreementId`, in the same transaction (409 `PROPOSAL_NOT_OPEN` on a race) |
| `GET /v1/summaries/projects/{id}` and customer summary rows (M6) | — | `ProjectSummary.proposal: FeeProposalSummary | null` = `{ id, status, pricingBasis, proposedAmount, agreedAmount, proposedOn, agreementId }`, the open one else the latest converted one |

`FeeProposalStatus`: `PROPOSED / CLIENT_APPROVED / AGREED / CONVERTED / WITHDRAWN`. Audit: `fee_proposal.created / client_approved / agreed / withdrawn / converted` (entity type `fee_proposal`). `PATCH /v1/projects/{id}` refuses a currency change with `CURRENCY_LOCKED` while a proposal is open.

## 4. Malafat-side client obligations

- Call only from the server; never from the browser or Flutter (MAL-4).
- Map every error code to the UX taxonomy (invalid / revoked / expired / missing scope / mismatch / unavailable / rate limited / unexpected) — no generic failure text.
- Mint the `Idempotency-Key` when the review step renders, persist it with the attempt, and on timeout query `GET /v1/operations/{key}` before ever re-posting.
- Treat `missingScopes` from `GET /v1/integration` as a configuration error to display, not to work around.
- Generate the typed client from `openapi/openapi.yaml`; add a contract test that fails when the committed YAML changes shape.
