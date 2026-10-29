Status: BUILT (2026-10-29) on `feature/mut-444-correct-agreement-terms`; see "Build notes" at the end

# MUT-444 — Correct a fixed or contingency agreement's terms after posting

Planned 2026-10-29 against main e59d7551 (MUT-443 merged). Branch `feature/mut-444-correct-agreement-terms`. Nothing built yet.
Basel answered the decisions on 2026-10-29, and an independent eng review (R1–R16, at the end) is folded into the body. Where the two differ, the review section wins.

- **Tracker:** Jira · barmajiyat · MUT via atlassian-barmajiyat. Parent epic MUT-25. Blocks Malafat **MAL-1368** ("Correct an agreement's terms: amount, incl./excl. VAT, VAT treatment").
- **Numbers:**
  - API `1.89.0-mut444`;
  - ADR-226, TD-287 onward;
  - migrations `20261029100000` and `20261029100100`;
  - local snapshot format stays **13** (see "Local mode").

## Problem

A Partner can save a fee as VAT-inclusive when it was VAT-exclusive (or the reverse), or with the wrong amount or VAT treatment. Once any installment has posted, there is no clean fix:
- an "on signing" fee posts at creation;
- cancel answers 409 `AGREEMENT_HAS_POSTED_RECEIVABLES`;
- a negative supplement can't reach posted receivables (422 `SUPPLEMENT_EXCEEDS_UNPOSTED`);
- MUT-480's reduce only lowers the fee, and only by crediting. It can't raise a fee or change the VAT basis or treatment.

## Acceptance criteria (ticket)

- **AC1:** correcting a posted VAT-inclusive fee to VAT-exclusive credits the old receivables and posts the new gross. The customer's outstanding changes by exactly the difference.
- **AC2:** allocated payments end up on the corrected receivables, oldest first, and any excess shows as unallocated. No payment is lost or double-counted.
- **AC3:** the operation is atomic and idempotent. A stale preview answers 409 `PREVIEW_STALE`.
- **AC4:** a cancelled agreement answers 409 `AGREEMENT_CANCELLED`. A contingency agreement with an outcome answers 409 `OUTCOME_ALREADY_RECORDED`.
- **AC5:** credits and reposts are visible in the receivable history and the audit log.
- **AC6:** the OpenAPI contract version is bumped for Malafat to re-vendor.

Out of scope:
- from the ticket: retainers (`POST /v1/retainers/{id}/change`); a contingency agreement after its outcome (MUT-100's outcome correction); changing the currency, customer or project;
- from Basel's 2026-10-29 answer: changing a posted line's trigger, or removing a posted line. Trigger fixes are a follow-up ticket.

**How AC1 is measured (Basel, 2026-10-29).** "Outstanding" is read as the client's **balance**: outstanding − unallocated, which is the statement's closing balance (ADR-217 §3). The preview shows both outstanding and balance, before and after.
- A correction that lowers a fee below what was paid leaves outstanding at 0 and moves the rest into unallocated. The balance still changes by exactly the difference.
- The difference is the change in the posted lines' effective total: their new gross − (their old gross − credits already on them).
- With no earlier credits it is new posted gross − old posted gross, the ticket's case.

## Neighborhood

- **MUT-100 / ADR-059:** the contingency outcome correction. It credits the old commission in full and posts a new one, in one locked write. This ticket extends that to every posted line, and, unlike MUT-100, allows lines that already have payments (the payments move).
- **MUT-480 / ADR-222:** the fee reduction. It gave us:
  - `CREDIT_REASON_CODES`;
  - a preview token over the ledger;
  - the agreement-row lock plus `receivablesMoved`;
  - conditional installment writes;
  - the REDUCTION supplement row;
  - `postDueItems` before planning (R1);
  - `postInstallment`'s claim on the version it read (E1).
- **MUT-443 / ADR-225:** payment correction. It gave us:
  - `releaseAllocationsTx`;
  - its lock order: payment row → counter → receivables in id order;
  - `CORRECT_TX_OPTIONS` (15 s), with P2028 answered as 409;
  - check-everything-then-write in the memory store;
  - `NOTHING_TO_CORRECT` and `REASON_REQUIRED`;
  - `receivable.settled` emitted only when a status changes.
- **MUT-478 / ADR-217:** CHG numbers per year of `postingDate`, and the statement. Its consequence note ("the reposted charge sorts before the credit dated today") is **superseded** by D5 B; see the Statement section.
- **MUT-479 / ADR-224:** a token that hashes a resolved date (here `today`), strict request bodies, one composer per kind, and "extract first, guarded by the untouched suites".
- **MUT-347:** `rollback-check.ts` `ROLLBACK_HAZARDS`, used by R1 below.

## Where the code is today

- **Schedule.** `composePreview` (`agreements/create.ts`) does everything in one function, so a correction can't use it as is:
  - `loadAgreementContext` (`compose.ts`) runs the archive and currency checks *and* resolves the rate on `agreementDate`;
  - the specs are parsed and `splitInstallments` (`schedule.ts`) runs;
  - each line's posting and due dates come from `postingDateFor` and `installmentDueDate`.
- **Posting.** `postInstallment` (prisma.ts:1428, and memory) runs its own transaction: it takes a number (`nextReceivableNumberTx`), creates the receivable, and claims the line on `receivableId IS NULL AND voidedAt IS NULL AND version`. Nothing posts inside another write today.
- **Voids.** Reduce voids unbilled lines only. MUT-100 voids a *posted* commission line. The statement's `originOf` (`statements/build.ts:186-189`) gives any voided line `position: 0`, because `findIndex` returns −1.
- **Credits.** Credits are stored rows. A receivable can't be credited "in full" while it has payments: the paid part has to leave first.
- **Allocations are append-only.** `payment_allocations` rows are only ever inserted. A reversal keeps its rows and lowers the receivables' `paidMinor`; readers tell a reversed payment's rows apart by `payment.status`. Nothing moves an allocation today.
- **Matter figures.** `projectFigures` (`summaries/compute.ts:142`) adds every counted receivable's gross into `postedMinor`. A credited-and-reposted line would be counted twice (R4).
- **Cancel.** The store's `cancel` is conditional on `status = ACTIVE AND outcome IS NULL`, not on the agreement's version. The route checks "nothing posted" *before* the write (R11).

## Decisions — answered by Basel 2026-10-29

### D1: how a payment leaves an old charge — **A, release and re-allocate** (with review fixes R1, R2, R14)
- The old allocation row stays, and gets `releasedAt` (a new nullable column, set once, like a payment's `reversedAt`).
- The old receivable's `paidMinor` drops (`releaseAllocationsTx`).
- New allocation rows are inserted on the corrected receivables.
- Every allocation reader counts live rows only (`releasedAt IS NULL`); the full list is under "Allocation readers".
- `GET /v1/payments/{id}` lists live rows, so for a POSTED payment the allocations still sum to `allocated`.
- Rolling back past this ticket is gated by a rollback-check hazard (R1).

### D2: scope — **posted lines' figures only** (Basel; replaces the earlier slot/trigger options)
- A correction may change the posted lines' **figures**: the amount or share, the pricing basis, the VAT treatment (the agreement's and each line's), the payment terms (the agreement's and each line's, and each line's due-date override), and the labels.
- **Posted lines keep their count and their triggers.** Lines are matched by position order, k-th to k-th. For every old line k that has posted, new line k must exist and carry the same trigger: the same type, and for DATE the same date. Otherwise the answer is 422 **`POSTED_INSTALLMENT_CHANGED`**, the one new reason registered in `VALIDATION_REASONS`.
  - The error details are `{ position, change: 'TRIGGER' | 'REMOVED' }`.
  - No existing reason fits: `SUPPLEMENT_EXCEEDS_UNPOSTED` and `NOT_MANUAL` mean other things.
- **Unposted lines may change freely:** triggers, count and shares. Lines beyond the old count are allowed.
- **Posting in the same write:**
  - every new line matched to a posted old line reposts on that line's **original posting date P**;
  - every other line follows its trigger exactly as a new agreement would: IMMEDIATE posts (`postingDateFor`), DATE ≤ today posts on its date, MANUAL and future DATEs wait;
  - due dates come from the posting date and the corrected terms (`installmentDueDate`), so aging is kept.
- Trigger fixes on posted lines are a follow-up ticket.

### D3: credits already on an old charge — **A, absorbed**
- The correction credits each old receivable's remainder: gross − credits already on it.
- Net and VAT are the exact complements of the stored credit rows, so the receivable ends credited to exactly its gross, net and VAT.
- The preview shows `priorCredited` per receivable and in total, so Malafat can warn that an earlier discount isn't carried over.

### D4: posted lines whose figures don't change — **A, uniform**
Every posted line is credited and reposted. One rule.

### D5: the date on the correction's credits — **B, the old receivable's posting date** (Basel)
- Each correction credit's `effectiveDate` is the posting date of the receivable it credits. Every past period then nets to the corrected figure.
- The credit's `createdAt` is the correction instant, and the reposted receivable's `createdAt` is one millisecond later (MUT-443 R8's idiom). On the shared date the statement then reads: old charge, credit, repost.
- This is the first back-dated credit. ADR-226 records it and supersedes ADR-217's consequence note.

### D6: where the agreement records the correction — **A, a `CORRECTION` supplement row** (fields defined in R12)

### D7: audit — **A**
- One `agreement.corrected` carrying the before and after terms.
- `receivable.credited` per credit (`source: CORRECTION`) and `installment.posted` per repost (`trigger: CORRECTION`).
- `receivable.settled` for each status change (R13).

## Settled here

1. **The body is the full new terms:**
   - `amount` (in the pricing basis) and `pricingBasis`;
   - `vatTreatment?`, defaulting to the **agreement's own** treatment (R9);
   - `paymentTerms?`, defaulting to the agreement's;
   - `installments` (the same `InstallmentSpecSchema`, limited by D2).

   Not changeable: `agreementDate`, `description`, `currency`, `projectId`, `customerId` and the contingency commission terms. The body is `.strict()`, so sending any of them is a 422 `VALIDATION_FAILED`.
2. **The rate is the frozen one (R9).** The corrected schedule uses `agreement.vatRateBasisPoints`.
   - The single exception: the stored rate is 0 (no rate existed at creation) and a corrected line is STANDARD_RATED. Then the rate in force on `agreementDate` is resolved and stored on the agreement, or the answer is 422 `VAT_RATE_MISSING`.
   - `loadAgreementContext` is split (R9) so a correction never reads the rate table otherwise.
3. **Kinds and states:**

   | Agreement | Answer |
   |---|---|
   | FIXED | allowed |
   | CONTINGENCY without an outcome | the upfront only; amount 0 allowed, as at create |
   | CONTINGENCY with an outcome | 409 `OUTCOME_ALREADY_RECORDED`, pointing to `/outcome/correct` |
   | RECURRING | 422 `NOT_FIXED`, pointing to `/v1/retainers/{id}/change` |
   | CANCELLED | 409 `AGREEMENT_CANCELLED` |
   | FIXED with amount 0 | 422 `AMOUNT_INVALID` |
   | nothing posted yet | allowed |

4. **Archived client or project:** 422 `CUSTOMER_ARCHIVED` / `PROJECT_ARCHIVED`, through the split-out parties check.
5. **A correction that changes nothing:** 422 `NOTHING_TO_CORRECT`. It compares the agreement's amount, basis, treatment and payment terms, and each live line's label, amount, treatment, trigger, terms and due-date override, in order.
6. **Reason:** `reasonCode` from `CREDIT_REASON_CODES` is required on commit, and `OTHER` needs a `note` (422 `REASON_REQUIRED`). A credit stores `reason` (the note if there is one, otherwise the code) and `reasonCode`. The reason is not part of the token.
7. **Payments move oldest first (AC2).**
   - Payments are taken in `receivedOn`, `createdAt`, `id` order. Each one's released amount is its live allocations on **this agreement's old receivables only**: an allocation on another agreement or receivable stays where it is.
   - Each payment is placed with `suggestAllocations('OLDEST_FIRST', …)` over this agreement's newly posted receivables (ordered by `dueDate`, `postingDate`, id), with the running paid amount carried from one payment to the next.
   - Whatever doesn't fit stays on the payment as **unallocated**. REVERSED payments and already-released rows are ignored.
8. **Every live old line is voided.** The new schedule goes in as new rows at positions max+1 and onward, with new installment ids. A manual trigger on an old id answers 409 `INSTALLMENT_VOIDED`.
9. **CHG numbers.** A repost takes the next number of its posting date's year (ADR-217 §1), so a number can be out of issue order (TD-289). Numbers stay gap-free.
10. **Scopes (R7).**
    - Preview: `agreements:read` **and** `payments:read`.
    - Commit: `agreements:write` **and** `payments:write`, plus `idempotent(store, 'agreements.correct')`.
    - API key only (`keyAuth`).
    - Two `requireScope` middlewares: the helper takes one scope.
    - Store guard: `agreements.correct: { write: 'agreements' }`, plus `payments.listLiveAllocationsOn: 'read'`.
11. **Due items post first.** The preview and the commit both run `postDueItems` with the key's own store and actor (MUT-480 R1).

## API

### `POST /v1/agreements/{agreementId}/correct/preview`
- Scopes `agreements:read` + `payments:read`; API key.
- Body `CorrectAgreementPreviewRequest`: the terms, plus optional `reasonCode` and `note`.
- The only write is the lazy posting every read already does (the description must not say "writes nothing").

Response `CorrectAgreementPreviewResponse`:
- `terms: { before, after }`, each `{ amount, net, vat, gross, pricingBasis, vatTreatment, paymentTerms, vatRateBasisPoints }`.
- `installments[]`, one entry per position k:
  - `before: {id, position, label, amount, net, vat, gross, trigger, dueDate, status, receivableId|null, receivableNumber|null, postingDate|null} | null`;
  - `after: {label, amount, net, vat, gross, vatTreatment, trigger, dueDate, postingDate|null} | null`.
- `credits[]`: `{ receivableId, receivableNumber, effectiveDate, amount, net, vat, priorCredited }`.
- `allocations[]`, one per payment that moves:
  - `{ paymentId, paymentNumber, receivedOn, released: [{receivableId, receivableNumber, amount}], placed: [{position, amount}], unallocated }`.
- `agreement: { effectiveTotal, outstanding }`, each `{before, after}`.
- `customer: { outstanding, unallocated, balance }`, each `{before, after}`, in the agreement's currency.
  - These come from the customer summary's own computation (the build reuses that function). The `after` figures are `before` plus this correction's delta.
  - The token guarantees the delta. The client's other activity can still move `before`.
- `balanceChange`: the AC1 difference.
- `priorCredited`.
- `previewToken`.

### `POST /v1/agreements/{agreementId}/correct`
- Scopes `agreements:write` + `payments:write`; API key; `idempotent(store, 'agreements.correct')`.
- Body `CorrectAgreementRequest`: the terms, `reasonCode` (required), `note?` (at most 500 characters) and `previewToken`.

Response `CorrectAgreementResponse`: `AgreementDetail` plus:
- `supplement` (the CORRECTION row);
- `credits[]`;
- `receivables[]` (the reposts, with their CHG numbers);
- `allocations[]` (the new rows, each with its `paymentId`);
- `unallocated[]` (`{paymentId, amount}`).

### Errors
- 404: an unknown agreement, or one in another organization.
- 422:
  - `NOT_FIXED`, `AMOUNT_INVALID`;
  - the schedule reasons (`NO_INSTALLMENTS`, `INSTALLMENTS_DO_NOT_SUM`, `PERCENTS_DO_NOT_SUM`, `MIXED_INSTALLMENT_BASIS`, `NON_POSITIVE_INSTALLMENT`, `TOO_MANY_INSTALLMENTS`, `TRIGGER_DATE_REQUIRED`, `DATE_INVALID`);
  - `VAT_RATE_MISSING`, `PROJECT_ARCHIVED`, `CUSTOMER_ARCHIVED`;
  - `NOTHING_TO_CORRECT`, `REASON_REQUIRED`;
  - **`POSTED_INSTALLMENT_CHANGED`**, the only new reason;
  - strict-body `VALIDATION_FAILED`.
- 409:
  - `AGREEMENT_CANCELLED`;
  - `OUTCOME_ALREADY_RECORDED`;
  - `PREVIEW_STALE`: a token mismatch, or a store race (`stale`, `LockConflict` or P2028), with nothing written.

### Token (R8)
The token is `previewToken([…])` over these parts, in order:
1. `org`, `'agreement-correct'`, `agreementId`, `agreement.version`, `today`;
2. `resolvedTerms` (with the defaults filled in), and `rateBasisPoints`;
3. the installments' `(id, version, receivableId, voidedAt)`, sorted by id;
4. the old receivables' `(id, version)`, sorted by id;
5. the moved payments' `(id, receivedOn, status, allocatedMinor)`, sorted by id.

The moved payments are every payment with a live allocation on an old receivable.

Left out of the token:
- `reasonCode` and `note`, which move no figure;
- payment versions, because a receipt number set on a payment moves no money.

## The pure planner: `server/src/agreements/correct-terms.ts` (new)

```
planCorrection({
  agreement: { agreementDate, paymentTerms (new) },
  scheduled: ScheduledInstallment[],     // splitInstallments at the frozen rate
  old: OldLine[],                         // live lines by position: id, version, position, label, figures, trigger,
                                          //   receivable?: { id, version, number, postingDate, dueDate, gross/net/vat,
                                          //   priorCredit {amount, net, vat}, allocations: LiveAllocation[] }
  payments: Map<paymentId, { number, receivedOn, createdAt }>,
  today,
}) → { ok: true, lines, voids, credits, releases, placements, unallocated, figures }
   | { ok: false, reason: 'NOTHING_TO_CORRECT' | 'POSTED_INSTALLMENT_CHANGED', position?, change? }
```

1. **Shape check (D2).** Every posted old line k must have a new line k with the same trigger.
2. **Posting decisions.** A new line matched to a posted old line posts on P_k. Any other line follows `postingDateFor`. Due dates come from `installmentDueDate`.
3. **Voids.** Every old live line.
4. **Credits (D3, D5).**
   - Each old receivable with a remainder above 0 gets one credit: `{gross − prior.amount, net − prior.net, vat − prior.vat}`, dated with the receivable's `postingDate`.
   - A receivable that is already fully credited gets no credit row.
5. **Releases.** Every live allocation of a POSTED payment on an old receivable.
6. **Placements.**
   - The new posted lines are treated as `AllocatableReceivable`s keyed `pos:NN`, so the id tie-break is stable.
   - Payments are placed oldest first with `suggestAllocations('OLDEST_FIRST')`. The remainder is unallocated.
7. **Figures.** The schedule totals, `effectiveTotalsOf` before and after, the agreement's outstanding before and after, and `balanceChange`.
8. **No-op check.**

Invariants, asserted in tests:
- per payment, Σ placed + unallocated = Σ released;
- per new receivable, placed ≤ gross;
- each old receivable ends with paid 0 and credited equal to its gross, net and VAT;
- Δ balance = Δ(posted gross − prior credits).

## Composition: `server/src/agreements/correct-terms-compose.ts` (new)

- `assertCorrectable(agreement)` (Settled 3). The cancelled and outcome conflicts come from the same helpers `outcome.ts` and `reduce-compose.ts` use.
- `composeCorrection(store, organization, agreement, body, today)`:
  1. **R9.** Run the parties check: `loadAgreementParties`, split out of `loadAgreementContext`; `create` calls both, guarded by the untouched create and proposal suites.
  2. Work out the frozen rate.
  3. Run **`composeSchedule`**, a pure extraction of `composePreview`'s middle: specs → `scheduleOrThrow` → posting and due dates. `composePreview` calls it unchanged.
  4. Read:
     - the installments;
     - the old receivables (`receivables.getByIds`);
     - their credits (`listCredits`, issued together);
     - the live allocations with their payments' fields, through the new **`payments.listLiveAllocationsOn(org, receivableIds)`**: live rows of POSTED payments, with each payment's `number`, `receivedOn`, `createdAt` and `allocatedMinor`, in one query.
  5. Call `planCorrection`.
  6. Return `{ plan, tokenParts, write, view }`.
- `correctionWrite(...) → CorrectAgreementInput` and `correctionView(...)` mirror `reductionWrite` and `reductionView`.

## The store write: `agreements.correct(organizationId, agreementId, input: CorrectAgreementInput, at)`

```
CorrectAgreementInput {
  expectedVersion; terms (agreement columns + totals + vatRateBasisPoints);
  voids: {id, expectedVersion, receivableId|null}[];
  receivables: {id, version}[];                    // every old posted receivable
  payments: {id, allocatedMinor}[];                // payments whose rows are released (R8: re-checked under lock)
  releases: {allocationId, paymentId, receivableId, amountMinor}[];
  credits: {receivableId, amountMinor, netMinor, vatMinor, effectiveDate}[];   // D5 B: the old posting date
  credit: {reason, reasonCode, requestId};
  newInstallments: (CreateInstallmentInput & { id: uuid; post: {postingDate, dueDate} | null })[];
  placements: {paymentId, installmentId, amountMinor}[];
  supplement: SupplementInput (CORRECTION, R12);
}
CorrectAgreementResult = { kind: 'updated', record: { agreement, installments, credits, receivables, allocations, payments, settled: string[] } } | { kind: 'not_found' } | { kind: 'stale' }
```
The new installment ids are generated in the composition, so the batched insert needs no read-back (R10). `settled` lists the receivables whose status changed, for R13. The write returns a typed result and never lets an exception escape.

### Prisma
One `$transaction` with `CORRECT_TX_OPTIONS`, wrapped like reduce in `asStaleOnLockConflict`, with `isTransactionTimeout` answered as `stale`. Locks are taken in an order every existing writer already follows, so none can deadlock with this write:
1. **Agreement row** `FOR UPDATE`; check its version, ACTIVE and `outcome IS NULL`.
2. **Payments**, in id order, `FOR UPDATE`. Each must still be POSTED with the `allocatedMinor` the plan read (R8). Payment writes take the payment row before receivables too.
3. **Old receivables**, in id order and version-checked: `receivablesMoved`.
4. **New lines:**
   - one `installment.createMany` with the planned ids (R10);
   - for each post, in posting-date order, the new **`postInstallmentTx(tx, agreement, installment, {postingDate, dueDate, at: at+1ms})`**, extracted from `postInstallment`, which calls the same helper.

   The CHG counter is taken here, **before any old installment row is touched**: that is posting's own order (counter, then installment row).
5. **Voids.** One `updateMany` per line, each conditional on the version and receivable it was read with; a miss is `StaleWrite`. A single statement can't tell which row missed, so the voids stay per row (≤ 60 rows).
6. **Releases (R10).**
   - One `UPDATE payment_allocations SET "releasedAt" = $at WHERE id = ANY($ids) AND "releasedAt" IS NULL`. If the count isn't `releases.length`, the write is `StaleWrite`.
   - Then `releaseAllocationsTx` on the old receivables.
   - Then each payment's `allocatedMinor` is lowered.
7. **Credits.**
   - Under the held locks, check that remainder = gross − paid − credited, with paid now 0.
   - Insert the credits with `effectiveDate` = the old posting date and `createdAt = at`.
   - `settleReceivable` each old receivable.
8. **Placements.**
   - `allocateRowTx` (extracted from `applyAllocations`, which then calls it) inserts each row and re-checks capacity.
   - `settleReceivable` each new receivable; raise each payment's `allocatedMinor`, then bump its `version`.
9. **Agreement:** the terms, the totals and `version + 1`. Then the CORRECTION supplement row.
10. Return fresh rows, with `settled` = the receivables whose status changed.

### Memory
- Every check runs before the first write, with no `await` in between (MUT-443 R7):
  - the agreement's version, ACTIVE status and outcome;
  - `receivablesMoved`;
  - each void's version and receivable;
  - each payment still POSTED with its `allocatedMinor`;
  - each release still live;
  - the capacities after the release.
- Then it writes in Prisma's order.
- Posting shares the extracted `postNow` with `postInstallment`.

### Cancel becomes version-conditional (R11)
- `agreements.cancel` gains `expectedVersion`, and its write carries it in both stores.
- A miss re-reads, then answers by the state found:
  - an outcome recorded → `OUTCOME_ALREADY_RECORDED`, as today;
  - lines posted since → `AGREEMENT_HAS_POSTED_RECEIVABLES`;
  - anything else → `VERSION_MISMATCH`, retry.
- A cancel can then never land on an agreement a correction has just reposted.

## Allocation readers that count live rows only (D1, R2)

Each of these must ignore rows with `releasedAt` set:
- **Prisma:**
  - `listAllocations` and `listAllocationsFor`;
  - `statementSources`;
  - `settledOwedIds`;
  - `reverse`'s and `correct`'s `findMany({ where: { paymentId } })`;
  - `payments.list`'s project filter: `allocations: { none: … }` / `{ some: … }` both gain `releasedAt: null`;
  - `allocationStateWhere` only if it reads rows (it reads `allocatedMinor` today, which the write keeps right);
  - `prisma-records-export.ts` `allocs` (R14).
- **Memory:**
  - `listAllocations` and `listAllocationsFor`;
  - `statementSources`, `settledOwedIds`;
  - **`reverseNow`** (~2152): else a reversal releases twice;
  - **`releasedBy`** (~2145): it feeds MUT-443's capacity check;
  - **`hasAllocations`** (~2103);
  - **`payments.list`'s `onProject`** (~2010).
- Memory's `applyAllocations` does **not** write `releasedAt: null`. The field stays absent on rows a device can make (R14).

Contract tests on both stores cover:
- every reader above after a correction;
- a MUT-443 correction of a moved payment;
- a reversal after a correction (only the live rows are released: the new charge reopens, the old one stays credited);
- `GET /v1/payments?projectId=` after a correction.

## Matter figures (R4)

- `projectFigures` sums `postedMinor`, `paidMinor` and `creditedMinor` over every counted receivable. It is served as the matter's `posted` and shown on the portal's ClientDetailPage.
- A correction would count the old charge and its repost both. The rule: a receivable whose originating installment is voided *and* posted is **superseded**. It is left out of `postedMinor`, `paidMinor` and `creditedMinor` entirely, its correction credit and any earlier credits included.
- Its outstanding is 0 (paid 0, credited = gross), so the buckets, statuses and balances don't change.
- The predicate is built from the installments `projectFigures` already receives: the `receivableId`s of installments with `voidedAt` set.
- It also catches a MUT-100 commission replaced by an outcome correction. That had the same double count, and is fixed in passing (ADR-226 says so).
- Tests:
  - a matter after one and after two corrections: `posted` = new gross;
  - a MUT-100 corrected commission: `posted` counts the new commission only;
  - nothing else in the summary moves.

## Statement (`server/src/statements/build.ts`)

- **Lines (D5 B).** On the old posting date: the old CHG charge, then the correction's CREDIT (`reasonCode`; created at `at`), then the repost (created at `at`+1 ms; it sorts after the credit on the same date). Every period nets to the corrected figure, and a statement for a past month changes after a correction, by design. Payments are unchanged on the whole-customer statement. A project statement shows each payment against its live allocation only.
- **`originOf` (R3).** A voided posted line is numbered within its own generation: the non-commission lines of the agreement that share its `voidedAt`. `position` = 1 + the number of lines in that generation with a lower position; `of` = the generation's size. Live lines keep today's rule (live, non-commission, in position order).
- **Live rows only.** `wholePaymentLines`' `allocatedEver` sums live rows only.

## Audit (D7 A, R13)

`agreement.corrected` on the agreement:
```
{ supplementId, reasonCode, note,
  before: { amount, pricingBasis, vatTreatment, paymentTerms, vatRateBasisPoints, totals, effectiveTotal,
            installments: [{id, position, label, amount, gross, trigger, receivableId, receivableNumber, postingDate}] },
  after:  { …same, the new ids and receivable numbers },
  credits: [{creditId, receivableId, receivableNumber, effectiveDate, amount, priorCredited}],
  moved:   [{paymentId, paymentNumber, released: [{allocationId, receivableId, amount}], placed: [{allocationId, receivableId, amount}], unallocated}],
  balanceChange }
```
Alongside it:
- `receivable.credited` per credit (`source: 'CORRECTION'`, `reasonCode`, `agreementId`, `settled`);
- `installment.posted` per repost (`trigger: 'CORRECTION'`, `receivableId`, `postingDate`);
- **`receivable.settled`** for each receivable whose status changes to SETTLED, old or new, as MUT-443 does (R13).

## Supplement fields per distribution (R12)

The `SupplementSchema` descriptions are rewritten to say what each field means for each distribution:

| Field | Supplements | REDUCTION (MUT-480) | CORRECTION (MUT-444) |
|---|---|---|---|
| `amount` | Δ installments, pricing basis | Δ, ≤ 0, pricing basis | new amount − old amount when the pricing basis is unchanged; **0 when the basis changed**, because the two figures aren't comparable; read `appliedGross` |
| `resultingAmount` | new amount | new amount | new amount (new basis) |
| `appliedGross` | null | gross taken off (> 0) | gross taken off the effective total, old − new, the **same sign as REDUCTION**: positive when the fee went down, **negative when it went up** |
| `credited` | 0 | credits written | credits written (the remainders, D3) |
| `reasonCode` | null | the code | the code |
| `description` | partner's text | the note | the note |

## Files

- **New:**
  - `server/src/agreements/correct-terms.ts`;
  - `server/src/agreements/correct-terms-compose.ts`;
  - the tests listed below.
- **Extract only, no behaviour change.** Each extraction is guarded by the existing suites:
  - `agreements/create.ts`: `composeSchedule`;
  - `agreements/compose.ts`: `loadAgreementParties` out of `loadAgreementContext` (R9);
  - `prisma.ts` / `memory.ts`: `postInstallmentTx` / `postNow`, and `allocateRowTx`.
- `server/src/routes/agreements.ts`:
  - the two routes and `correctableAfterPosting`;
  - cancel passes `expectedVersion` (R11), and its description points at `/correct`.
- `server/src/repositories/ports.ts`:
  - `CorrectAgreementInput` and `CorrectAgreementResult`;
  - `AgreementRepository.correct`, and `cancel(…, expectedVersion)`;
  - `PaymentRepository.listLiveAllocationsOn`;
  - `AllocationRecord.releasedAt?: Date | null`.
- `server/src/repositories/prisma.ts` and `memory.ts`: `correct`, the cancel condition, and the R2 readers.
- `server/src/auth/store-guard.ts`: the new methods.
- `server/src/summaries/compute.ts`: `projectFigures` superseded rule (R4).
- `server/src/statements/build.ts`: R3 and live rows.
- `server/src/schemas.ts`:
  - the four request/response schemas;
  - `SupplementSchema.distribution` gains `CORRECTION`, with the R12 descriptions;
  - `VALIDATION_REASONS` gains `POSTED_INSTALLMENT_CHANGED`.
- `server/src/serializers.ts`: the supplement serializer accepts CORRECTION.
- `server/src/app.ts`:
  - `API_VERSION = '1.89.0-mut444'`, plus its bullet and the pinned literals;
  - then `npm --prefix server run openapi:generate`, then root `npm run hosted:types`.
- **Migrations** in `server/prisma/schema.prisma`, both additive with no CHECK and no NOT NULL:
  - `20261029100000_mut444_supplement_correction`: the enum value on its own;
  - `20261029100100_mut444_allocation_released_at`: `payment_allocations."releasedAt" TIMESTAMP(3) NULL`.
- **`server/src/scripts/rollback-check.ts` (R1).** Two new `ROLLBACK_HAZARDS` entries:
  - `{ ticket: 'MUT-444', migration: '_mut444_', count: SELECT (SELECT count(*) FROM payment_allocations WHERE "releasedAt" IS NOT NULL) + (SELECT count(*) FROM agreement_supplements WHERE distribution = 'CORRECTION') }`. Consequence: an older revision counts released allocations, so a reversal releases twice and lists and statements double them. Its Prisma client also has no `CORRECTION`, so agreement detail reads fail;
  - the missing **`{ ticket: 'MUT-480', migration: '_mut480_', count: SELECT count(*) FROM agreement_supplements WHERE distribution = 'REDUCTION' }`**. Consequence: an older client has no `REDUCTION`, so reading those agreements' supplements fails;
  - tests for both in `src/scripts/__tests__/rollback-check.test.ts`.
- `server/DEPLOYMENT.md` §6: the rows "Roll back past MUT-444" and "Roll back past MUT-480", in the existing form.
- `server/src/repositories/prisma-records-export.ts`: `ALLOCATION` is typed `Omit<AllocationRecord,'releasedAt'>` and the query filters `releasedAt: null` (R14).
- QA: `qa/features/portal-selfservice/malafat-money-api.yaml` and `qa/specs/portal-selfservice/malafat-money-api.spec.ts`.

## Local mode (R14)

- Correction is API-key only, so a device never writes a released row.
- `AllocationRecord.releasedAt` is optional and server-only (MUT-441's pattern). Memory's `applyAllocations` never sets it.
- `CURRENT_STORE_SNAPSHOT_VERSION` stays **13**, and there is no `src/hosted/local/migrations` entry.
- `src/hosted/local/__tests__/format-fingerprint.test.ts` must stay green unchanged. If it flags the optional field, register it as server-only, as MUT-441 did.
- The hosted records export leaves out released rows: the file holds the live ledger (TD-287).

## Rolling deploy (R1, TD-288)

During the roll, an old-revision instance could still serve `POST /v1/payments/{id}/reverse` for a payment whose row a new instance has just released, and release it twice. Two things keep that from happening:
- only the new revision can release;
- Malafat calls `/correct` only after re-vendoring, after the release is complete.

TD-288 records that small window. Rollback after the roll is gated by the R1 hazard.

## Tests (written first)

### Unit: `server/src/agreements/__tests__/correct-terms.test.ts`
- AC1 shape:
  - one posted VAT-inclusive line becomes exclusive: the credit equals the old gross, dated the old posting date; the repost carries the new gross on the same date;
  - 50/50 with the second line unposted: that line is replaced and not billed.
- Treatment:
  - STANDARD → EXEMPT and back;
  - a stored rate of 0 with a STANDARD line (the composer resolves it).
- D2:
  - a posted line's trigger changed → `POSTED_INSTALLMENT_CHANGED` with `change TRIGGER`;
  - fewer lines than the posted ones → `REMOVED`;
  - a DATE with another date counts as a change;
  - an unposted line's trigger change is allowed;
  - extra lines are allowed;
  - an unposted line turned IMMEDIATE posts today.
- Contingency upfront: 0 → X and X → 0.
- D3: remainder credits with exact net and VAT; a fully credited receivable gets no credit row.
- Payments:
  - two payments on two old charges, oldest first;
  - one payment split across two new charges;
  - a lower fee leaves unallocated money;
  - REVERSED payments and released rows are ignored;
  - **a payment split between this agreement and another: only the old part moves (R16).**
- Due dates under the new terms.
- `NOTHING_TO_CORRECT` vs a label-only change (a label change is a correction).
- A seeded property sweep (~2k cases) over the invariants.

### Unit
- **`statements/__tests__`** (R3, R16):
  - two posted lines through **two corrections in a row**: each generation reads "1 of 2" / "2 of 2" and the live lines read their own;
  - D5 order on the shared date: old charge, credit, repost;
  - released rows add no project line.
- **`summaries/__tests__/compute`** (R4): `posted` after one and two corrections, and after a MUT-100 corrected commission.
- **`scripts/__tests__/rollback-check.test.ts`** (R1, R16): the MUT-444 and MUT-480 entries fire on their migrations and count their rows.

### Route: `server/src/__tests__/agreement-correct.route.test.ts`
- **AC1.** Inclusive → exclusive:
  - the old charge is SETTLED by a back-dated credit with its `reasonCode`;
  - the repost is on the original date;
  - the preview's `customer.balance` delta equals `balanceChange`;
  - the customer summary's outstanding − unallocated and the statement's closing balance move by exactly that.
- **AC2.**
  - The payment's live allocations name the new charge.
  - A lower fee leaves money unallocated on the payment.
  - Σ payments = Σ live allocations + unallocated, and Σ receivables' paid = Σ live allocations.
- **AC3.**
  - An idempotent replay writes one supplement and one set of credits.
  - A **new payment allocated to one of this agreement's charges** between preview and commit → 409 `PREVIEW_STALE`, nothing written.
  - A payment to another client doesn't make the token stale.
  - A token previewed yesterday is stale after midnight.
  - A reason added after the preview still commits.
- **AC4.** Cancelled → 409 `AGREEMENT_CANCELLED`; contingency with an outcome → 409 `OUTCOME_ALREADY_RECORDED`; retainer → 422 `NOT_FIXED`.
- **AC5.**
  - `GET /v1/receivables/{old}/credits` shows the credit;
  - the statement lines appear in the D5 order;
  - the audit has `agreement.corrected` (before/after), `receivable.credited` (CORRECTION), `installment.posted` (CORRECTION) and `receivable.settled` per status change.
- **AC6.** `info.version` is `1.89.0-mut444`.
- **Refusals:**
  - `POSTED_INSTALLMENT_CHANGED` (TRIGGER, REMOVED);
  - `NOTHING_TO_CORRECT`, `REASON_REQUIRED`, `AMOUNT_INVALID`;
  - a strict-body field → 422;
  - archived customer → 422;
  - another organization → 404;
  - a key without `payments:write` can't commit, and one without `payments:read` can't preview;
  - sessions are refused;
  - due lines post before planning.
- **After a correction:**
  - the old manual trigger → 409 `INSTALLMENT_VOIDED`;
  - a reversal releases only live rows;
  - a MUT-443 correction of a moved payment works;
  - a second correction works;
  - a cancel with the version read before the correction is refused (R11).

### Store contract: `server/src/repositories/__tests__/store-contract-mut444.ts` (memory and Prisma; `test:db` in CI)
- **All or nothing.** Each `stale` cause leaves every table as it was:
  - the agreement version;
  - an installment version;
  - an old receivable's version;
  - a payment reversed;
  - a payment whose `allocatedMinor` changed;
  - a row already released.
- **Sums equal rows** after correction → reversal → new allocation.
- **The R2 readers ignore released rows**, including memory's `reverseNow`, `releasedBy`, `hasAllocations` and `list` by project (R16).
- **Numbering.** Reposts are numbered in their posting year with no gap.
- **Races (R10)**, run with `Promise.allSettled` on Postgres. Exactly one side wins; the loser gets `stale` or `LockConflict`, never a 500 and never a half write. The correction races:
  - `postInstallment` on an old unposted line;
  - `payments.allocate` onto an old charge;
  - `payments.correct` and `payments.reverse` of a moved payment;
  - `receivables.credit` on an old charge;
  - `agreements.reduce`;
  - `recordOutcome` (contingency);
  - `cancel` (version-conditional);
  - a lazy post on **another agreement in the same organization** (they share the CHG counter; no deadlock).
- **P2028** maps to `stale`.
- **Records export.** A released row isn't exported, and the export type has no `releasedAt`.

### Migrations
Additive. The Prisma suite's `migrate deploy` covers them; there is no local migration.

### How to verify
Everything runs through `heavy`, under Node 22:
- server `typecheck`, `lint`, `openapi:check` and `test`;
- root `npm run test:run`;
- `test:db` in CI.

## QA scenarios: feature `agreement-correct` in `malafat-money-api.yaml`

- `tier: secondary`.
- `paths`: `server/src/agreements/correct-terms.ts`, `server/src/agreements/correct-terms-compose.ts`, `server/src/routes/agreements.ts`, `server/src/statements/build.ts`, `server/src/summaries/compute.ts`.
- One Playwright `test`, tagged `@portal-selfservice.malafat-money-api.agreement-correct`. It plays Malafat with fetch against the live dev API using the QA integration key, and wraps every action in `step(...)`.

Steps:
1. Malafat sets up a client, a project and a ₪1,000 VAT-inclusive fee split 50/50, "On signing" (IMMEDIATE) and "On judgment" (MANUAL), at 18%. It records a ₪300 payment on the signing charge.
2. Malafat previews correcting the fee to ₪1,000 VAT-exclusive, reason ENTERED_BY_MISTAKE.
3. Malafat confirms with the token. — **AC1, AC2**
4. Malafat sends the same request again with the same key. — **AC3**
5. Malafat corrects the fee again, to ₪200 VAT-inclusive. — **AC2 excess**
6. Malafat corrects the VAT treatment from STANDARD_RATED to EXEMPT, same ₪200 VAT-inclusive. — **R16 treatment step**
7. Malafat tries the refusals — **AC3, AC4, D2**:
   - a stale preview: Malafat bills "On judgment" (its manual trigger), previews a correction, records a new ₪100 payment allocated to that ₪100 judgment charge, then confirms with the old token;
   - OTHER with no note;
   - the same terms again;
   - "On signing" changed to MANUAL;
   - a cancelled agreement;
   - a contingency agreement with its outcome;
   - a retainer.
8. Malafat reads the old charges' credits, the client's statement, the payment, the audit log and the contract version. — **AC5, AC6**

Expect:
- **The first preview:**
  - line 1 goes from ₪500 gross (₪423.73 + ₪76.27) to ₪590 (₪500 + ₪90), billed on the original date;
  - line 2 goes from ₪500 to ₪590 and isn't billed yet;
  - a ₪500 credit is dated the original date;
  - the ₪300 payment moves to line 1;
  - the client's outstanding goes from ₪200 to ₪290 and the balance from ₪200 to ₪290 (Δ ₪90).
- **After confirming:**
  - the old lines read VOID;
  - the old charge is SETTLED by the credit, with ENTERED_BY_MISTAKE;
  - a new ₪590 CHG is dated the original day with ₪300 paid;
  - the payment shows ₪300 allocated to the new charge and ₪0 unallocated.
- **The replay** answers the same; there is still one CORRECTION supplement and one credit from it.
- **The second correction** leaves ₪100 paid on the new ₪100 charge and ₪200 unallocated. Outstanding goes ₪290 → ₪0, unallocated ₪0 → ₪200, the balance moves by −₪490, and no payment is lost.
- **The EXEMPT correction:** the ₪100 charge is now net ₪100 and VAT ₪0, the gross is unchanged, the balance doesn't move, and the payment's ₪100 sits on the new charge.
- **The refusals:** 409 PREVIEW_STALE, 422 REASON_REQUIRED, 422 NOTHING_TO_CORRECT, 422 POSTED_INSTALLMENT_CHANGED, 409 AGREEMENT_CANCELLED, 409 OUTCOME_ALREADY_RECORDED and 422 NOT_FIXED. None of them writes anything: the agreement's version is unchanged.
- **The statement,** on the original date: each old charge, its credit, then its repost. The judgment charge and its ₪100 payment follow. The closing balance is −₪200, and the matter's `posted` is ₪200: the signing charge's latest repost plus the judgment charge, never the replaced charges.
- **The audit** has `agreement.corrected` with the before and after terms. The contract version reads 1.89.0-mut444.

`release-qa lint` must report no errors and no new unmapped files. Run `release-qa run --attach --only agreement-correct` until the spec passes.

## Knowledge (at build)

- **ADR-226:** "Correcting an agreement's terms is one write: void every line, credit each posted charge's remainder on its own date, repost on the original dates, move payments oldest first". It records:
  - D1–D7 as answered;
  - the scope rule and `POSTED_INSTALLMENT_CHANGED`;
  - the frozen rate;
  - the token;
  - the lock order: agreement → payments → old receivables → CHG counter → installments;
  - the superseded receivable in matter figures, including the MUT-100 fix (R4);
  - the version-conditional cancel (R11);
  - that ADR-217's consequence note is superseded by D5 B.
- **PATTERNS:**
  - "an allocation is released, never edited" (`releasedAt`; every reader counts live rows; the list is in ADR-226);
  - "post inside another write with `postInstallmentTx`, counter before installment rows";
  - "a rollback hazard entry for every migration that makes rows an older revision misreads".
- **TECH_DEBT:**
  - TD-287: the records file drops released allocation rows;
  - TD-288: the in-roll window for a reversal on an old instance;
  - TD-289: a repost into an earlier year takes a CHG number out of issue order;
  - TD-290: trigger fixes on posted lines (the follow-up ticket).
- CHANGELOG, TEST_PLAN and SYSTEM_OVERVIEW (agreements, matter figures).
- **Jira:**
  - a follow-up ticket for posted-line trigger fixes;
  - a comment on MAL-1368 with the Note for Malafat;
  - a comment on MUT-480 about the rollback entry.

## Note for Malafat (R15)

Before MAL-1368 ships, Malafat's client must **re-vendor 1.89.0-mut444**. The changes Malafat will see:
- **Endpoints and access:**
  - `POST /v1/agreements/{id}/correct/preview` and `/correct`;
  - the integration key needs `payments:read` and `payments:write` on top of the agreement scopes.
- **Payments:**
  - after a correction, `GET /v1/payments/{id}` shows a moved payment's allocations on the **new** charges; the old allocations disappear from it;
  - the payment's `version` is bumped, so an `If-Match` on its receipt number must re-read first.
- **Installments:**
  - installment ids change after a correction;
  - positions keep growing (the old lines are listed VOID at their old positions; the new ones follow);
  - a manual trigger on an old id answers 409 `INSTALLMENT_VOIDED`;
  - a posted line's trigger can't change: 422 `POSTED_INSTALLMENT_CHANGED` with `{ position, change }`.
- **Supplements:** `SupplementSchema.distribution` can be `CORRECTION`, with the R12 field meanings. `appliedGross` is negative when a correction raises the fee.
- **Statement:**
  - a correction's credits are **dated the old charge's posting date**, so a past period's statement changes after a correction;
  - a reposted charge keeps its original date and takes a CHG number of that year.
- **Matter figures:** the matter's `posted` no longer counts a charge that a correction (or a MUT-100 outcome correction) replaced.

## Impact, i18n, cost, infra

- **Portal and phone:** they read through the store, so released rows are invisible to them. The matter's `posted` changes as R4 describes. Only the portal's generated types are regenerated.
- **i18n:** API only. Messages are in English, like every API message.
- **Cost:** no new infrastructure. The write is one transaction of up to about 60 lines, within a 15 s limit.
- **Infra:** two additive migrations.
- **Release:**
  - tell the orchestrator and the other mini-crm sessions before migrating `mutaba3a_test`;
  - take `/tmp/mutaba3a-locks/mini-crm-main` to merge;
  - `migrate deploy` dev and test, then `prisma generate`.

## Scope check

All six ACs are mapped above, with AC1 measured on the balance (Basel).

Out of scope:
- retainers;
- post-outcome contingency;
- currency, customer or project changes;
- `agreementDate` and `description`;
- trigger changes on posted lines (the follow-up).

## Business / product impact

- A partner fixes a fee saved with the wrong VAT basis, treatment or amount in one action, even after it was billed and paid. The client's balance, aging, past periods and payments come out right.
- It unblocks MAL-1368.
- Risk: it is the widest money write so far. It is contained by:
  - a pure, property-tested planner;
  - one locked transaction in the existing lock order;
  - a token over the agreement's ledger, its payments and the day;
  - contract tests on both stores, including races;
  - a rollback gate.

## Eng review 2026-10-29

This is an independent eng review of the first draft. Where it differs from the body above, this section wins; the body has already been updated to match.

| # | Finding | Disposition |
|---|---|---|
| R1 | Rollback past the migration makes an older revision misread released rows; MUT-480's REDUCTION was never gated either | **Applied.** `ROLLBACK_HAZARDS` entries for MUT-444 (released allocations + CORRECTION supplements) and MUT-480 (REDUCTION supplements), DEPLOYMENT §6 rows and rollback-check tests. The in-roll window is TD-288. |
| R2 | Allocation readers the draft missed: memory `reverseNow`, `releasedBy`, `hasAllocations`, `payments.list` `onProject`; Prisma `payments.list` `allocations none/some` | **Applied.** Added to "Allocation readers"; contract tests cover a MUT-443 correction of a moved payment, a reversal after a correction and a list by project. |
| R3 | `originOf` numbering of voided posted lines | **Applied.** Numbered within their generation (same `voidedAt`), with `of` = the generation size; tested with two posted lines through two corrections. |
| R4 | The matter's `posted` double counts | **Applied.** Superseded receivables (the installment is voided and posted) leave `posted`, `paid` and `credited`. This also fixes MUT-100's corrected commission. Tested and recorded in ADR-226. |
| R5 | The statement order with credits dated today | **Resolved by Basel, D5 = B.** Credits are dated the old posting date; the repost is created 1 ms after the credit. |
| R6 | Slot mapping, un-billing and extra lines over posted slots were under-specified | **Resolved by Basel's scope answer.** Posted lines keep their count and triggers (422 `POSTED_INSTALLMENT_CHANGED`); unposted lines change freely. |
| R7 | The credits and payment moves need payment scopes | **Applied.** The commit needs `agreements:write` + `payments:write`; the preview needs `agreements:read` + `payments:read`. |
| R8 | The token didn't cover the moved payments | **Applied.** It hashes `(id, receivedOn, status, allocatedMinor)` of each payment with a live allocation on an old receivable, without its version; the store re-checks `allocatedMinor` under lock. The AC3 and QA stale steps allocate the new payment to this agreement's charge. |
| R9 | `loadAgreementContext` resolves the rate | **Applied.** `loadAgreementParties` is split out (guarded by the create tests). The defaults are the agreement's frozen rate and its own treatment. |
| R10 | Per-row writes and missing races | **Applied.** `createMany` with planned ids, one UPDATE for the releases (the voids stay per row so a miss is attributable). Added races against `recordOutcome`, `payments.reverse`, `receivables.credit`, `cancel` and a lazy post on another agreement in the same organization. |
| R11 | Cancel can race a correction | **Applied.** The store's cancel is conditional on the agreement version; a miss is answered by the state found. |
| R12 | Supplement field meanings for CORRECTION | **Applied.** A per-distribution table; `amount` is 0 when the basis changed; `appliedGross` has REDUCTION's sign (negative when the fee goes up). |
| R13 | `receivable.settled` was missing | **Applied.** Emitted for each status change, as MUT-443 does. |
| R14 | Local mode details | **Applied.** The fingerprint test is `src/hosted/local/__tests__/format-fingerprint.test.ts`; memory's `applyAllocations` never writes `releasedAt`; the export's `ALLOCATION` is `Omit<AllocationRecord,'releasedAt'>` and filters released rows. |
| R15 | Malafat-visible changes weren't listed | **Applied.** "Note for Malafat" section. |
| R16 | Test gaps | **Applied.** A payment split across two agreements, `originOf`, the R2 memory paths, the rollback-check entries; the QA scenario gains a STANDARD → EXEMPT step. |

## Build notes 2026-10-29

Built to the plan and the review above. Where the code made the plan's wording concrete, the smallest change that keeps every AC and Basel's decisions was taken; none changes what Malafat sees beyond the plan.

| # | Where | What was built | Why |
|---|---|---|---|
| B1 | `CorrectAgreementResult.record` | Also carries `supplement` | The response returns the CORRECTION row; reading it back would be a second query outside the write. |
| B2 | `agreements.cancel` | `expectedVersion` is an optional field of the input object, not a new positional argument | The retainer cancel shares the method and doesn't need it; the agreement cancel always passes it (R11). |
| B3 | `POSTED_INSTALLMENT_CHANGED.position` | The 1-based place k in the request's `installments` (the old line's place among the live lines), not the stored `position` | Malafat knows its lines by place; stored positions grow with every correction. |
| B4 | D2 `REMOVED` on a FIXED agreement with no lines | An empty `installments` on FIXED is 422 `NO_INSTALLMENTS` (the schedule's own rule) before the planner runs | Same answer as create; `REMOVED` is reachable with fewer lines than the posted ones (route test bills both lines, then sends one). |
| B5 | Response `unallocated[]` | Lists only moved payments with something left over | An entry of 0.00 says nothing; the preview's `allocations[].unallocated` still shows every moved payment. |
| B6 | Statement | `buildStatement` also drops released rows itself, besides `statementSources` | Defence in depth for any caller that feeds it raw rows. |
| B7 | Memory records export | Filters released rows and strips `releasedAt` too | Keeps the Prisma/memory export parity (TD-287). |
| B8 | QA | The receivable read shows the old charge as `PAID` (`receivableStatus`), so the spec checks `outstanding 0.00`, `credited 500.00` for "SETTLED by the credit" | The wire has no SETTLED status on receivables. |
| B9 | QA | Each refusal is its own recorded step (stale, OTHER, same terms, trigger, cancelled, contingency outcome, retainer) | Every error code maps to a step. |
| B10 | Worktree only | `server/node_modules` is a real directory linking to main's entries, with its own `.prisma` and `@prisma` copies | `prisma generate` for the new schema must not overwrite the main checkout's client (its typecheck would fail on `CORRECTION`). |

## Pre-landing review 2026-10-29

An independent pre-landing review found no CRITICAL or HIGH issues. Its four findings, all applied test-first (the tests were committed before the fixes; red/green proven once the machine's hold lifts):

| # | Finding | Disposition |
|---|---|---|
| P1 | The QA spec's retainer (start 2027-01, on the fee's own client and matter) would bill from 2027-01-01 and break the final closing-balance and `posted` checks | **Applied.** The retainer refusal step creates its own client and matter; the NOT_FIXED step is unchanged. |
| P2 | `frozenRate` read a frozen 0 as "no rate" and re-resolved on `agreementDate`; `unchanged()` never compared the rate | **Applied.** A 0 % rate is a real rate (`PUT /v1/settings/vat` accepts 0). The rate is re-resolved only when no rate row was in force on the agreement date when the agreement was created (a row with `effectiveFrom ≤ agreementDate` and `createdAt ≤ agreement.createdAt`); otherwise the frozen 0 is kept. `NOTHING_TO_CORRECT` also compares `vatRateBasisPoints`. Tests: the route (a frozen real 0 % stays 0 after an 18 % rate is set later for that date; the existing "no rate at creation" case still resolves) and the planner. ADR-226 §5 amended. |
| P3 | A placement whose payment isn't in `input.payments` would be written without its payment being locked, re-checked or updated | **Applied.** Both stores answer `stale` (memory `correctable`, Prisma `correctAgreementTx` step 8). The composer never sends one; this is defence in depth. Contract test on both stores. |
| P4 | Test gaps | **Applied.** Route: AC1 with other charges and unallocated money on the client (the preview's `customer.*.after` equals the summary after the commit); AC2 with an earlier credit and a payment on the same old charge (D3 and the release together: credit ₪450 with ₪50 prior, ₪300 moved, Δ ₪140); AC5: an old charge already paid in full emits no `receivable.settled` from the correction (its status didn't change; only the payment's original event exists), and the still-open repost emits none. Unit: P2034 and 40P01 answer `stale`, like P2028. |

