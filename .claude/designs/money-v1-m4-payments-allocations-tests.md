# Money v1 — Milestone 4 test plan

Companion to `money-v1-m4-payments-allocations.md`. Written before implementation. Bracketed numbers are the brief's acceptance criteria.

## Unit (pure, no I/O)

| File | Cases |
|---|---|
| `src/payments/__tests__/allocate.test.ts` | **explicit set:** valid set accepted with the remainder as unallocated; `Σ > payment` → `ALLOCATION_EXCEEDS_PAYMENT` with the excess; `amount > outstanding` → `ALLOCATION_EXCEEDS_OUTSTANDING` naming the receivable and its outstanding; the same receivable twice → `ALLOCATION_DUPLICATE`; a `SETTLED` receivable → `RECEIVABLE_NOT_OPEN`; another customer's receivable → `RECEIVABLE_CUSTOMER_MISMATCH`; another currency → `CURRENCY_MISMATCH`; zero or negative amount → `AMOUNT_INVALID`; outstanding honours `credited` (gross 1000, paid 300, credited 200 → 500). **`OLDEST_FIRST`:** fills by due date then posting date then id; stops exactly at the amount; a payment larger than everything owed leaves the rest unallocated; empty eligible set → empty suggestion + `NO_ELIGIBLE_RECEIVABLES` warning. **`SETTLE_MATTERS`:** two projects (3 000 and 5 000 outstanding) and 6 000 received → the 3 000 project settled, 3 000 oldest-first into the other; 8 000 received → both settled; 2 000 received (nothing fits whole) → oldest-first; ties broken by oldest due date. **Resulting balances:** per receivable before → after with status after (`PAID` when it reaches 0, `PARTIALLY_PAID` or `OVERDUE` otherwise by today), per project and per customer outstanding and overdue, only in the payment currency; no `number` anywhere in the module (grep guard like M3) |
| `src/payments/__tests__/credit.test.ts` | 18 % standard-rated credit of 1 180.00 → net 1 000.00 / vat 180.00; 100.00 → 84.75 / 15.25; 0.01 → 0.00 / 0.01? — pinned: net 0.01, vat 0.00 (half-up on 0.0085 → 0.01); `ZERO_RATED` / `EXEMPT` / `OUT_OF_SCOPE` → vat 0; rate 0 → vat 0; `net + vat = credit` for a table of 20 amounts and 4 rates; credit > outstanding → `CREDIT_EXCEEDS_OUTSTANDING` with the outstanding; credit ≤ 0 → `AMOUNT_INVALID` |
| `src/payments/__tests__/numbering.test.ts` | `PAY-2026-0001`, `PAY-2026-0099`, `PAY-2026-10000` (no truncation past 4 digits); the year is the one in `receivedOn`, which the client already expresses as a calendar date in the organization timezone (no instant conversion is involved) |
| `src/payments/__tests__/preview-token.test.ts` | token changes with the body, the organization, and any eligible receivable's version; stable when an *ineligible* receivable (other customer or currency) changes; constant-time verify |

## Storage contract (`store-contract-m4.ts`, memory + Postgres)

| Case |
|---|
| `payments.create` writes the payment, its allocations, every receivable's `paid_minor` and `status`, and the number, atomically: an allocation to a receivable that no longer has room rolls everything back (nothing in `payments`, counters unchanged) [2] |
| numbers are gap-free per (organization, year) under 20 concurrent creates; two organizations each start at 0001 [6] |
| `payments.allocate` appends allocations and moves `allocated_minor` and the receivables' sums in one transaction; refuses when the payment is `REVERSED` |
| `payments.reverse` restores every allocated receivable's `paid_minor`, reopens `SETTLED → OPEN`, zeroes `allocated_minor`, sets status/reason/timestamp; a second reverse returns the record unchanged with `changed=false` [5] |
| `receivables.credit` appends the credit and moves `credited_minor` and `status`; `listCredits` newest first; `paid_minor` and `credited_minor` equal the sums of their rows after any sequence of create / allocate / reverse / credit (property check over a random sequence) [6] |
| `receivables.listEligible(customer, currency)` returns `OPEN` receivables with outstanding > 0 only, oldest due first; `countOutstandingByProject` subtracts credits |
| `payments.list` filters by customer, project (through allocations), status and received-on range; keyset pagination; cross-organization isolation on every method |
| `idempotency.get` returns the stored claim with status and body; absent after `fail` [7] |
| BigInt round-trips for amounts ≥ 2^53 minor units on payments, allocations and credits |

## Routes (`routes-m4.test.ts`, in-memory app, injected clock + organization timezone)

| Area | Cases |
|---|---|
| Preview | scope matrix (`payments:read` suffices, `payments:write` alone does not); `{customerId, currency, amount}` with no allocations and no strategy → everything unallocated; `strategy` suggestions match the pure module; explicit set wins over strategy; `{ paymentId }` form previews the payment's unallocated funds and refuses a `REVERSED` payment; lazy posting runs first (a `DATE` installment due today appears in `eligible`); preview writes nothing; archived customer → 422 `CUSTOMER_ARCHIVED`; mixed-currency allocation → 422 `CURRENCY_MISMATCH` [1][3] |
| Post | token mismatch → 409 `PREVIEW_STALE`; a credit or another payment between preview and post → 409 `PREVIEW_STALE`; happy path → 201 with `number`, allocations, `unallocated`, receivables show `paid` / `outstanding` / `PARTIALLY_PAID` / `PAID`; agreement detail shows the installment `PAID`; `GET /receivables?status=SETTLED` lists the settled one; replay with the same key → same payment and number, `Idempotent-Replayed: true`; different body same key → 422 `IDEMPOTENCY_KEY_REUSED`; `replacesPaymentId` of a `POSTED` payment → 422 `REPLACES_NOT_REVERSED`; of another customer's payment → 422 `REPLACES_CUSTOMER_MISMATCH`; audit `payment.recorded` and `receivable.settled` [1][2][8] |
| Allocate later | `POST /payments/{id}/allocations` with a `{ paymentId }` preview token → 200, `unallocated` shrinks; exceeding unallocated → 422 `ALLOCATION_EXCEEDS_PAYMENT`; nothing left → 422 `NO_UNALLOCATED_FUNDS`; on a `REVERSED` payment → 422 `PAYMENT_NOT_POSTED`; audit `payment.allocated` [4] |
| Reverse | reverses a fully allocated payment: receivables back to `DUE` / `OVERDUE` with `paid 0.00`, agreement installment back to `DUE`; reverses an unallocated payment (no receivable touched); `reason` required (1–500); replay → same body; a second reverse with a new key → 409 `ALREADY_REVERSED`; `GET /payments/{id}` shows `status REVERSED`, `reversedAt`, `reversalReason`; a new payment with `replacesPaymentId` → the old one shows `replacedByPaymentId`; audit `payment.reversed` [5] |
| Credits | credit within outstanding → 201 with the VAT split at the frozen rate, receivable `credited` and `outstanding` updated, status `PAID` when it reaches 0 (`SETTLED` in the list filter); credit beyond outstanding → 422 `CREDIT_EXCEEDS_OUTSTANDING` with `details.outstanding`; on a `SETTLED` receivable → 422 `RECEIVABLE_NOT_OPEN`; `GET /receivables/{id}/credits` newest first; `POST /projects/{id}/archive` succeeds once credits bring every receivable to 0; a reversal after a credit re-opens only what the credit did not cover; audit `receivable.credited` [6] |
| Operations | `GET /operations/{key}` → `COMPLETED` with the stored 201 body after a successful post; `COMPLETED` with the stored 422 after a validation failure; `PENDING` while a claim is held (held claim seeded through the store); 404 for an unknown key and after a 5xx released it; another organization's key → 404 [7] |
| Statuses | the same receivable half-paid is `PARTIALLY_PAID` before its due date and `OVERDUE` after it (organization timezone); `PAID` wins over `OVERDUE` |
| Lists | `GET /payments` filters by customer, project, status and received range; pagination; cross-organization 404 on `GET /payments/{id}` |
| Contract | every new path in `/openapi.json`; `info.version` `1.3.0-m4`; new reasons in the description; `openapi:check` green [8] |

## Regression

- Every M1–M3 test green (196 today); `npm run smoke` unchanged.
- The M3 tests that seed `paid_minor` through `seedPaid` are rewritten to post a real payment; `seedPaid` is removed from the memory store.

## Not automated

- Malafat-side payment wizard, detail and reversal (separate brief).
- A manual run on production after deploy: record one payment on the pilot firm against a posted receivable, confirm the receivable shows `PAID`, reverse it, confirm it shows `DUE` again.
