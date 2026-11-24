# MUT-643: a credit note against a paid invoice, with a refund or a kept credit

**Status:** plan, waiting for Basel's approval (2026-11-24). Epic MUT-566. Follows MUT-568 (ADR-260 decision 4, R-D2).

**Basel's choices (2026-11-24):**
- **C1:** the person chooses for each credit note what happens to the part the client already paid. *Refunded* records money going back (date, method, reference). *Kept* leaves it as the client's credit toward their next invoices.
- **C2:** a refund is a ledger line beside the credit note, not a numbered document. Whether a refund needs its own document is added to the accountant questions on MUT-567.

## Problem and acceptance criteria
Today a credit note (330) credits only what is still owed on a tax invoice (305): the store refuses anything more with 422 `ORIGINAL_PAID`. An invoice-receipt (320) is always fully paid, so it can't be credited at all. A business that refunds a client has no way to issue the credit note.

- **AC1 (ticket):** a credit note for a fully paid 320 issues, and the client's statement shows the refund.
- **AC2 (ticket):** the credit notes on one original never add up to more than its total.
- **AC3 (C1):** choosing *Kept* leaves the paid part as the client's unallocated money: their balance shows it as credit, and it can be applied to their next Owed.
- **AC4:** Received totals (In & out, Reports, the monthly activity) count a refund as money going out on its date, so they stay right.
- **AC5:** a payment that a refund drew on can't be reversed or undone (409), just as MUT-709 guards a payment that has a receipt.
- **AC6:** portal and phone, Arabic first and English, plus release-QA flows.

## Solution

**D1. What a credit note may credit.** Its original may be a 305 or a 320. The most it can credit is the original's gross minus the earlier credit notes on it. Above that the issue is refused with 422 `CREDIT_EXCEEDS_ORIGINAL` (`maximum`). The check and the write both happen under the original Owed's row lock, so two credit notes issued at the same time can't both pass (AC2). `ORIGINAL_PAID` is no longer sent; an old phone build shows its generic error.

**D2. How the credit is split.** For a credit of G, where O is still owed: the first `min(G, O)` credits what is owed, exactly as today. The rest, `R = G − min(G, O)`, is the paid part. The Owed's `creditedMinor` goes up by G and its `paidMinor` down by R, so paid + credited never exceeds gross.

**D3. Releasing the paid part.** R comes off the allocations that pay this Owed, newest first (by `createdAt`, then `id`). The released allocation rows get `releasedAt`; if only part of an allocation is released, a smaller live allocation takes its place. Each payment's `allocatedMinor` goes down by what was released from it. This is the same mechanism a reversal uses.

**D4. The choice the request must carry.** When R > 0 the issue body must include `paidPart`. Without it the request is refused with 422 `PAID_PART_CHOICE_REQUIRED` (`paidMinor: R`).
- `paidPart: { mode: 'KEEP' }`: the money released in D3 stays as unallocated money on its payments. That is the client's credit (AC3), and existing allocation (MUT-412 and the oldest-first rule) can apply it later.
- `paidPart: { mode: 'REFUND', refundedOn, method, reference? }`: a new **refund** row records the money going back, and **refund sources** take the released amounts from those same payments. Each payment's `allocatedMinor` goes back up by what it gave, because refunded money counts as used. Every existing calculation of `amount − allocated` (97 places) stays right with no change.
- `refundedOn` follows the person-money date rules (`pastMoneyDate`), may not be before the original's date, and is checked against the credit note's own date.

**D5. Data (one migration, additive).**
- `refunds`: id, organizationId, customerId, currency, amountMinor, refundedOn, method, reference, issuedDocumentId, requestId, createdByUserId, createdAt.
- `refund_sources`: id, organizationId, refundId, paymentId, amountMinor.

Both tables are insert-only (a row trigger, like the issuing tables, with no bypass), because a refund belongs to an immutable credit note. Both join `PURGE_PROFILE_TABLES`: they are ledger rows, not documents. `IssuedDocument` gains a nullable `refundId`, next to `creditId`.

**D6. Where refunds show.**
- **Statement and ledger card:** a new line kind `REFUND`, a debit dated `refundedOn`. It ranks after PAYMENT_REVERSAL, and its label names the credit note. This is an additive enum value, safe for Malafat because Malafat profiles never issue (ADR-260 decision 7).
- **Activity (Received):** what was received minus refunds, by `refundedOn` (AC4).
- **Payment and entry views:** a payment's response gains `refundedMinor` (additive), so the entry drawer shows "₪X refunded with credit note N" instead of reading the payment as fully allocated.
- **Settlement (the client's Documents tab):** a credit note covering the whole original makes it CANCELLED (unchanged). A 320 credited in part stays PAID.

**D7. Guards.** Reversing or undoing a payment with a refund source is refused with 409 `PAYMENT_HAS_REFUND` (AC5). This goes in `payments/document-guard.ts`, beside the MUT-709 receipt guard.

**D8. Records file.** A signed-in Download carries the live ledger (MUT-325). It gains `refunds` and `refund_sources`, and the local-mode restore takes them as a new snapshot step. Otherwise a restored payment would read as unallocated money. Local mode itself can't issue, so it never writes a refund.

**D9. Uniform file (MUT-569).** Unchanged: the 330 is already exported, and a refund is not a document (C2). Whether the export should carry a refund line is an accountant question on MUT-567.

## Where the code goes
- `server/src/issuing/ledger-plan.ts`: the credit-note plan gains `paidPart` (credit G, release R, refund or keep). Pure, unit-tested.
- New `server/src/issuing/credit-split.ts`: the D2/D3 maths (split, newest-first release). Pure, shared by both stores.
- `server/src/repositories/ports.ts`, `memory.ts`, `prisma.ts`: the issue path, refund rows, `refundedMinor` on payment reads, and the D7 guard. One shared contract test runs both stores.
- `server/src/routes/issuing.ts` and `schemas.ts`: `paidPart` on the issue and preview bodies; the preview answers `paidMinor` and `maximumMinor`; the new 422s; OpenAPI regenerated.
- `server/src/statements/lines.ts`, `build.ts`, `serialize.ts`: the `REFUND` line. `server/src/summaries/activity.ts`: Received net of refunds.
- `server/src/payments/document-guard.ts`: D7.
- Records export and local restore (D8).
- Migration `…_mut643_refunds`; API **1.137.0-mut643**.
- Portal: in `src/hosted/components/IssueDocumentDrawer.tsx`, the credit-note step lists paid 305s and 320s. When the credit reaches the paid part, it shows "The client already paid ₪R of this" and a *Refunded* / *Kept as credit* choice, with date, method and reference for *Refunded*. The statement and ledger views render `REFUND`, and the entry drawer shows the refunded amount. Strings `hosted.issuing.creditPaid.*` in ar and en.
- Phone (Flutter, after the server): the same choice on the issue sheet's credit-note step, and the `REFUND` line on the client ledger. Older builds ignore an unknown line kind; this needs checking.

## Errors
- 422 `CREDIT_EXCEEDS_ORIGINAL` (`maximum`)
- 422 `PAID_PART_CHOICE_REQUIRED` (`paidMinor`)
- 422 `DATE_INVALID` on `refundedOn`
- 409 `PAYMENT_HAS_REFUND` on reverse or undo
- 404 `original_not_found` unchanged (now also a 320 of another customer)

## Tests (TDD, written first)
- **Unit, `credit-split`:** G ≤ O (owed only); G > O with one payment; G > O across two payments (newest first, then by id); G equal to gross on a 320; G above the maximum.
- **Contract, both stores:**
  - AC1: a fully paid 320 is credited with REFUND; the statement reads charge, payment, credit, refund with closing balance 0; `refundedMinor` is set.
  - AC2: two credit notes together above gross, the second refused; a concurrent pair on Postgres, one refused.
  - AC3: KEEP leaves unallocated R on the payment; the client's balance is −R; R applies to a new Owed.
  - AC4: activity Received for the month equals payments minus refunds.
  - AC5: reversing or undoing a payment with a refund source gives 409.
  - The idempotent retry returns the same document and posts one refund.
- **Route tests:** the 422s and OpenAPI. **Portal:** the drawer step with both choices; the REFUND line renders.
- Commands: `npm --prefix server test -- issuing payments statements summaries` while iterating, then the server CI set, `test:db`, and the portal affected tests.

## QA scenarios
- **`portal.invoicing.credit-note-paid-refund`:** issue a 320 for ₪1,000 → credit note against it → "already paid ₪1,000" → Refunded, today, bank transfer → issued → the client's statement shows the refund line and a balance of 0.
- **`portal.invoicing.credit-note-paid-keep`:** a paid 305 → credit note for ₪400 → Kept as credit → the client's balance shows ₪400 in credit → a new Owed of ₪400 is paid from it.
- **`portal.invoicing.credit-note-cap`:** a 305 for ₪1,000 already credited ₪700 → a credit note for ₪400 is refused, maximum ₪300.
- **Phone:** the refund case on the issue sheet.

## Impact, cost, i18n
- One migration with two small tables; no new external calls; one extra indexed read per statement.
- A rollback past this is safe until the first refund is written; after that, roll forward only (TD entry).
- All strings in ar and en (the portal has no Hebrew). Money stays in its currency (ILS only for issuing, D4 of ADR-260).
- **Reuse:** the release mechanism of reversals; the MUT-709 guard file; the existing credit rows.
- **Records file:** one new snapshot step, coordinated with the unreleased 21 → 22 step from MUT-709.

## Business / product impact
- A business on MTB3A can refund a client properly: credit note, money back, a statement that balances. Without this the first refund pushes it back to its old invoicing tool.
- MUT-639 (Barmajiyat issues its own invoices first) and the move to paid plans on issuing both need refunds to be possible.
- Low risk: issuing stays behind the per-account flag; additive wire changes.
