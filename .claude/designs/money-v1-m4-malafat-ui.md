# Money v1 — Milestone 4, Malafat side: payment wizard, payment detail and reversal, credits (design brief)

- **Date:** 2026-10-08 · **Status:** decided by the engineering owner under the "complete the epic" instruction and implemented the same day (see Malafat `crm-platform/.claude/CHANGELOG.md` "Money v1 Milestone 4")
- **Tickets:** MAL-939 (epic), MAL-150 (UX brief, wireframes §6, §7) · **Mutaba3a side:** `money-v1-m4-payments-allocations.md`, API `1.3.0-m4`
- **Repo side:** Malafat `crm-platform/apps/web` + `packages/core` i18n only. **No schema change** (ADR-150 rule 1).
- **Where this file lives:** same reason as the M3 Malafat brief — Confluence (Design Documents) is not reachable from the session, and Malafat's repo rule 13 forbids new Markdown there.
- **Bounded by:** ADR-150 (+ M2/M3 addenda), the Mutaba3a contract §4, DESIGN.md, the M3 Malafat brief's decisions (no sums in Malafat, one implementation two doors, attemptId idempotency).

## 1. Problem and acceptance criteria

Mutaba3a M4 can now receive money: payments with allocations, previews with strategies, later allocation of unallocated funds, whole-payment reversal, append-only credits, and an operations lookup for lost responses. Nothing in Malafat can record a payment, show one, or credit a receivable. This milestone adds the Malafat surfaces the Mutaba3a brief (§2.6) named:

1. **Payment wizard** `/admin/money/payments/new?client=&matter=&replaces=` — Record → Allocate → Review (wireframe §6a–§6d), with the three posting outcomes of §6e.
2. **Payment detail** `/admin/money/clients/[clientId]/payments/[paymentId]` (§7) with **Reverse payment** (§7a), **Allocate now** for unallocated funds, and **Record corrected payment** after a reversal.
3. **Payments on the client financial page** and **Record payment** entry points on the client and matter financial pages.
4. **Credit a receivable** dialog, reachable from a receivable row and from the supplement safeguard that M3 left pointing at "an explicit adjustment".

Acceptance:

- A Partner records a payment exactly as the review step showed it; the review shows Mutaba3a's resulting balances per matter and for the client; a receivable or credit change between review and confirm surfaces as `PREVIEW_STALE` in words with "Review again".
- A double click, a retried request, or a connection drop cannot record two payments: the `attemptId` minted when the wizard opens is the Idempotency-Key; the "not confirmed" state (§6e) resolves through `GET /api/admin/money/operations/payment/{attemptId}` and never offers a blind "try again".
- Every running total on the Allocate step is Mutaba3a's (its preview answers each change); Malafat adds nothing up (ADR-150, M3 decision 1).
- Reversal requires a reason, shows what will be undone from the payment record itself, and leaves the payment in the list marked Reversed; a corrected payment carries `replacesPaymentId`, and the detail page shows both links.
- A credit is refused beyond the outstanding balance with Mutaba3a's reason and the outstanding amount in words; the receivable row shows `credited`.
- Every new route is Partner-only, has a `route.spec.ts`, maps errors through `moneyErrorResponse`; the contract test covers every call; the i18n test pins every new reason and enum; all gates green.

## 2. Solution

### 2.1 Data flow

```
Wizard opens (RSC)             payments-service.getPaymentContext(client)   ──► GET /v1/customers?externalId · GET /v1/projects?customerId · GET /v1/receivables?customerId&status=OPEN
  Allocate step renders   ──►  POST /api/admin/money/payments/preview       ──► POST /v1/allocations/preview  {customerId, currency, amount}            → eligible list, everything unallocated
  strategy button         ──►  …/preview {strategy}                                                                                                → suggested allocations fill the inputs
  each edited amount      ──►  …/preview {allocations} (debounced 350 ms)                                                                          → allocated / unallocated, or a 422 naming the row
  Review step renders     ──►  …/preview {allocations}                                                                                             → balances before → after + previewToken
  Confirm                 ──►  POST /api/admin/money/payments {…, previewToken, attemptId} ──► POST /v1/payments  Idempotency-Key = malafat-payment-{tenant}-{attemptId}
  not confirmed           ──►  GET /api/admin/money/operations/payment/{attemptId}  ──► GET /v1/operations/{key}  → COMPLETED | PENDING | 404
Detail page (RSC)              payments-service.getClientPayment(client, payment) ──► GET /v1/payments/{id} (customer must be the client's)
  Allocate now            ──►  wizard in `allocate` mode: …/preview {paymentId,…} → POST /api/admin/money/payments/{id}/allocations
  Reverse                 ──►  POST /api/admin/money/payments/{id}/reverse {reason, attemptId}
Matter financial          ──►  Credit dialog → POST /api/admin/money/receivables/{id}/credits {amount, reason, effectiveDate?, attemptId}
Client financial (RSC)         payments-service.listClientPayments           ──► GET /v1/payments?customerId
```

### 2.2 Module layout

| Piece | Path |
|---|---|
| Service | `features/money/application/payments-service.ts` — `getPaymentContext`, `listClientPayments`, `getPayment`, `getClientPayment`, `previewAllocation`, `recordPayment`, `allocatePayment`, `reversePayment`, `creditReceivable`, `getOperationOutcome` |
| Routes | `api/admin/money/payments/{preview,route,[paymentId]/{route,allocations,reverse}}`, `api/admin/money/receivables/[receivableId]/credits`, `api/admin/money/operations/[action]/[attemptId]` — seven, Partner-only, each with `route.spec.ts` |
| Error mapping | `error-response.ts` passes Mutaba3a's raw `details` through as `details.remote` (so the Allocate step can name the receivable a 422 is about) |
| Wizard | `features/money/ui/payment-wizard.tsx` (+ pure `payment-wizard-model.ts`), page `admin/money/payments/new/page.tsx`; the same component in `allocate` mode on `admin/money/clients/[clientId]/payments/[paymentId]/allocate/page.tsx` |
| Detail | `features/money/ui/payment-detail.tsx` (+ `ReversePaymentDialog`), page `admin/money/clients/[clientId]/payments/[paymentId]/page.tsx` |
| Credits | `CreditReceivableDialog` in `matter-financial-dialogs.tsx`; `MatterFinancial` gains a Credited column, a Credit action and a Record payment button; the supplement safeguard lists "Credit this receivable" per posted receivable |
| Client page | `ClientFinancial` gains a Payments section and a Record payment button |
| i18n | `money.payments.*`, `money.enums.{paymentMethod,allocationStrategy,paymentStatus}`, the 13 M4 `reasons.*`, `sync.conflicts.ALREADY_REVERSED` |

## 3. Decisions (owner's, recorded for review)

1. **The Allocate step's totals come from Mutaba3a.** Every edit re-runs the preview (debounced); strategy buttons fill the inputs from Mutaba3a's suggestion; a 422 marks the row it names. Malafat never sums. (Alternative in the wireframe note — browser running totals as "interaction feedback" — rejected because M3 decision 1 made "no Malafat sum on a Money surface" the rule, and the preview is cheap.)
2. **Client is preselected, always.** The wizard starts from a client or matter page (`?client=`, optional `?matter=` to sort that matter's receivables first). A client picker is not built; the Money overview has no "Record payment" button until it exists (wireframe §1's button is M6 work with the summaries).
3. **§6e as specified.** A transport failure or 5xx after Confirm enters "not confirmed": poll the operations route every 3 s for up to 60 s; `COMPLETED` 2xx → recorded (navigate to the detail); `COMPLETED` 4xx → definitive failure in Mutaba3a's words, button re-enabled with the same key; `UNKNOWN` (404, key never claimed or released) → button re-enabled with the same key; `PENDING` → keep polling, then "still verifying" with a manual check. `beforeunload` guard while not confirmed.
4. **Allocate later reuses the wizard.** Mode `allocate` skips Record, previews with `{ paymentId }`, posts to `/allocations`. One implementation, two doors (M3 decision 2).
5. **Reverse is a dialog on the detail page**, built on the Modal + destructive Button conventions with a required reason; its "effect" block is read off the payment record (allocations, unallocated) — Mutaba3a's figures, no arithmetic.
6. **Record corrected payment** opens the wizard with `?replaces=` and prefills amount, method, reference and notes from the reversed payment; the body carries `replacesPaymentId`.
7. **Credits** have one dialog; credit history per receivable and the payment's history/documents wait for M6 (audit + attachments), as the wireframe's Documents/History blocks do.
8. **Payment list** on the client page is the one list (number, received, method, amount, allocated, unallocated, status); a cross-client ledger belongs to M6 summaries.

## 4. Out of scope (M6)

Receipt upload on the Record step and the Documents block (attachments); History (audit); overview "Record payment" and unallocated-payments tile (summaries); totals of any kind.
