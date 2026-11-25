# MUT-643: a credit note against a paid invoice, with a refund or a kept credit

**Status:** plan revision 2, approved by Basel 2026-11-24; server, portal and QA specs built on `feature/mut-643-credit-note-paid` (ADR-276). Phone half next. Epic MUT-566. Follows MUT-568 (ADR-260 decision 4, R-D2), which a new ADR supersedes for credit notes.

**Basel's choices (2026-11-24):**
- **C1:** each credit note says what happens to the part the client already paid. *Refunded* records money going back (date, method, reference). *Kept* leaves it as the client's credit.
- **C2:** a refund is a ledger line beside the credit note, not a numbered document. Accountant question 6 on MUT-567 asks whether it needs one.

## Problem and acceptance criteria
Today a credit note (330) credits only what is still owed on a tax invoice (305): it is refused with 422 `ORIGINAL_PAID` beyond that. An invoice-receipt (320) can't be credited at all.

- **AC1 (ticket):** a credit note for a fully paid 320 issues, and the client's statement shows the refund.
- **AC2 (ticket):** the credit notes on one original never add up to more than its total.
- **AC3 (C1, narrowed by review finding 7):** *Kept* leaves the paid part as unallocated money. The client's balance shows it as credit, and the Received shows it as unallocated. **Applying that credit to the client's next invoice is a follow-up**: no person-side way to apply money exists today, and a document's Owed refuses allocations.
- **AC4:** Received figures count a refund as money going out on its date. That covers activity (In & out, Reports, monthly mail, phone Glance), the statement period summary, the client balances, the books split (MUT-660) and the accountant's period pack.
- **AC5:** a payment a refund drew on can't be reversed or corrected (409).
- **AC6:** portal and phone, Arabic first and English, plus release-QA flows.

## Solution

**D1. What may be credited, and how far.**
- The original is a 305 or a 320 **whose Owed the document owns** (origin `ISSUED_DOCUMENT`).
- A 320 that applied a payment request, a 320 linked to an existing payment, and a 305 linked to an existing Owed (an agreement charge, a credited Owed) have no Owed of their own. These keep today's rule: only what is still owed may be credited, and nothing beyond it (review findings 2 and 6). This avoids moving agreement money outside the agreement lock; it is a follow-up if needed.
- **Cap:** the credit may be at most the original's gross minus earlier credit notes. Beyond that it is refused with 422 `CREDIT_EXCEEDS_ORIGINAL` (`maximum`). The Owed's paid plus credited also never exceeds its gross.
- The cap can't race: the credit-note counter upsert already makes credit notes in one organisation wait for each other. The Owed lock guards the sums.

**D2. How the credit is split.** For a credit G where O is still owed, `min(G, O)` credits what is owed, as today. The rest, `R = G − min(G, O)`, is the paid part. The Owed's `creditedMinor` goes up by G and its `paidMinor` down by R. Pure: `server/src/issuing/credit-split.ts`.

**D3. Releasing the paid part (MUT-444's terms-correction release, not a reversal; review finding 5).**
- R comes off the Owed's live allocations, newest first (`createdAt`, then `id`).
- Released rows get `releasedAt`. A partial release inserts a smaller live row carrying **the released row's own `createdAt`**, so a later credit note's order stays stable.
- Each payment's `allocatedMinor` drops by what was released from it. The `updateMany releasedAt` + `releaseAllocationsTx` shape and its `after ≤ amount` check are reused.

**D4. Lock order (review finding 1, blocker).** For a credit note with a paid part, `issueTx`:
1. takes the counter (unchanged, so ADR-264 holds);
2. reads the original's live allocations without a lock;
3. **locks those payments FOR UPDATE in id order**;
4. locks the original Owed;
5. re-reads its live allocations (`releasedAt` null, payment `POSTED`).

If the set of paying payments changed between steps 2 and 5, the issue is refused with 409 `ORIGINAL_CHANGED`. This matches every payment writer's order (payment first, then receivables). The `issue` wrapper also maps deadlock and serialization failures (40P01/40001) to a 409 `LockConflict`, not a 500.

**D5. The choice on the request; compatible with older apps (review finding 12).**
- `paidPart: { mode: 'KEEP' }`: the released money stays unallocated on its payments.
- `paidPart: { mode: 'REFUND', refundedOn, method, reference? }`: a **refund** row is written, and **refund sources** take the released amounts from the same payments. Each payment's `allocatedMinor` goes back up by what it gave: refunded money counts as used (`allocatedMinor` = live allocations + refund sources; the schema comment is updated).
  - `method` is `PaymentMethod`.
  - `refundedOn` follows `pastMoneyDate` and may not be before the credit note's `documentDate`: a refund follows its credit note.
- **No `paidPart` while R > 0:** 422 `ORIGINAL_PAID` with `paidMinor`, exactly as today. The phone 0.2.0 already maps `ORIGINAL_PAID`, so older apps keep their message. Clients that know about it read `paidMinor` from the preview and send the choice. No new "choice required" code.

**D6. Data (one migration, additive).**
- `refunds`: id, organizationId, customerId, currency, amountMinor, refundedOn, method, reference, issuedDocumentId, requestId, createdByUserId, createdAt.
- `refund_sources`: id, organizationId, refundId, paymentId, amountMinor.

These are ledger rows like `receivable_credits`: append-only in code, **no trigger**, and in `PURGE_PROFILE_TABLES`, purged with the profile (review finding 3). `IssuedDocument` gains `refundId`, a plain uuid with no FK, like `creditId`.

**D7. Where refunds count (review finding 9).**
- `statements/lines.ts`: a new kind `REFUND`, a debit on `refundedOn`, ranked last. It appears **on the whole-client statement only**: a project statement already drops released allocations.
- `statements/period.ts`: a new `refundsMinor` in the period summary. Received = payments − reversals − refunds. A refund must never fall into the reversals ("bounced") figure.
- `statements/balances.ts` and its loaders (routes/customers.ts, routes/summaries.ts, the memory equivalents) take refunds into account.
- `summaries/activity.ts`: received minus refunds. This covers verdict, profile figures, the monthly mail and the phone Glance.
- `income/invoice-split.ts` (the MUT-660 books split) and `period-pack/report.ts` (the accountant's period pack) subtract refunds.
- `issuing/documents-due.ts`: a refunded captured Received no longer asks for a receipt for the refunded part.
- `issuing/settlement.ts` and `hasTaxDocumentTx` (both stores): a 320 fully covered by credit notes reads CANCELLED, as a 305 does (review finding 8).
- Payment and entry responses gain `refundedMinor` (additive), so a fully refunded payment explains why it reads as allocated.

**D8. Guard inside the store (review finding 4).** `reverse` and `correct` check for refund sources in both stores **after the payment row is locked**, and refuse with 409 `PAYMENT_HAS_REFUND`. A route-side check would be check-then-act. Undo already refuses money that is allocated; with a refund, allocated stays above 0.

**D9. Records file (review finding 11).** The export carries `allocatedMinor` as stored, but it leaves out issued documents and refunds. So a restored local statement would end at −R where the outstanding is 0. `refunds` (sources nested) joins `SNAPSHOT_FIELDS`, the export types, memory `snapshot`/`restore` and the fingerprint test. The empty map goes into the **unreleased 21 → 22 snapshot step** (`addDocumentsFields`), not a new step. If web ships before this merges, it becomes 22 → 23.

**D10. Uniform file:** unchanged (C2).

## Where the code goes
- **Server, issuing and ledger:**
  - `server/src/issuing/credit-split.ts` (new) and `issuing/ledger-plan.ts`;
  - `repositories/ports.ts`, `memory.ts`, `prisma.ts` (issueTx lock order, release, refunds, guards, `refundedMinor`);
  - `routes/issuing.ts` and `schemas.ts` (`paidPart`, preview `paidMinor` / `maximumMinor`, the new codes, OpenAPI).
- **Server, figures:**
  - `statements/{lines,period,balances,build,serialize}.ts`;
  - `summaries/activity.ts`, `income/invoice-split.ts`, `period-pack/report.ts`;
  - `issuing/{settlement,documents-due}.ts`.
- **Records file:** `records-file/codec.ts`, the export, and `src/hosted/local/migrations/index.ts`.
- **Migration and version:** migration `…_mut643_refunds`; API **1.137.0-mut643**.
- **New ADR:** a credit note may reach a paid document's paid part; it supersedes ADR-260 decision 4's limit and notes ADR-206's reversal rule.
- **Portal:**
  - `IssueDocumentDrawer.tsx`: the credit-note step lists document-owned paid 305s and 320s and shows "The client already paid ₪R of this", with the *Refunded* / *Kept as credit* choice;
  - `LedgerCard` gets the `REFUND` label keys;
  - the entry drawer shows the refunded amount;
  - the `ORIGINAL_PAID` strings are updated;
  - ar and en under `hosted.issuing.creditPaid.*`.
- **Phone (after the server):** the choice on the issue sheet's credit-note step only. The phone has no statement view.

## Errors
- 422 `CREDIT_EXCEEDS_ORIGINAL` (`maximum`)
- 422 `ORIGINAL_PAID` (`paidMinor`) when the paid part has no choice, or when the original's Owed isn't the document's
- 422 `DATE_INVALID` (`refundedOn`)
- 409 `ORIGINAL_CHANGED`
- 409 `LockConflict`
- 409 `PAYMENT_HAS_REFUND`

## Tests (TDD, written first)
- **Unit:** `credit-split` (G ≤ O; G > O with one payment and with two, newest first; G = gross on a 320; above the cap); `settlementOf` for a credited 320.
- **Contract (both stores):**
  - AC1: a paid 320 with REFUND gives charge, payment, credit and refund lines, balance 0, `refundedMinor` set.
  - AC2: a second credit note beyond the cap is refused.
  - AC3: KEEP gives a balance of −R and R unallocated.
  - AC4: activity, period summary, books split and period pack all net of refunds.
  - AC5: reverse or correct gives 409.
  - Each of these is refused or limited by D1: a 320 that applied a request, a linked 320, a linked 305.
  - documents-due skips refunded money.
  - An idempotent retry posts one refund.
  - A records-file round trip keeps the balance.
- **Postgres:**
  - a reverse racing a refunding credit note: one wins, the other gets 409, nothing is lost;
  - a deadlock maps to 409.
- **Portal:** the drawer step with both choices, and the REFUND label.
- **Commands:** affected server suites while iterating; then the server CI set, `test:db`, portal affected tests, lint, typecheck and build.

## QA scenarios
- **`portal.invoicing.credit-note-paid-refund`:** a 320 for ₪1,000 → credit note → "already paid ₪1,000" → Refunded, today, bank transfer → the statement shows the refund line and a balance of 0.
- **`portal.invoicing.credit-note-paid-keep`:** a paid 305 → credit note for ₪400, Kept → the client's balance shows ₪400 in credit.
- **`portal.invoicing.credit-note-cap`:** a ₪1,000 305 already credited ₪700 → a credit note for ₪400 is refused, maximum ₪300.
- **Phone:** the refund case on the issue sheet.

## Follow-ups (to file)
- Apply a client's kept credit to their next invoice (a person-side apply, including on a document's Owed).
- A credit note's paid part on a 320 that applied a request, a linked 320 or a linked 305.

## Impact, cost, i18n
- Two small tables; no external calls; one extra indexed read for statements and Received figures.
- Roll-forward only once the first refund exists (TD entry).
- ar and en only on the portal.
- **Reuse:** MUT-444's release, the MUT-709 guard file, credit rows, `PaymentMethod`, `pastMoneyDate`.

## Business / product impact
- A business can refund a client properly: credit note, money back, a statement that balances. Without this the first refund sends it back to its old invoicing tool.
- MUT-639 (Barmajiyat issues first) and the paid plans that include issuing both need refunds.
- Low risk: issuing stays behind the per-account flag; wire changes are additive, and older phones keep their `ORIGINAL_PAID` message.

## Settled while building (2026-11-24)
- **Documents due needs no change.** Money a credit note releases always came from a document's payments: issuing takes a captured Received over (origin becomes ISSUED_DOCUMENT) or links a receipt to it (documented), and `documentsDue` already skips both.
- **The portal's credit button keeps its old default.** While something is still owed it starts at that amount (as before); on a fully paid document it starts at what credit notes haven't covered yet. The amount can be raised up to that, and then the drawer asks about the paid part.
- **Error details stay in minor units**, like the existing `outstanding`: `maximum` and `paid` are minor-unit strings; the preview's `creditNote` amounts are decimals like every other preview amount.
- **The accountant's shared summary** (share links) also nets refunds out of `received`; `count` stays the payments.
- **The fake QA API** credits paid parts, keeps refunds and puts issued documents' lines on the client statement in the server's rank order.
