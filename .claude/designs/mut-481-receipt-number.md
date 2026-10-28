# MUT-481 — A receipt number on payments, carried on statement lines

Status: PLAN (eng-ticket, 2026-10-28). Not built. Jira Backlog.
Tracker: Jira · barmajiyat · MUT via atlassian-barmajiyat · Backlog → In Progress (eng-build) → In Review (qa-reconcile).
Branch: `feature/mut-481-receipt-number` (worktree `.claude/worktrees/mut-481`), from main c4fb69ec.
Numbers (next free at merge): API `1.86.0-mut481`, ADR-223, TD-282 onward, `CURRENT_STORE_SNAPSHOT_VERSION` 11.

## Neighborhood
- Epic MUT-25. No formal blockers. Blocks Malafat's "Record payment v2" receipt field (MAL-1420, In Review) and the payment sheet (MAL-1422). Relates to MUT-443 (correct a payment in one call, Backlog), which must carry `receiptNumber` through its correction.
- MUT-478 (merged) owns the statement; its D-notes deferred `receiptNumber` on PAYMENT lines to this ticket.
- MUT-480 (merged c4fb69ec) is the latest change to the same files (schemas, serializers, statement serialize, snapshot 10).

## Where the code is today
- `POST /v1/payments` (`routes/payments.ts:203-260`), API key only. `reference` (≤ 120) holds the transfer reference. A correction today is two calls: `POST /v1/payments/{id}/reverse`, then `POST /v1/payments` with `replacesPaymentId` naming the REVERSED payment (same customer; the first replacement keeps the date exemption).
- `GET /v1/payments` filters by customer, project, status, dates, origin, allocationState (`PaymentFilter`, both stores).
- Person-made payments (capture, settle, inbox) are written through `payments.capture`/settle paths with no bank fields by type.
- The statement's PAYMENT and PAYMENT_REVERSAL lines read the payment record (`statements/serialize.ts:45-50`).
- `PATCH /v1/payments/{id}` exists for sessions only (re-date a person's own capture, MUT-223).

## Decisions (D5 approved by Basel 2026-10-28; the rest recommended defaults)

**D1 — A correction keeps the number unless it says otherwise.** On `POST /v1/payments` with `replacesPaymentId`: `receiptNumber` absent → the replaced payment's number is carried over; `null` → none; a string → that one. Without `replacesPaymentId`, absent = null. MUT-443's one-call correct will reuse the same rule (one helper, `carriedReceiptNumber`). This is how AC3 holds today, before MUT-443.

**D2 — Not unique.** The reversed original and its replacement share a number by D1, and a receipt can cover several transfers. Exact-match filter `GET /v1/payments?receiptNumber=` (trimmed, case-sensitive), index `(organizationId, receiptNumber)`.

**D3 — Shape.** Trimmed; 1–64 characters after trimming; no control characters; any script (Arabic, Hebrew, digits, `/`, `-`). An empty or whitespace-only string is 422 `RECEIPT_NUMBER_INVALID` (send `null` or omit it to mean "none").

**D4 — On both statement lines of a payment.** PAYMENT and PAYMENT_REVERSAL lines carry `receiptNumber` (nullable), so the ledger reads "Receipt 2041" and "Reversal of receipt 2041".

**D5 — Set it after recording (APPROVED A by Basel 2026-10-28).** Firms often issue the receipt in their invoicing app after the money is recorded, so the number is known later. The ticket scopes it to create and correct, and a correction is reverse + re-record (two ledger lines) just to add a number.
- A (recommended): `PUT /v1/payments/{id}/receipt-number` `{ receiptNumber: string | null }`, API key, `payments:write`, `If-Match` on the payment version, idempotent; POSTED only (409 `PAYMENT_REVERSED`); audits `payment.receipt_number_set` with before/after. No money moves, so no preview.
- B: create and correct only, as the ticket says; Malafat sets the number when recording, and a late number means reverse + re-record.

**D6 — Malafat-fed payments only.** Person-made payments (capture, settle, inbox) never carry one: their inputs don't have the field, and reads return `null`. Platforms: Malafat web only.

**D7 — Audit.** `payment.recorded` gains `receiptNumber` when set (and `receiptNumberCarried: true` when D1 carried it).

## API
- `CreatePaymentRequestSchema.receiptNumber?: string | null` (D3).
- `PaymentSchema.receiptNumber: string | null`.
- `ListPaymentsQuerySchema.receiptNumber?: string`.
- Statement PAYMENT / PAYMENT_REVERSAL lines: `receiptNumber: string | null`.
- (D5 A) `PUT /v1/payments/{id}/receipt-number`.
- Errors: 422 `RECEIPT_NUMBER_INVALID`; (D5 A) 409 `PAYMENT_REVERSED`, 412/409 version per the existing `ifMatch()` convention.

## Files
- `server/prisma/schema.prisma` + migration `2026102818xxxx_mut481_payment_receipt_number`: `payments.receiptNumber VARCHAR(64) NULL`, index `(organizationId, receiptNumber)`. Additive, nullable.
- `server/src/payments/receipt-number.ts` (new, pure): `normalizeReceiptNumber(raw)` (D3) and `carriedReceiptNumber({ given, replaced })` (D1). Unit-tested.
- `repositories/ports.ts`: `PaymentRecord.receiptNumber: string | null`; `CreatePaymentInput.receiptNumber?: string | null`; `PaymentFilter.receiptNumber?`; (D5 A) `payments.setReceiptNumber(org, id, expectedVersion, value, at)` → `UpdateResult`.
- `repositories/prisma.ts` + `memory.ts`: persist, filter, (D5 A) the conditional update (bumps `version`, POSTED only). Capture/settle/inbox writers default it to null.
- `routes/payments.ts`: create (D1, D3, D7), list filter, (D5 A) the PUT route.
- `schemas.ts`, `serializers.ts` (payment view), `statements/serialize.ts` (D4), `statements/build.ts` only if the line type needs the field passed through.
- `auth/store-guard.ts`: (D5 A) `setReceiptNumber: { write: 'payments' }`.
- `app.ts`: `API_VERSION` 1.86.0-mut481 + the pinned literals; `openapi:generate`; root `npm run hosted:types` (the portal's generated types).
- Local mode: snapshot 11 (`pays` gain `receiptNumber`, migration 10 → 11 fills null), fingerprint expectation, `everyRecord` fixture records one payment with a number; `prisma-records-export.ts` selects the column.

## Tests (written first)
- `payments/__tests__/receipt-number.test.ts`: D3 table (trim, 64 vs 65, empty, whitespace, control chars, Arabic/Hebrew); D1 table (absent/null/string × replaced with/without).
- Store contract `store-contract-mut481.ts` (memory + Prisma): persists, filter exact match (other org's number never matches), (D5 A) set with version / stale / reversed refusal.
- Route `__tests__/payment-receipt-number.route.test.ts`:
  - AC1: create with and without; 422 on invalid.
  - AC2: on `GET /v1/payments/{id}`, the list, `?receiptNumber=` filter, and the statement PAYMENT and PAYMENT_REVERSAL lines.
  - AC3: reverse + record with `replacesPaymentId`: absent keeps it, a string changes it, null clears it.
  - AC4: the pinned version literals (routes-m2..m8).
  - Person-made payments read `receiptNumber: null` (D6); audit carries it (D7); (D5 A) PUT happy path, If-Match mismatch, reversed → 409.
- Local mode migration 10 → 11 test.

Verify through `heavy`, Node 22: server typecheck, lint, `openapi:check`, test (+ Postgres on a throwaway `mutaba3a_test_mut481`); root lint, typecheck, `test:run`, build.

## Release-QA
Feature `receipt-number` in `qa/features/portal-selfservice/malafat-money-api.yaml`, spec in `malafat-money-api.spec.ts`:
- Malafat records a payment with receipt 2041, finds it by `?receiptNumber=2041`, and reads it on the statement.
- Malafat corrects it (reverse, record the replacement without a number) and the replacement still shows 2041; both statement lines show it.
- (D5 A) Malafat records one without a number and sets it later.

## Knowledge
- ADR-223: receipt numbers are a label, not a document (D1–D6).
- CHANGELOG, TEST_PLAN, SYSTEM_OVERVIEW line; comment on MUT-443 (reuse `carriedReceiptNumber`).

## Scope check
Covers AC1–AC4. Out: issuing or numbering receipts; the receipt PDF (MAL-1422 attaches it through the existing attachments, kind RECEIPT); person-made payments (D6). D5 A is the one addition beyond the ticket's words; Basel chose it.

## Business / product impact
- The firm's ledger and statement show the legal receipt number beside each payment, so a partner and the accountant reconcile against the invoicing app without opening it.
- Unblocks MAL-1420's receipt field and MAL-1422's payment sheet in the Money overhaul (MAL-1410).
- Risk is low: an additive nullable column and a label; no money figure changes.

## Review 2026-10-28 (adversarial plan review; wins where it differs from the sections above)
- **R1. D5 is If-Match only, not idempotent.** The idempotency fingerprint ignores headers and stores 4xx answers, so a retry after a 409 would replay the 409. `PUT /v1/payments/{id}/receipt-number` uses `ifMatch()` alone, like every If-Match route; when the stored value already equals the requested one it answers 200 with no version bump and no audit, so a retry after a lost response succeeds.
- **R2. Error codes.** A missing or malformed If-Match is 422 (the middleware's); a stale version is 409 `VERSION_MISMATCH`; a reversed payment is 409 `ALREADY_REVERSED` (the code `reverse` already uses), never a new `PAYMENT_REVERSED`. `RECEIPT_NUMBER_INVALID` joins `VALIDATION_REASONS`.
- **R3. The store tells reversed from stale.** `setReceiptNumber` writes `WHERE id, organizationId, version, status = POSTED`; on a miss it re-reads without the status filter and returns `stale` with the record, so the route answers `ALREADY_REVERSED` when the record is REVERSED, else `VERSION_MISMATCH` (`reverse` bumps the version without checking it).
- **R4. `CreatePaymentInput.receiptNumber: string | null` is required**, so every writer says which it is (the port's MUT-61 rule): `routes/payments.ts` create, `routes/receivables.ts` settle, `routes/inbox.ts`, `capture` in both stores, the `everyRecord` fixture.
- **R5. D1 hoists `replaced`** out of the `replacesPaymentId` check in create. Absent vs null stay distinct through zod and the idempotency body comparison. A correction replay is deterministic (a reversed payment's number can't change: the PUT is POSTED-only). The OpenAPI description warns that sending `receiptNumber: null` on a correction clears it, so MAL-1420 must omit the field to keep it.
- **R6. D3 runs in the handler** (`normalizeReceiptNumber`), with zod only a loose raw bound (string ≤ 200), so a bad value answers `RECEIPT_NUMBER_INVALID`, not a generic zod failure. A blank `?receiptNumber=` filter is ignored, like the other filters.
- **R7. The PUT refuses sessions** with `keyActorOf(c)` first (a disconnected firm's session holds `payments:write`).
- **R8. Local mode:** the `addReceiptNumber` 10 → 11 step and `MIGRATIONS` row; the version docblock line; `migrations.test.ts`'s hard-coded `toBe(10)` becomes `LOCAL_FORMAT_VERSION`; the fingerprint's `pays.receiptNumber: 'null|string'` needs a fixture payment with a number, an INTEGRATION one (D6 says captures never carry one). Carry-over replays through `/v1/income`, so it is unaffected.
- **R9. `statements/build.ts` needs no change** (lines carry the whole payment); only `serialize.ts` and the line schemas.
- **R10.** `serializePayment` lists fields by hand: add it there; settle's response then shows `receiptNumber: null` (a D6 test).
- **Found in passing (MUT-480):** its new reasons were never added to the published lists (`REDUCTION_EXCEEDS_OPEN`, `USE_CANCEL`, `REASON_REQUIRED` to `VALIDATION_REASONS`, `INSTALLMENT_VOIDED` to `CONFLICT_REASONS`). Fixed in this branch as its own commit.
