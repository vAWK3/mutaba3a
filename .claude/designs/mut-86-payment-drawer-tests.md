# MUT-86 — Record payment drawer leads with what's left: test plan

- **Ticket:** MUT-86 (epic MUT-74) · **Brief:** `landing-apple-redesign.md` decision P1 (approved 2026-10-11) · **Builds on:** MUT-6 (prefill, ADR-030), MUT-18 (dated payments, ADR-038), MUT-5 (strict amount parsing, E2)
- **Files:** `src/components/drawers/__tests__/PartialPaymentDrawer.test.tsx` (rewritten), `src/lib/__tests__/paymentEntry.test.ts` (new), `src/lib/__tests__/dates.test.ts` (`isFuturePaymentDate`), `src/lib/i18n/__tests__/paymentDrawerKeys.test.ts` (new), `e2e/record-payment.spec.ts` (new), `e2e/support/axe.ts` (`paymentDrawer` surface)

## Implementation decisions (P1 is the decision; ADR-047 records the parts that amend ADR-038)

| # | Decision |
|---|---|
| D1 | **Title.** Create mode with something left: "Record Payment · {amount} left" (`transactions.partialPayment.titleLeft`), the amount from `formatAmount` in the UI locale, wrapped in FSI/PDI isolates. Edit mode: "Edit Payment". Loading and settled: "Record Payment". The action keeps the app's Title Case so the drawer's title matches the row button that opened it (`recordPayment`); the brief's sentence case is informal. |
| D2 | **One large amount field.** `.input-with-prefix` (currency code first, LTR in Arabic) with a `payment-amount` modifier for the large type. The label "Payment amount" is visually hidden; the title already names what is left. Prefilled with the remaining balance as a plain decimal (`3550`, `887.50`): never grouped, so deleting a digit can't produce an unreadable `3,55`. Focused and selected on open, so typing replaces the prefill. The text is kept as typed and read with `parseAmountInput` (MUT-5's strict grammar: Arabic-Indic digits, one currency token); `formatCurrencyInput` no longer filters keystrokes. |
| D3 | **Live line.** A pure helper, `describePaymentAmount(raw, currency, allowedMinor)` in `src/lib/paymentEntry.ts`, classifies the typed text. Under the field: equal to what's allowed → "Paid in full"; less → "{left} still owed"; more → the overpayment message, live, in the error colour. Empty, unreadable, zero or negative, or another currency's symbol show nothing while typing (an intermediate "1,2" on the way to "1,200" must not nag) and become a field error on Record. Allowed = remaining (create) or remaining + the record's own amount (edit). The line is `aria-live="polite"` and describes the input. |
| D4 | **Date.** A quiet row "Payment date · Today ›" (the chosen date, formatted from local midnight, once it is not today). Pressing it replaces the row with the labelled date input, focused. Default `todayISO()` (ADR-022); edit mode starts at the record's date. On Record: empty → `validation.dateRequired`; `isFuturePaymentDate` → `futureDate` (ADR-038). `isFuturePaymentDate` moves from `repository.ts` to `lib/dates.ts` with an optional `today` argument, unchanged in meaning, and the repository imports it. The chevron mirrors in RTL. |
| D5 | **Notes.** "+ Add note" is a quiet button; pressing it replaces it with the labelled Notes field, focused. Edit mode on a record with notes opens it. Notes always travel with Record (the dropped-notes bug P1 cites). |
| D6 | **One primary action.** Footer: Cancel + Record Payment (create), Cancel + Update Payment (edit, unchanged). A settled entry (nothing left, create mode) shows no form and no primary button: the body says "Paid in full", lists the history, and the footer offers Close. |
| D7 | **Record closes the drawer.** On success the drawer closes, whether the payment settles the entry or not. Before, Record Payment reset the form and stayed open, and only Mark Fully Paid closed it. H1 (row slides out) and R1 (show where it landed) both need the drawer closed after a save. Update in edit mode still returns to the entry's create view, as before. |
| D8 | **History only when there is history.** "Payment History" renders below the form only when the entry has records. The rows (edit, delete) are unchanged. |
| D9 | **Edit mode waits for its record.** While an edit is asked for and the records are still loading, the drawer shows its spinner, and the form is keyed on the found record's id. Before, the form could mount before the record arrived: it fell back to create mode under the title "Edit Payment", so pressing the button created a second payment. |
| D10 | **Removed.** Mark Fully Paid (and the `markFullyPaid` key in both locales), the 25/50/100% chips (`QuickAmountButton`), the Amount/Received/Remaining box, the empty "No payments recorded yet" history (the key stays: the client's Payments section uses it), and the form's "Record Payment" sub-heading. The date state moves back into the form: ADR-038 §5 lifted it to the drawer only for Mark Fully Paid. |
| D11 | **Props unchanged** (`transactionId`, `onClose`). MUT-82 opens the drawer the same way and gets the remaining amount and today by default. Its Undo will need the created record, which `useCreatePaymentRecord` already resolves with; an `onRecorded` callback can surface it then. Not built here. |
| D12 | **Styles** live in a co-located `PartialPaymentDrawer.css` with logical properties. `index.css`'s drawer block and the shared `Drawer` are untouched (MUT-80 is changing them). |

## Rules under test

| # | Rule | Level |
|---|---|---|
| T1 | `describePaymentAmount`: equal → paid in full; less → still owed with the difference; more → over, carrying what is allowed; empty; unreadable ("1,2", "abc"); zero and negative → not positive; "$100" in an ILS entry → currency mismatch naming USD; "₪100" in an ILS entry is read; Arabic-Indic "١٧٧٥" and "١٬٧٧٥٫٥٠" are read; nothing allowed → any positive amount is over | unit |
| T2 | `minorToAmountInput`: 355000 → "3550", 88750 → "887.50", 5 → "0.05", 100 → "1" | unit |
| T3 | `isFuturePaymentDate`: date-only today and yesterday are not future, tomorrow is; a local-evening timestamp whose UTC date is tomorrow is not future; a timestamp on tomorrow's local date is; an unreadable timestamp past today is future. Built from local `Date`s so it holds in any TZ | unit |
| T4 | Title: create mode reads "Record Payment · $750 left"; edit mode reads "Edit Payment" | component |
| T5 | Two taps: opening and pressing Record Payment records the full remaining amount, dated today, and closes the drawer | component |
| T6 | One primary action: the footer holds exactly Cancel and Record Payment; no Mark Fully Paid, no 25/50/100% chips, no Received so far / Remaining box, no Payment History or "No payments recorded yet" when the entry has no records | component |
| T7 | Live line: the prefill says "Paid in full"; every keystroke updates it ("1" → "$749 still owed", "10" → "$740 still owed", "100" → "$650 still owed"); Arabic-Indic "١٠٠" says "$650 still owed"; "800" shows the overpayment message before Record | component |
| T8 | Partial payment: 100 records 10000 minor and closes | component |
| T9 | Notes kept: "+ Add note" reveals a focused Notes field and disappears; the typed note reaches the mutation with the amount and date | component |
| T10 | Overpayment is rejected inline: 800 of 750 → message, no mutation, drawer stays open | component |
| T11 | Field errors on Record: "1,2" → "Enter an amount like …"; "0" → "must be greater than 0"; "€100" in a USD entry → the currency-mismatch message; no mutation in each case | component |
| T12 | Date: the row says "Today"; pressing it reveals the date input, focused, holding today; a backdated 2026-01-15 is what gets stored; 2099-01-01 is refused with the future-date message; an emptied date is refused with "Date is required" | component |
| T13 | ADR-022: the date defaults to the local calendar today at two instants that straddle midnight in opposite directions | component |
| T14 | Edit mode: the record's amount (250) prefilled; the date row shows the record's date; the live line counts the record's own amount as allowed (250 of 1000 → "$750 still owed"; 1000 → "Paid in full"); a record with notes opens the Notes field with them; Update sends `{ id, transactionId, data: { amountMinor, paidAt, notes } }` and returns to the create view | component |
| T15 | Edit mode waits: with an edit asked for and the records loading, no amount field and no action button render | component |
| T16 | Settled entry, create mode: no amount field, no Record Payment, "Paid in full" shown, the history listed, Close closes | component |
| T17 | History: an entry with records lists them under "Payment History" below the form; a row's edit button asks the store to edit that record | component |
| T18 | A repository rejection renders inline and the drawer stays open | component |
| T19 | i18n: the new keys (`titleLeft`, `paidInFull`, `stillOwed`, `addNote`) are non-empty in en and ar; `titleLeft` and `stillOwed` keep `{amount}`; `markFullyPaid` is gone from both | unit |
| T20 | In a browser: log an entry, press Record Payment on its row, press Record Payment in the drawer → the drawer closes and the row no longer offers Record Payment | e2e |
| T21 | In a browser: Enter in the amount field records (the footer button is outside the form, linked by `form=`, which user-event can't drive) | e2e |
| T22 | Axe on the open drawer with the date and note fields revealed: no rule beyond the known `color-contrast` (the teal primary) | e2e |

## Edge cases

- Remaining has cents (887.50) → prefill "887.50", title "$887.50 left", live line "Paid in full".
- A legacy entry with more received than its amount → remaining ≤ 0 → settled view, nothing recordable (ADR-030).
- Arabic UI → the title's amount stays whole inside the RTL sentence (isolates); the amount field stays LTR, currency first; the date chevron points left.
- Edit mode Cancel → back to the create view of the same entry (unchanged).
- The drawer at 375 px → the amount field, the rows and the footer fit without horizontal scroll.

## Browser checks (web-mut86 preview, port 5183)

- `/app/clients?sample=1`: open a client, press Record Payment on an owed row → title, prefill, "Paid in full", "Today ›", "+ Add note", one primary button; type a smaller amount → "… still owed"; Record → the drawer closes and Owed now drops.
- English and Arabic (RTL), light and dark, and 375 px width.
- Edit a recorded payment from the client's Payments list → "Edit Payment", the record's amount and date, Update works.
