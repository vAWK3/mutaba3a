# Money v1 — Milestone 4: Payments, allocations, reversals and credits (design brief)

- **Date:** 2026-10-08 · **Status:** approved as proposed (all eight decisions) and **implemented** the same day — CHANGELOG "Money v1 Milestone 4"; 268 tests green on memory and Postgres
- **Tickets:** MUT-25 (epic), MAL-939 · **Contract:** `money-v1-api-contract.md` §3 M4 · **Plan:** §7, §12.5, §12.7, §14.2, §16 M4
- **Repo side:** Mutaba3a `server/` only. The Malafat side (payment wizard Record → Allocate → Review, payment detail with reversal, credits from the supplement safeguard) follows in its own brief once this API exists, as M3 did.
- **Bounded by:** ADR-024/025/026, the M3 brief (receivables exist only once posted; `paid_minor` reserved for M4; statuses computed in the organization timezone; "posted records keep what they were posted with"), ADR-004 (never sum across currencies), TD-018 (operator keys).

## 1. Problem and acceptance criteria

M3 made things owed. Nothing can yet be paid: every receivable shows `paid 0.00`, `PARTIALLY_PAID` and `PAID` are reachable only through a test seed, and three M3 refusals point here — a reduction beyond unposted capacity (`SUPPLEMENT_EXCEEDS_UNPOSTED`), a waived retainer month that already posted, and the archive guard on a project with outstanding receivables. M4 is the milestone that makes balances move: a payment is recorded once, allocated to receivables of the same customer and currency, previewed before it is posted, reversible as a whole, and reconcilable after a lost response. It also adds the one explicit adjustment the plan promised: a credit against a posted receivable.

Acceptance (plan §16 M4, restated in `money-v1-m4-payments-allocations-tests.md`):

1. `POST /v1/allocations/preview` returns the allocation set (explicit or suggested by a strategy), the unallocated remainder and the resulting balance and status of every touched receivable, project and customer, with a `previewToken`; `POST /v1/payments` with that token creates exactly what was previewed; a balance change in between is refused as `PREVIEW_STALE`.
2. A payment and its allocations are one transaction: `paid_minor` on every allocated receivable moves, `status` flips to `SETTLED` when nothing is outstanding, and a failure anywhere leaves nothing behind. `GET /v1/receivables` and `GET /v1/agreements/{id}` show `PARTIALLY_PAID` / `PAID` from real payments.
3. An allocation can never exceed the payment (`ALLOCATION_EXCEEDS_PAYMENT`), a receivable's outstanding (`ALLOCATION_EXCEEDS_OUTSTANDING`), or cross a customer or currency boundary (`RECEIVABLE_CUSTOMER_MISMATCH`, `CURRENCY_MISMATCH`). Money is never converted.
4. Unallocated funds stay on the payment and can be allocated later through the same preview → post discipline; nothing is ever auto-applied.
5. `POST /v1/payments/{id}/reverse` undoes every allocation atomically, marks the payment `REVERSED` with a reason, is idempotent, and refuses a second reversal (`ALREADY_REVERSED`). Posted payments are otherwise immutable; a corrected payment links to the reversed one.
6. `POST /v1/receivables/{id}/credits` reduces what is outstanding on a posted receivable without changing its posted figures, computing the VAT share at the receivable's frozen rate and treatment; a credit beyond the outstanding is refused (`CREDIT_EXCEEDS_OUTSTANDING`).
7. `GET /v1/operations/{idempotencyKey}` tells a client whose request timed out whether the write completed (`COMPLETED` with the stored response), is still running (`PENDING`), or never completed (`404`, safe to retry with the same key).
8. Every write is idempotent and audited; cross-organization reads are impossible; OpenAPI regenerated, `openapi:check` green, API version `1.3.0-m4`; every M1–M3 test still green.

## 2. Proposed solution

### 2.1 Money math (`src/payments/allocate.ts`, `src/payments/credit.ts`, pure)

- **Outstanding** of a receivable = `gross − paid − credited`, all `bigint` minor units. It is the only quantity allocations and credits are checked against. `status = SETTLED` iff outstanding = 0 (and `OPEN` otherwise, including after a reversal re-opens it).
- **Explicit allocations** are validated, never adjusted: each `amount` > 0, each receivable once, same customer, same currency, `OPEN`, `amount ≤ outstanding`, `Σ ≤ payment amount`. The remainder `payment − Σ` is the unallocated amount (≥ 0).
- **Strategies** produce a suggestion from the eligible receivables (customer + currency, `OPEN`, outstanding > 0); the client may edit it and post the edited set:
  - `OLDEST_FIRST`: order by `dueDate`, then `postingDate`, then `id`; fill each to its outstanding until the amount runs out.
  - `SETTLE_MATTERS`: group by project; take the projects whose whole outstanding fits in what remains, smallest total first (ties by oldest due date), filling each project oldest-first; then spend what is left oldest-first across the rest. A matter is settled in full whenever the money allows it.
- **Resulting balances** are computed from the validated set: per receivable (outstanding before → after, status after, using the organization-timezone `today`), per project and per customer (outstanding and overdue before → after, in the payment currency only).
- **Credit VAT split** at the receivable's frozen `vatRateBasisPoints` and `vatTreatment`: for `STANDARD_RATED` the credit is a gross amount; `net = round(credit × 10000 / (10000 + rate))`, `vat = credit − net` (same half-up `bigint` rounding as `src/vat.ts`); the other treatments carry `vat = 0`. A credit's `net + vat = credit` by construction.

### 2.2 Data model (migration `m4_payments_allocations_credits`)

```
payments                                    payment_allocations
────────                                    ───────────────────
id, organization_id                         id, organization_id
customer_id → customers                     payment_id → payments
number          text   PAY-YYYY-NNNN        receivable_id → receivables
currency        char(3)                     amount_minor bigint (> 0)
amount_minor    bigint (> 0)                created_at
allocated_minor bigint (Σ allocations)      INDEX (organization_id, payment_id)
received_on     date                        INDEX (organization_id, receivable_id)
method          CASH | BANK
reference, notes  text?                     receivable_credits
status          POSTED | REVERSED           ──────────────────
reversed_at timestamptz?, reversal_reason?  id, organization_id
replaces_payment_id → payments?             receivable_id → receivables
request_id, version, created_at, updated_at amount_minor, net_minor, vat_minor  (positive magnitudes)
INDEX (org, customer_id)                    reason text, effective_date date
INDEX (org, created_at, id)                 request_id, created_at
UNIQUE (org, number)                        INDEX (organization_id, receivable_id)

receivables  + credited_minor bigint default 0        payment_counters
             (status SETTLED ⇔ gross − paid − credited = 0)  organization_id, year, next int; PK (organization_id, year)
```

- `paid_minor` and `credited_minor` are denormalised sums maintained in the same transaction as the rows that justify them; the contract test asserts they equal the sums of allocations and credits.
- `payments.number` is assigned inside the posting transaction from `payment_counters` (row lock on `(organization, year)`), so numbers are gap-free per organization and year and a replayed request keeps its number. The year is the organization-timezone year of `received_on`.
- Nothing is deleted or edited after posting: a payment changes only through `reverse` (status, reversed_at, reason) and `allocations` (new rows, `allocated_minor`); receivables change only through their denormalised sums and `status`; credits are append-only.

### 2.3 Routes (all `/v1`, Bearer key)

| Method & path | Scope | Idempotency | Behaviour |
|---|---|---|---|
| `POST /allocations/preview` | `payments:read` | — | `{ customerId, currency, amount } \| { paymentId }` (the second previews allocating a posted payment's unallocated funds) + `strategy?: OLDEST_FIRST \| SETTLE_MATTERS` + `allocations?: [{ receivableId, amount }]`. Explicit `allocations` win over `strategy`; neither → the unallocated set. Posts due items first (lazy posting), validates, returns `{ allocations, unallocated, eligible: [receivables with outstanding], balances: { receivables[], projects[], customer }, previewToken }`. Writes nothing |
| `POST /payments` | `payments:write` | `Idempotency-Key` | `{ customerId, currency, amount, receivedOn, method: CASH \| BANK, reference?, notes?, replacesPaymentId?, allocations: [...], previewToken }`; customer ACTIVE (`CUSTOMER_ARCHIVED`); `replacesPaymentId` must be a `REVERSED` payment of the same customer (`REPLACES_NOT_REVERSED`, `REPLACES_CUSTOMER_MISMATCH`); token verified against the body and the current receivable versions (`409 PREVIEW_STALE`); one transaction: payment + allocations + receivable sums/status + number; audit `payment.recorded` (+ `receivable.settled` per receivable reaching 0); `201` |
| `GET /payments?customerId=&projectId=&status=&receivedBefore=&receivedAfter=`, `GET /payments/{id}` | `payments:read` | — | payment with its allocations (each carrying the receivable's project id, origin and current outstanding), `unallocated`, `replacesPaymentId`, `replacedByPaymentId` (derived); `projectId` filters payments with an allocation on that project; paginated |
| `POST /payments/{id}/allocations` | `payments:write` | `Idempotency-Key` | `{ allocations: [...], previewToken }` from a `{ paymentId }` preview; payment must be `POSTED` (`PAYMENT_NOT_POSTED`) with unallocated funds (`NO_UNALLOCATED_FUNDS`); `Σ ≤ unallocated` (`ALLOCATION_EXCEEDS_PAYMENT`); `200` payment; audit `payment.allocated` |
| `POST /payments/{id}/reverse` | `payments:write` | `Idempotency-Key` | `{ reason }` (1–500 chars); undoes every allocation (receivables' `paid_minor` reduced, `SETTLED → OPEN` where outstanding returns), `allocated_minor → 0`, status `REVERSED`; a replay returns the same result; a *different* request on an already reversed payment → `409 CONFLICT` reason `ALREADY_REVERSED`; audit `payment.reversed` |
| `POST /receivables/{id}/credits` | `payments:write` | `Idempotency-Key` | `{ amount, reason, effectiveDate? }` (amount > 0, the magnitude of the credit, in the receivable's currency; `effectiveDate` defaults to today); receivable `OPEN` (`RECEIVABLE_NOT_OPEN`); `amount ≤ outstanding` (`CREDIT_EXCEEDS_OUTSTANDING` with `details.outstanding`); appends the credit with its VAT split, updates `credited_minor` and status; `201 { receivable, credit }`; audit `receivable.credited` |
| `GET /receivables/{id}/credits` | `payments:read` | — | the credits on a receivable, newest first |
| `GET /operations/{idempotencyKey}` | `payments:read` | — | the organization's stored outcome for that key: `{ key, operation, status: PENDING \| COMPLETED, responseStatus?, response?, createdAt, completedAt? }`; `404 NOT_FOUND` when the key was never claimed or was released after a 5xx — in both cases the client may retry with the same key (plan §12.7, §14.2) |

Receivable serialization gains `credited` (sum of credits) next to `paid` and `outstanding`; installment and charge statuses already read `paid_minor` through the receivable and now also subtract `credited_minor`. `countOutstandingByProject` (archive guard) uses the same outstanding.

New `details.reason` values (published in the API description): 422 — `ALLOCATION_EXCEEDS_PAYMENT`, `ALLOCATION_EXCEEDS_OUTSTANDING`, `ALLOCATION_DUPLICATE`, `RECEIVABLE_NOT_OPEN`, `RECEIVABLE_CUSTOMER_MISMATCH`, `PAYMENT_NOT_POSTED`, `NO_UNALLOCATED_FUNDS`, `CREDIT_EXCEEDS_OUTSTANDING`, `REPLACES_NOT_REVERSED`, `REPLACES_CUSTOMER_MISMATCH`, `NO_ELIGIBLE_RECEIVABLES` (strategy requested, nothing to allocate to — the preview still succeeds with an empty set; this reason appears only in `warnings`); 409 — `ALREADY_REVERSED`. Existing: `CURRENCY_MISMATCH`, `CUSTOMER_ARCHIVED`, `AMOUNT_INVALID`, `DATE_INVALID`, `PREVIEW_STALE`.

### 2.4 Component diagram

```
routes/payments.ts ───────┐                                ┌─ repositories/ports.ts
routes/allocations.ts ────┼─ requireScope · idempotent ────┼─ PaymentRepository   (payment + allocations + receivable sums + number, one transaction;
routes/receivables.ts (+credits) ┤                         │                      allocate; reverse)
routes/operations.ts ─────┘                                ├─ ReceivableRepository (+ credit, listCredits, listEligible(customer, currency))
        │                                                  └─ IdempotencyRepository (+ get(organization, key))
        ├─ payments/allocate.ts   pure: validate explicit set; OLDEST_FIRST / SETTLE_MATTERS suggestions; resulting balances
        ├─ payments/credit.ts     pure: credit VAT split at the frozen rate (reuses vat.ts rounding)
        ├─ payments/preview-token.ts  sha256(org | canonical body | eligible receivables' (id, version)) — "same world" (Decision 2)
        └─ payments/numbering.ts  PAY-YYYY-NNNN from the counter row
repositories/memory.ts · repositories/prisma.ts · store-contract-m4.ts
```

### 2.5 Reuse

| Reused | From |
|---|---|
| `parseMoney` / `formatMoney` / `bigint` arithmetic, half-up rounding (`vat.ts`) | M1/M3 |
| `requireScope`, `idempotent`, `ApiError`, `routes/shared.ts` (pages, conflict/validation/not-found responses, `versionMismatch`) | M1/M2 |
| Preview token module (`src/preview-token.ts`, canonical JSON, bigint-safe) — extended with the receivable snapshot | M2/M3 |
| Plan-then-execute (preview computes everything; post re-computes and compares) | M2/M3 |
| Lazy posting before any read or write that touches receivables (`postDueItems`) | M3 |
| `itemStatus` / `receivableStatus` — unchanged, now fed by real `paid` and `credited` | M3 |
| Desktop disciplines only: ADR-004 (one currency per figure), the allocation vocabulary of the desktop "partial payment" work (`docs/todo` note); no desktop code imported (ADR-024) | — |

### 2.6 Impact

- M1–M3 routes unchanged in shape; receivable responses gain `credited` (additive). `GET /v1/agreements/{id}` and `GET /v1/retainers/{id}/charges` show real `PARTIALLY_PAID` / `PAID`.
- `API_VERSION` → `1.3.0-m4`; additive OpenAPI.
- Scopes `payments:read` / `payments:write` already exist; no key re-issue.
- Malafat obligations created (own brief): payment wizard (Record → Allocate → Review) with the preview on the review step and `attemptId`-based idempotency plus the "not confirmed" path through `GET /v1/operations/{key}`; payment list and detail with reversal; "Record corrected payment" prefill; credit dialog reachable from the supplement safeguard and from a receivable row; refresh of the vendored contract.

### 2.7 i18n, cost, infra

- i18n: none server-side; reasons are machine codes.
- Cost: four tables, bounded lists; a preview reads one customer's open receivables in one currency (indexed); a post touches one payment and its allocated receivables.
- Infra: one migration through `deploy.sh`; no new resources.

## 3. Decisions requested before build

1. **Allocation strategies:** `OLDEST_FIRST` (due date, then posting date) and `SETTLE_MATTERS` (whole matters that fit, smallest first, then oldest-first for the rest). A strategy only *suggests*; the client posts an explicit set, which is validated and never silently adjusted. (Alternative: let the server auto-allocate on post with a strategy name. Rejected: the Partner must see what each matter will show before anything moves — wireframe §6b/§6d.)
2. **The preview token covers the balances, not just the body.** It hashes the body *and* the `(id, version)` of every eligible receivable for that customer and currency, so a payment or credit posted between review and confirm is refused as `PREVIEW_STALE` and the review must be redone. This is stricter than the M2/M3 "same rows" tokens because the review step shows resulting balances that would otherwise be wrong.
3. **Unallocated funds live on the payment** (`amount − allocated`, never negative) and are allocated later through the same preview → post discipline (`{ paymentId }` preview, `POST /payments/{id}/allocations`). No auto-application to new receivables, no customer-level "credit balance" object; the customer's unallocated total is a sum over its posted payments, which M6 summaries report.
4. **Reversal is whole and final.** A payment is immutable once posted; the only correction is reversing all of it (allocations undone, `REVERSED`, reason kept) and recording a new payment that carries `replacesPaymentId`. No edits, no partial reversal, no re-allocation of a reversed payment. (Alternative: editable allocations with an audit trail. Rejected: the plan's ledger discipline is append-only, and partial corrections hide what happened.)
5. **Credits are append-only rows on the receivable, not new receivables.** `outstanding = gross − paid − credited`; the posted `gross / net / vat` never change; each credit carries its own net/VAT split at the receivable's frozen rate and treatment; a credit cannot exceed the outstanding (what is already paid is not refunded by a credit — refunds are out of scope for v1). This is the "explicit adjustment" the M3 safeguard, the waived-but-posted retainer month and the archive guard all point to. The `ADJUSTMENT` receivable origin stays reserved for a positive adjustment, which v1 does not need because supplements already add installments.
6. **Payments get a number**, `PAY-YYYY-NNNN`, gap-free per organization and year, assigned in the posting transaction and shown to the Partner (wireframe §6e/§7). Invoice numbering stays out of scope: this is a receipt reference for a payment, not a tax document.
7. **Operations lookup semantics:** `COMPLETED` for any stored 2xx/4xx outcome (both are final), `PENDING` while a claim is held, `404` when the key was never claimed or was released by a 5xx — in which case retrying with the same key is safe. No `FAILED` state is stored, because a released key must be reusable (ADR-025 §5). The contract doc's `FAILED` wording is amended accordingly.
8. **Out of scope for M4:** refunds and negative payments, FX, summaries (M6), attachments and receipts (M6), retainer amendments and proration (M5), bank-statement import, write-offs as a separate concept (a write-off is a credit with a reason), payment methods beyond `CASH | BANK`.

Approve all eight (or amend) and Phase 2 starts: tests first (`…-tests.md` is written), then `allocate.ts` / `credit.ts` / `numbering.ts`, the store, routes and OpenAPI.
