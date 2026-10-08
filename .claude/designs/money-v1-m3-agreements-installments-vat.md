# Money v1 — Milestone 3: Fixed-fee agreements, installments and VAT (design brief)

- **Date:** 2026-10-08 · **Status:** approved with amendments (rev. 2) and **implemented** the same day — CHANGELOG "Money v1 Milestone 3"; 196 tests green
- **Tickets:** MUT-25 (epic), MAL-939 · **Contract:** `money-v1-api-contract.md` §3 M3 · **Plan:** §3.4, §4, §6, §12.5
- **Repo side:** Mutaba3a `server/` only. The Malafat side (agreement wizard, matter financial tab) follows in its own Confluence brief once this API exists.
- **Bounded by:** ADR-024/025/026, the M2 brief (projects carry one currency; `hasPostedActivity` hook), MAL-870 (Money included), TD-018 (operator keys).

## 1. Problem and acceptance criteria

M2 gave the ledger its parties and containers. Nothing can yet be *owed*. M3 introduces the first obligations: a fixed-fee agreement on a project, split into installments, each of which becomes a receivable when it is posted, with VAT computed once, deterministically, from an effective-dated rate the firm controls. Everything later (payments and allocations in M4, retainers in M5, summaries in M6) consumes receivables, so this milestone fixes the money math and the posting model for the whole product.

Acceptance (plan §16 M3, restated in `money-v1-m3-agreements-installments-vat-tests.md`):

1. A firm sets its VAT rate with an effective date; posted records keep the rate they were posted with even after a later rate change.
2. `POST /v1/agreements/preview` returns net / VAT / gross and every installment's amount and due date; the same body posted to `POST /v1/agreements` with the preview token creates exactly what was previewed; a VAT-rate change between preview and post is refused as `PREVIEW_STALE`.
3. Money arithmetic never touches a JavaScript `number`; rounding is half-up on minor units; installment amounts always sum to the agreement gross; per-installment net and VAT always sum to the agreement's net and VAT.
4. Installments post (become receivables with a due date) immediately, on a date, or on a manual trigger; a manual trigger is idempotent.
5. `GET /v1/receivables` lists what is owed with a status computed on the server in the organization's timezone: `PENDING / DUE / OVERDUE / PARTIALLY_PAID / PAID` (the last two are reachable only after M4 payments; the code path exists and is tested with seeded paid amounts).
6. A positive supplement changes the contractual amount and lands on unposted installments or a new one; a negative supplement is accepted only within the unposted capacity, and the response names the posted receivables it could not touch (plan §12.5).
7. Every write is idempotent and audited; cross-organization reads are impossible; OpenAPI regenerated, `openapi:check` green, API version `1.2.0-m3`.

## 2. Proposed solution

### 2.1 Money math (`src/vat.ts`, `src/agreements/schedule.ts`, pure)

- **Rates are basis points** (`1800` = 18 %), stored as integers; never a float.
- **Rounding:** half-up on minor units, implemented with `bigint` integer division: `round(n × r / 10000)` = `(n × r + 5000) / 10000` for positive `n`, mirrored for negative.
- **Agreement totals** from `(amount, pricingBasis, vatTreatment, rateBp)`:
  - `STANDARD_RATED` + `VAT_EXCLUSIVE`: net = amount; vat = round(net × rate); gross = net + vat.
  - `STANDARD_RATED` + `VAT_INCLUSIVE`: gross = amount; net = round(gross × 10000 / (10000 + rate)); vat = gross − net.
  - `ZERO_RATED`, `EXEMPT`, `OUT_OF_SCOPE`: vat = 0; net = gross = amount; rate frozen as 0. The three are kept distinct because they report differently (plan §6), not because they compute differently.
- **Installment split** on the **gross**: amounts given → must sum exactly to gross (`422 VALIDATION_FAILED`, reason `INSTALLMENTS_DO_NOT_SUM`, details carry the difference); percents given (basis points, must sum to 10000, reason `PERCENTS_DO_NOT_SUM`) → each installment = round(gross × pct / 10000), **the last installment absorbs** the rounding remainder so Σ = gross. Per-installment net = round(gross_i × 10000 / (10000 + rate)), last absorbs so Σnet_i = net; vat_i = gross_i − net_i. Mixed amount/percent in one agreement → `422`.
- **Limits:** 1–60 installments; amount > 0; labels ≤ 80 chars.

### 2.2 Data model (migration `m3_agreements_installments_vat`)

```
vat_rates                     agreements                           installments
─────────                     ──────────                           ────────────
id, organization_id           id, organization_id                  id, organization_id
rate_basis_points int         project_id → projects                agreement_id → agreements
effective_from date           customer_id (denormalised)           position int
created_at                    type          FIXED                  label
UNIQUE (org, effective_from)  status        ACTIVE | CANCELLED     gross_minor, net_minor, vat_minor  bigint
                              currency      char(3)                trigger_type  IMMEDIATE | DATE | MANUAL
receivables                   pricing_basis VAT_EXCLUSIVE|VAT_INCLUSIVE   trigger_date date?
───────────                   vat_treatment STANDARD_RATED|ZERO_RATED|EXEMPT|OUT_OF_SCOPE
id, organization_id           vat_rate_basis_points int (frozen)   due_date date?   (null = due on the trigger date)
customer_id, project_id       amount_minor  bigint (contractual, in pricing basis)
agreement_id?, installment_id?  net_minor, vat_minor, gross_minor bigint
origin  INSTALLMENT | ADJUSTMENT  agreement_date date              posted_at timestamptz?
currency                      description?                         receivable_id? → receivables (1:1 once posted)
net_minor, vat_minor, gross_minor  version int                     version int
vat_rate_basis_points         created_at, updated_at               UNIQUE (agreement_id, position)
paid_minor bigint default 0  (M4 writes it)
due_date date                 agreement_supplements
posted_at timestamptz         ─────────────────────
status  OPEN | SETTLED        id, organization_id, agreement_id, amount_minor (signed, pricing basis),
version                       description?, effective_date, distribution LAST_UNPOSTED | PRORATE_UNPOSTED | NEW_INSTALLMENT,
INDEX (org, customer_id)      resulting_amount_minor, request_id, created_at
INDEX (org, project_id)
INDEX (org, due_date)
```

- **Amounts are `bigint` columns** (Postgres `BIGINT`), minor units; the wire carries canonical decimal strings (`src/money.ts`). Prisma maps `BigInt` natively.
- **Receivable rows are created only when an installment posts.** Before posting, an installment is a scheduled obligation (`PENDING`) visible on the agreement, not in `GET /v1/receivables`. This keeps "what is owed today" literal, which is what the Malafat summaries will render.
- **Posting is lazy for `DATE` triggers:** on every read or write that touches an agreement, installments whose `trigger_date ≤ today (org timezone)` are posted (receivable created, `posted_at` set, audit `installment.posted`). No scheduler needed until M5, which adds a reconcile job that does the same thing on a timer. Posting is idempotent and transactional, so concurrent readers cannot double-post.
- **Statuses are computed, not stored**, except `receivables.status` (`OPEN | SETTLED`, flipped by M4). Installment/receivable display status: `PENDING` (not posted), `DUE` (posted, due date ≥ today, nothing paid), `OVERDUE` (posted, due date < today, outstanding > 0), `PARTIALLY_PAID` (0 < paid < gross), `PAID` (paid = gross). `today` = calendar date in the organization's `timezone`.
- **Project currency lock:** `projects.hasPostedActivity` becomes "the project has at least one agreement" — stricter than the M2 wording ("anything posted"), because an agreement with only manual installments is still a commitment in that currency. *(Decision 3.)*

### 2.3 Routes (all `/v1`, Bearer key; scopes per contract)

| Method & path | Scope | Idempotency | Behaviour |
|---|---|---|---|
| `GET /vat-rates` | `agreements:read` | — | all rates, newest first, plus `current` for today |
| `PUT /settings/vat` | `agreements:write` | — (append-only by `effectiveFrom`) | `{ rateBasisPoints (0–10000), effectiveFrom }`; same `effectiveFrom` again → `200` unchanged if equal, `409 CONFLICT` `RATE_ALREADY_SET` if different (history is immutable; add a later date instead) |
| `POST /agreements/preview` | `agreements:read` | — | body as `POST /agreements` minus the token; resolves the rate effective on `agreementDate` (`422` reason `VAT_RATE_MISSING` for `STANDARD_RATED` with none); returns totals, installments (amount, net, vat, trigger, due date, status it will have), `vatRateBasisPoints`, `previewToken` |
| `POST /agreements` | `agreements:write` | `Idempotency-Key` | same body + `previewToken`; token = sha256(org, canonical body, rateBp) so a rate change → `409 PREVIEW_STALE`; project must be ACTIVE and its customer ACTIVE (`422` reasons `PROJECT_ARCHIVED` / `CUSTOMER_ARCHIVED`); `currency`, if sent, must equal the project's (`422 CURRENCY_MISMATCH`); creates agreement + installments, posts `IMMEDIATE` ones and due `DATE` ones; `201` |
| `GET /agreements?projectId=&customerId=&status=` , `GET /agreements/{id}` | `agreements:read` | — | agreement with installments (status computed) and supplements |
| `POST /agreements/{id}/supplements` | `agreements:write` | `Idempotency-Key` | `{ amount (signed), description?, effectiveDate, distribution, newInstallment?: { label, trigger, dueDate? } }`. Positive: added to the last unposted installment / prorated across unposted / a new installment (required when nothing is unposted). Negative: applied to unposted installments (last first / prorated); if `|amount| >` unposted capacity → `422` reason `SUPPLEMENT_EXCEEDS_UNPOSTED` with `details.requiresAdjustment = { postedReceivables: [...], shortfall }` (plan §12.5 safeguard; credits land in M4). Response: `{ agreement, supplement, effect: { contractualDelta, installmentsChanged: [...], installmentsCreated: [...] } }` |
| `POST /installments/{id}/trigger` | `agreements:write` | `Idempotency-Key` | `MANUAL` only (`422` reason `NOT_MANUAL` otherwise); optional `{ dueDate }`; posts the receivable; already posted → `200` unchanged |
| `POST /agreements/{id}/cancel` | `agreements:write` | `Idempotency-Key` | allowed only while **no installment is posted** (`409 CONFLICT` reason `AGREEMENT_HAS_POSTED_RECEIVABLES`); status `CANCELLED`, installments void; idempotent *(Decision 5)* |
| `GET /receivables?customerId=&projectId=&currency=&status=&dueBefore=&dueAfter=`, `GET /receivables/{id}` | `payments:read` | — | posted receivables: gross, outstanding (= gross − paid), due date, origin, computed status; paginated |

VAT treatment and pricing basis are **frozen on the agreement**; a supplement uses the agreement's rate at its `effectiveDate`? No — *(Decision 4)*: a supplement uses the **agreement's frozen rate**, because it amends one contract; a firm that needs the new rate signs a new agreement. Simple, auditable, and what the plan's "posted records keep the rate they were posted with" implies.

New `details.reason` values (published in the API description, existing error codes): `VAT_RATE_MISSING`, `RATE_ALREADY_SET`, `INSTALLMENTS_DO_NOT_SUM`, `PERCENTS_DO_NOT_SUM`, `MIXED_INSTALLMENT_BASIS`, `CURRENCY_MISMATCH`, `PROJECT_ARCHIVED`, `CUSTOMER_ARCHIVED`, `NOT_MANUAL`, `SUPPLEMENT_EXCEEDS_UNPOSTED`, `AGREEMENT_HAS_POSTED_RECEIVABLES`, `AGREEMENT_CANCELLED`.

### 2.4 Component diagram

```
routes/vat.ts ─────────┐                                   ┌─ repositories/ports.ts
routes/agreements.ts ──┼─ requireScope · idempotent ───────┼─ VatRateRepository
routes/installments.ts ┤                                   ├─ AgreementRepository (agreement + installments + supplements, transactional)
routes/receivables.ts ─┘                                   └─ ReceivableRepository
        │
        ├─ vat.ts                 pure: totals from (amount, basis, treatment, rateBp); half-up bigint rounding
        ├─ agreements/schedule.ts pure: installment split (amounts | percents), per-installment net/vat, last-absorbs
        ├─ agreements/status.ts   pure: installment/receivable display status from (posted, due, paid, today)
        ├─ agreements/posting.ts  postDueInstallments(store, org, today): the lazy DATE posting, transactional
        ├─ agreements/preview-token.ts  sha256(org | canonical body | rateBp)  (same pattern as import)
        └─ dates.ts               today(timezone) → YYYY-MM-DD via Intl; compare/add days without Date math on amounts
repositories/memory.ts · repositories/prisma.ts (BigInt columns) · store-contract-m3.ts
```

### 2.5 Reuse

| Reused | From |
|---|---|
| `parseMoney` / `formatMoney` / `addMoney` … (`src/money.ts`) — extended with `multiplyRound(money, bp)` and `divideRound` | M1 |
| `requireScope`, `idempotent`, `ApiError`, `routes/shared.ts` (page helpers, conflict/validation responses, `versionMismatch`) | M1/M2 |
| Preview-token pattern (PATTERNS.md "proof of same rows"), here extended to freeze the rate | M2 |
| Plan-then-execute (preview computes everything; create re-computes and compares) | M2 |
| Desktop disciplines only: the VAT treatment taxonomy (`exempt / authorized / …` → the four treatments) and "never sum across currencies" (ADR-004). No desktop code is imported (ADR-024). | — |

### 2.6 Impact

- M1/M2 routes unchanged except `projects.hasPostedActivity` (now true with any agreement) and `POST /projects/{id}/archive` (refused while receivables are outstanding: `409` reason `PROJECT_HAS_OUTSTANDING`, promised in M2).
- `API_VERSION` → `1.2.0-m3`; additive OpenAPI.
- Scopes already exist (`agreements:*`, `payments:read`); no key re-issue.
- Malafat obligations created (own brief): agreement wizard with the preview step (`previewToken` must be minted when the review step renders — contract §4), matter financial tab reading `GET /agreements?projectId=` and `GET /receivables?projectId=`, VAT settings page (`PUT /settings/vat`), and refresh of the vendored contract (`npm run openapi:json`).

### 2.7 i18n, cost, infra

- i18n: none server-side; reasons are machine codes.
- Cost: four tables, bounded lists; lazy posting touches one agreement's installments per request.
- Infra: one migration through `deploy.sh`; no new resources.

## 3. Decisions requested before build

1. **Rounding and split:** half-up on minor units; VAT computed on the whole agreement; installments split the gross with the last absorbing the remainder; per-installment net/VAT derived the same way so sums reconcile. (The alternative, computing VAT per installment and summing, can drift from the agreement VAT by a few agorot and would have to be reported.)
2. **No default VAT rate.** The firm sets effective-dated rates; a `STANDARD_RATED` agreement with no rate on its date is refused. (Alternative: seed 18 % for Asia/Jerusalem organizations. Rejected: the service must not guess a jurisdiction; PS firms pay 16 %.)
3. **Posting model:** receivables exist only once posted; `DATE` installments post lazily when read after their date (no scheduler until M5); the project's currency locks as soon as it has an agreement.
4. **Supplements use the agreement's frozen rate**; positive supplements always succeed (new installment when nothing is unposted); negative ones only within unposted capacity, otherwise refused with the posted receivables named. Credits against posted receivables are M4 (with reversals).
5. **Cancel** only while nothing is posted; afterwards the M4 path applies.
6. **Due dates:** default = the trigger date; an explicit `dueDate` per installment; a manual trigger may set one. No payment-terms presets on fixed-fee agreements (those belong to retainers, M5).
7. **Out of scope for M3:** retainers, payments/allocations, invoice documents or numbering, summaries, agreement edits other than supplements and cancel.

Approve all seven (or amend) and Phase 2 starts: tests first (`…-tests.md` is written), then `vat.ts` / `schedule.ts` / `status.ts`, the store, routes and OpenAPI.

## 4. Revision 2 — product-owner amendments (2026-10-08)

Decisions 1, 3, 4, 5 approved as written. Three amendments change the design:

**A. VAT is per payable item, not per agreement (decision 2 amended).**
Whether VAT applies depends on the matter type and on the client (local vs
foreign). So:
- The firm's effective-dated **rate** table stays (it is the standard rate; a
  `STANDARD_RATED` item with no rate on its date is still refused).
- The **treatment** (`STANDARD_RATED | ZERO_RATED | EXEMPT | OUT_OF_SCOPE`) is
  resolved per item with a default chain: installment/charge override →
  agreement → project `vatTreatment` → customer `vatTreatment` →
  `STANDARD_RATED`. Customers and projects gain a nullable `vatTreatment`
  (settable on create and PATCH), so a foreign client is marked once and every
  matter under it inherits.
- Consequence for the math (decision 1 restated): installments split the
  **contractual amount in its pricing basis** (not the gross); each
  installment's net / VAT / gross is computed from **its own** treatment and
  the frozen rate; agreement totals are the sums. Rounding is still half-up
  per item and the last installment still absorbs the split remainder. Sums
  reconcile by construction.

**B. Due dates default to end of month, with the plan's terms vocabulary
(decision 6 amended).** `paymentTerms: IMMEDIATE | EOM | EOM_15 | EOM_30 |
EOM_45 | EOM_60`, default `EOM`: due = end of the posting month (+ N days).
Set per agreement, overridable per installment, and a manual trigger may pass
an explicit `dueDate`. Same vocabulary for retainer charges.

**C. Retainers are in scope, basic form only (decision 7 amended).** The plan's
recurring agreement, without the full cycle:
- `POST /v1/retainers/preview`, `POST /v1/retainers` (`type RECURRING`:
  `monthlyAmount`, `pricingBasis`, `vatTreatment?`, `startMonth`,
  `billingDay` 1–28 (default 1), `paymentTerms`, `endMonth?`).
- Charges: one per service month, unique per (agreement, month), generated
  idempotently up to today by `POST /v1/retainers/reconcile` and lazily on
  reads (same mechanism as dated installments); each charge posts a
  receivable (`origin RETAINER_CHARGE`) with its own treatment.
- `GET /v1/retainers/{id}/charges`; retainers list through
  `GET /v1/agreements?type=RECURRING`.
- `POST /v1/retainers/{id}/cancel` `{ effectiveDate, finalMonth: FULL | WAIVE }`
  — stops generation after the effective month; `WAIVE` skips the effective
  month if not yet posted. **Not in M3:** effective-dated amendments
  (`/changes`), proration, credits for posted charges — a change is cancel +
  new retainer until M5.
- Still out of scope: receiving payments (M4), invoice numbering, summaries.

API version `1.2.0-m3`. Added `details.reason` values: `BILLING_DAY_INVALID`,
`START_MONTH_INVALID`, `END_BEFORE_START`, `NOT_RECURRING`, `NOT_FIXED`.
