# MUT-443: correct a recorded payment in one atomic call

**Status:** PLANNED 2026-10-28, awaiting Basel's answers on D1–D9.
**Ticket:** MUT-443 (parent MUT-25). Blocks MAL-1367 "Correct a recorded payment in one step".
**Numbers:** API `1.88.0-mut443`, ADR-225, TD-284 onward, store snapshot 13 (only with D1 B), migration after `20261028200000`.
**Builds on:** MUT-480 (`CREDIT_REASON_CODES`, ADR-222), MUT-481 (`carriedReceiptNumber`, ADR-223), M4 allocation preview (brief decision 2), ADR-086 (correction date floor).

## Problem

Today a correction is two calls: `POST /v1/payments/{id}/reverse`, then `POST /v1/payments` with `replacesPaymentId`. If the connection drops in between, the payment stays reversed with no replacement and the client's balance is wrong.

## Acceptance criteria (from the ticket)

1. A correction reverses and records together; a failure leaves the original POSTED and untouched.
2. Replaying the same Idempotency-Key returns the stored outcome and never posts twice.
3. A stale previewToken answers 409 `PREVIEW_STALE`.
4. Correcting a payment already REVERSED answers 409 `PAYMENT_NOT_POSTED`.
5. An empty reason answers 422 `REASON_REQUIRED`.
6. Allocations follow the existing rules: unallocated money stays as credit; over-allocation is refused with the receivable named.
7. The OpenAPI contract version is bumped.

## Design

### Routes (`server/src/routes/payments.ts`, API key only, scope `payments:write`; preview `payments:read`)

- `POST /v1/payments/{paymentId}/correct/preview`: writes nothing.
- `POST /v1/payments/{paymentId}/correct`: `idempotent(store, 'payments.correct')`, so a replay of the same `Idempotency-Key` returns the stored response (AC2).

Body (both; `previewToken` only on correct):
`amount`, `receivedOn`, `method`, `reference?`, `notes?`, `receiptNumber?` (MUT-481 rule), `allocations?` | `strategy?`, `reasonCode`, `note?`, `previewToken`.
The customer and currency are the original's and are not in the body (out of scope: moving a payment to another client or currency).

### The one store write (`PaymentRepository.correct`)

```
correct(organizationId, paymentId, { expectedVersion, reason, reasonCode, replacement: CreatePaymentInput }, at)
  → { reversed: PaymentRecord; payment: PaymentRecord; allocations: AllocationRecord[] }
```
- **Prisma:** one `$transaction` inside `paymentWrite` (the year-counter retry). The body of today's `reverse` becomes `reverseTx(tx, …)`, conditional on `status = 'POSTED' AND version = expectedVersion`. A miss throws `StateConflict('payment', status)`. Then the existing `createPaymentTx(tx, { …replacement, replacesPaymentId: paymentId })`, which locks and checks every receivable (`InsufficientCapacity`). Any throw rolls both back (AC1).
- **Memory (and so local mode):** checks everything before touching anything. That covers the status and version, and each new allocation against outstanding plus what this payment's reversal releases. Then it reverses and creates. `reverse` and `create` share their internals with it; no copy.
- `reverse` keeps its signature and behaviour (it calls `reverseTx`).

### Allocation engine (`server/src/payments/allocate.ts`), extended, not forked

- `releaseAllocations(receivables, released)`: the receivables as they would read once this payment's allocations are undone (paid lowered, status OPEN again when something is outstanding). Pure, unit-tested.
- `resultingBalances(allocations, scope, today, released = [])`: the applied amount becomes `new − released`, so *before* is the ledger now and *after* is after the correction. Existing callers pass nothing and are unchanged.
- The pool for validation and suggestion = the eligible receivables ∪ the receivables the original paid, after `releaseAllocations`. So the correction may pay again what the original paid, and over-allocation is refused with `receivableId` exactly as today (AC6). Unallocated money stays on the new payment (AC6).

### Preview response (`CorrectPaymentPreviewResponse`)

The allocation preview's own fields (`customerId`, `currency`, `amount`, `allocations`, `allocated`, `unallocated`, `eligible`, `balances`, `warnings`, `previewToken`) so Malafat reuses its review, plus
`reversal: { paymentId, number, amount, receivedOn, receiptNumber, released: [{ receivableId, amount }] }` and the resolved `receiptNumber` the new payment will carry.
`balances` runs from the ledger now to the ledger after the correction.

### Token (`paymentCorrectPreviewToken`)

`[org, 'payment-correct', paymentId, payment.version, body (amount, receivedOn, method, reference, notes, resolved receiptNumber, sorted allocations, reasonCode, note), snapshot(id, version) of the pool]`.
Any payment, credit or posting on those receivables, or any change to the original (a receipt number set, a reversal), changes a version: 409 `PREVIEW_STALE` (AC3). A store-level race (`InsufficientCapacity`, `LockConflict`) is also 409 `PREVIEW_STALE`.

### Refusals

| Case | Answer |
|---|---|
| The original is REVERSED (at read, or lost a race in the store) | 409 `PAYMENT_NOT_POSTED` (new in CONFLICT_REASONS; AC4) |
| `reasonCode` missing, or OTHER with an empty `note` | 422 `REASON_REQUIRED` (checked in the handler, so it is not a generic schema failure; AC5) |
| A person's capture (origin CAPTURE) | 422 `PAYMENT_NOT_CORRECTABLE` (D4) |
| Allocation errors | the existing reasons with `receivableId` (AC6) |
| Bad receipt number | 422 `RECEIPT_NUMBER_INVALID` (MUT-481) |
| `receivedOn` in the future / absurd / below the floor | existing rules, with the ADR-086 correction exemption (D3) |

### Audit

One `payment.corrected` on the original payment: `{ replacementPaymentId, number, replacementNumber, reasonCode, note, amount: { from, to }, receivedOn: { from, to }, method: { from, to }, receiptNumber, receiptNumberCarried, allocationsReleased, allocations, unallocated }`. Plus `receivable.settled` for each receivable the new payment settles, which is the receivable's own history, as `POST /v1/payments` writes it. No separate `payment.reversed` or `payment.recorded`.

### Response

`200 { reversed: Payment, payment: Payment }`, so Malafat refreshes both rows without a second read (D6).

## Decisions for Basel

- **D1 Reason stored how?**
  - **B (recommended):** a new nullable `reversalReasonCode` column on payments. It shows on the payment (`reversalReasonCode`) and on the statement's PAYMENT_REVERSAL line, as credits carry `reasonCode` since MUT-480, so Malafat can label it in Arabic and English. That means a migration plus local snapshot 13. `reversalReason` keeps the text (`note ?? code`).
  - **A:** no new column. The code goes into the `reversalReason` text and the audit only, so Malafat can't tell a code from a note.
- **D2** A reversed original is 409 `PAYMENT_NOT_POSTED`, as the ticket says, even though the allocation preview uses the same code as a 422. Recommended: yes, as written.
- **D3 Date floor:** the corrected payment may keep the original's date or move it later even below the ten-year floor (the ADR-086 correction exemption). Earlier than that and below the floor is refused. Recommended: yes.
- **D4** Only payments the key recorded (origin INTEGRATION) can be corrected. A person's capture is 422 `PAYMENT_NOT_CORRECTABLE`, and the phone keeps its date-only PATCH. Recommended: yes.
- **D5** Audit as above: one `payment.corrected` plus `receivable.settled` per settled receivable. Recommended: yes.
- **D6** The response is `{ reversed, payment }`. Recommended: yes.
- **D7** `correct` also accepts `strategy` (the ticket lists it), resolved exactly as the preview does; explicit `allocations` win. Recommended: yes.
- **D8** The plain `reverse` route stays free-text. Taking an optional `reasonCode` there too is a follow-up, not this ticket. Recommended: leave it.
- **D9** No session (portal or phone) route. Recommended: as the ticket says.

## Files

- `server/src/payments/allocate.ts`: `releaseAllocations`, the `released` parameter on `resultingBalances`.
- `server/src/payments/preview-token.ts`: `paymentCorrectPreviewToken` and its parts.
- `server/src/payments/correct.ts` (new): the composer shared by both routes, `composeCorrection(store, org, payment, body, today)` → `{ pool, value, balances, token, receipt, released }`.
- `server/src/routes/payments.ts`: the two routes, reusing `plan`/`parseAllocations`/`receiptNumberOf`/`viewOf`.
- `server/src/repositories/ports.ts`, `memory.ts`, `prisma.ts`: `correct`; `reverseTx` extracted. With D1 B, also `reversalReasonCode` on `PaymentRecord`, the records export, the serializers and the statement serializer.
- `server/prisma/schema.prisma` + migration `20261028210000_mut443_payment_reversal_reason_code` (D1 B).
- `server/src/schemas.ts`: request and response schemas, `PAYMENT_NOT_POSTED` in CONFLICT_REASONS, `PAYMENT_NOT_CORRECTABLE` in VALIDATION_REASONS.
- `server/src/app.ts`: `API_VERSION = '1.88.0-mut443'` and the pinned literals in `routes-m*.test.ts`.
- Local mode (D1 B): `src/hosted/local/migrations` 12→13, the fingerprint, everyRecord.
- Generated: `openapi.yaml`, `src/hosted/api/schema.d.ts`.

## Test plan (written first)

- `payments/__tests__/allocate.test.ts`: `releaseAllocations` reopens a settled receivable and leaves others alone; `resultingBalances` with `released` (before = now, after = after correction; an unchanged allocation nets to zero).
- Store contract `store-contract-mut443.ts` on memory and Prisma:
  - correct reverses and records in one write, and `replacesPaymentId` links them;
  - a capacity failure leaves the original POSTED with its allocations and version, and no new payment or number;
  - a reversed or other-version original throws `StateConflict` and writes nothing;
  - two corrections racing produce one replacement;
  - the correction may re-pay what the original paid.
- Routes `__tests__/payments-correct.test.ts`:
  - AC1–AC7, each by name;
  - the preview's `reversal` and balances;
  - receipt number carried, cleared or replaced;
  - D3 floor;
  - D4 capture refused;
  - the audit row;
  - `strategy`;
  - a changed original version is PREVIEW_STALE;
  - key-only (session is 403).
- Local mode 12→13 migration and fingerprint (D1 B).

Commands: `npm --prefix server test` with `MUTABA3A_TEST_DATABASE_URL` on `mutaba3a_test_mut443`; server typecheck, lint, openapi:check; root lint, typecheck, test:run, build. All through `heavy`.

## QA scenarios (release-qa, `portal-selfservice.malafat-money-api.payment-correct`)

1. Malafat records a ₪1,000 payment with receipt 3001 against a ₪1,000 charge, which settles it.
2. Malafat previews correcting it to ₪600 on a later date, reason ENTERED_BY_MISTAKE. The preview releases ₪1,000, allocates ₪600, and the charge goes from ₪0 to ₪400 outstanding.
3. Malafat confirms. The original reads REVERSED with the reason, and the replacement is POSTED with receipt 3001, ₪600 allocated, and replacesPaymentId.
4. Malafat sends the same request again with the same key. The answer is the same, and there is still exactly one replacement.
5. Malafat tries again with an old preview (409 PREVIEW_STALE), on the reversed original (409 PAYMENT_NOT_POSTED), with OTHER and no note (422 REASON_REQUIRED), and with more than is outstanding (422 ALLOCATION_EXCEEDS_OUTSTANDING naming the charge).
6. Malafat reads the statement. It shows the payment line, its reversal line with the reason, and the new payment line, and the balance is ₪400.

## Business / product impact

- A partner fixes a wrong amount, date or method in one step, and a dropped connection can no longer leave a client's balance wrong with the payment reversed and nothing recorded in its place.
- It unblocks MAL-1367 in the Malafat Money overhaul (MAL-1410); it is the fourth of six API tickets in today's run (480 → 481 → 479 → **443** → 444 → 483).
- Low risk: one new write path built from the existing reverse and record internals, and nothing changes for the routes in use today.

## Eng review 2026-10-28 (independent; no CRITICAL; folded in, these win where the sections above differ)

- **R1 (HIGH) Lock order.** The Prisma transaction runs in this order:
  1. the conditional payment update (`status = 'POSTED' AND version = expected`);
  2. the year counter (a `nextPaymentNumberTx` split out of `createPaymentTx`);
  3. `lockReceivablesInIdOrder(released ∪ new)`, once;
  4. release the original's allocations;
  5. insert the payment and `applyAllocations`, whose re-locks are no-ops.

  This is the order a plain create already uses (counter, then receivables in id order), so the two cannot deadlock. A Prisma test with overlapping released and new receivables runs against a concurrent create.
- **R2 (HIGH) Balances.**
  - `resultingBalances` keeps a row when `applied !== 0n`, so a receivable that is only released shows, going from ₪0 to ₪400.
  - Balances run over eligible ∪ released as they are now (before = the ledger now). Validation and suggestion use the `releaseAllocations` pool.
  - The token is verified against that pool, not `listEligible`.
- **R3 Idempotency.** Any 4xx is stored under the key, so after any 409 the caller sends a new Idempotency-Key, as the reverse route already documents. 409 `PAYMENT_NOT_POSTED` carries `reversedAt` and `replacedByPaymentId`, so Malafat recovers from a lost response under any key. Both are tested.
- **R4 StateConflict split.**
  - A REVERSED original → 409 `PAYMENT_NOT_POSTED`.
  - A POSTED original at another version (an allocation or receipt number landed in between) → 409 `PREVIEW_STALE`.
- **R5 Reason outside the token.**
  - The reason is optional on the preview and not hashed, as in the MUT-480 reduce.
  - `reasonCode` is `.optional()` in the schema. `correct` checks it in the handler before composing: missing, or OTHER without a note → 422 `REASON_REQUIRED`.
- **R6 Allocations required.** `allocations` (may be `[]`) is required unless `strategy` is sent, so a date-only correction never silently unallocates.
- **R7 Memory `correct` is synchronous** between its checks and its writes (private helpers, not the async `reverse`/`create`).
- **R8 Statement order.** The replacement is stamped `at + 1 ms`, so its line sorts after the reversal's on the same day. ADR-225 states that the reversal is dated the correction day. Statement test.
- **R9 Audit.**
  - `payment.corrected` on the original.
  - `payment.recorded` on the replacement, with `replacesPaymentId`, so the replacement has its own history.
  - `receivable.settled` only for receivables whose status changes.
- **R10 Edge rulings (defaults, pending Basel):**
  - `reference` and `notes` follow the receipt-number rule: left out keeps the original's, `null` clears, a value replaces.
  - An archived customer is 422 `CUSTOMER_ARCHIVED`, as record answers.
  - A correction that changes nothing is 422 `NOTHING_TO_CORRECT`.
  - `postDueItems` runs first, as record does.
- **R11 D3's reason, restated.** ADR-086's exemption rested on "the reversal already committed", which is no longer true. ADR-225 keeps the rule for its own reason: the correction replaces the original's own record, so the original's date is not a new back-dated entry.
- **R12** The OpenAPI description says `PAYMENT_NOT_POSTED` is the 409 here (it is a 422 on the allocation preview) and is the same state as `ALREADY_REVERSED` on reverse.
- **Tests added:**
  - one for each of R1–R6 and R8;
  - re-paying a receivable that another payment settled since;
  - the records-export column;
  - the serializer fields;
  - local mode 12→13, following the pattern of `addReductionFields`.
