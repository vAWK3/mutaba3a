# MUT-661: Issue as you record

Status: built 2026-11-25 on `feature/mut-661-issue-as-you-record` (mini-crm) and `feature/mut-661-phone` (Flutter), under Basel's standing authorisation (decisions in ADR-279). Blockers MUT-660 and MUT-662 are merged.

## Problem
Most documents follow a moment the person is already in: an Owed just recorded, a payment. Design B puts issuing at those moments, with no setup step first.

## Acceptance criteria
From the ticket, AC1 to AC8 (ask once; Payment request first -> "Issue payment request"; 1,000 on a 3,400 tax-invoice-first Owed -> receipt, 2,400 stays owed; the same on On payment -> invoice-receipt; control off -> To issue; No document sees nothing; a refused issue keeps the payment and says so; release-QA flows on iOS and portal).

## Solution
See ADR-279. Server: `POST /v1/receivables/{id}/settle-and-issue` (one Idempotency-Key; payment via `settleOwed`, document via the single issue from `documentsDue`; refusal is a 201 with `issue.status` failed/held). Portal: `DocumentsPreferenceAsk` after the first income for a client with no preference, `issueOffers` by preference, one control in Record payment. Phone: the same ask as a bottom sheet, the same control in the payment sheet.

## Reuse
`documentsDue`, `issueOne`, `settle` core, `DocumentsPreferenceField` choices copy, `IssueOfferProvider`, MUT-722's `useSetupHint` (unchanged; the two never both speak: the ask needs a setup that can issue).

## Copy (portal ar + en, phone en + formal ar)
Ask: "How do you issue documents to {client}?" / «كيف تُصدر المستندات لـ{client}؟»; choices Tax invoice first, Payment request first, On payment, No document (MUT-660's labels) with one hint line each; "Not now". Control: "Issue a receipt / tax invoice-receipt for this payment". Result: "Document {n} issued." / "The document couldn't be issued, so it is waiting in To issue."

## Error states
Issue refused or held: payment recorded, message says the document waits in To issue. Ask save fails: stays open with the message. Tax invoice's Owed: the receipt is the payment; a refused issue records nothing and shows the issue's own error.

## Impact, cost, infra
API 1.140.0-mut661, no migration, no new infra. Portal local mode untouched.

## QA scenarios
Portal `portal.invoicing.issue-as-you-record`:
1. On a business profile that can issue, record ₪3,400 owed for a new client -> the ask drawer opens with four choices.
2. Choose Tax invoice first -> the toast offers "Issue a tax invoice".
3. Record a second Owed for the same client -> no ask.
4. Record payment ₪1,000 on an On payment client's Owed with the control on -> the toast says the invoice-receipt was issued; ₪2,400 stays owed.
5. The same with the control off -> payment only, the document is in To issue.
Phone `ios.invoicing.issue-as-you-record`:
1. Save the first ₪ income for a new client on a business profile -> the sheet asks; choose On payment -> no issue action.
2. Record a partial payment (Part, ₪1,000 of ₪3,400) with "Issue its document" on -> the SnackBar says the document was issued; the Owed shows ₪2,400 owed.
