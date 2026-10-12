# MUT-82 — Home: record a payment straight from Needs attention, with Undo: test plan

- **Ticket:** MUT-82 (epic MUT-74) · **Brief:** `landing-apple-redesign.md` decision H1 (approved 2026-10-11) · **Builds on:** MUT-8 (Home, ADR-036), MUT-6 (`RecordPaymentButton`), MUT-86 (the payment drawer, ADR-047), MUT-80 (springs and exit snapshots, ADR-044), MUT-18/MUT-5 (payment records own payment state, ADR-038/ADR-039)
- **Decision record:** ADR-055 · **Debt:** TD-064

## Implementation decisions (H1 is the decision; ADR-055 records the parts that change how Home and the drawer are wired)

| # | Decision |
|---|---|
| D1 | **The button.** Each Needs attention row gets `RecordPaymentButton`, always visible, in its own cell at the row's inline end. On Home it is `compact`: the visible label is "Record Payment" alone, because the amount cell beside it already shows what is left (the brief's craft note on "Record Payment₪3,550"). Its accessible name still carries the amount: "Record Payment — Remaining: ₪3,550". The button stops the click from reaching the row (unchanged). |
| D2 | **The row's own action is keyboard reachable.** The client and title cell becomes a link to the client (the Clients index pattern: a real `<Link>` that stops propagation, the `<tr>` keeps its mouse click), or a button that opens the entry when it has no client. The link and the Record payment button are sibling cells: nothing interactive is nested in anything interactive. Clicking anywhere else on the row still opens the client (ADR-036 §1). |
| D3 | **The drawer opens in place** through `openPartialPaymentDrawer`, so it is the same drawer with the same defaults: the remaining amount and today (ADR-047). |
| D4 | **The drawer reports what it recorded.** `openPartialPaymentDrawer({ transactionId, onRecorded })` carries an optional callback in the store; `AppShell` passes it to `PartialPaymentDrawer`, which calls it with the created `PaymentRecord` after the save and before it closes. Update and delete never call it. Editing a record and returning to the entry (same transaction) keeps the callback; opening another entry drops it. |
| D5 | **Owed now and the rows change in the same frame.** Needs attention is now selected from the same receivables query Owed now reads (`useReceivables({ profileId })`), so one refetch updates both in one render. The selection rule moves into a pure `selectAttentionReceivables(transactions, today)` (`src/lib/attention.ts`), and `transactionRepo.getAttentionReceivables` calls it, so the rule has one definition. The list's content and order are unchanged: overdue or due within 7 days, oldest due first, ties by client name then id. |
| D6 | **The row slides out.** Only a row that a payment from Home settled. When it leaves the list, an inert, `aria-hidden` copy of its last frame (the ADR-044 pattern: the state change is immediate, the exit is presentation) is laid over where it was and slides toward the inline end while it fades, on the drawers' spring (response 0.3, damping 1). The rows after it glide up into the gap on the same spring. Reduced motion: the copy fades out in 150 ms and nothing moves. No layout (jsdom) means no motion. The copy is laid over the section, not inserted into the table, so the last row still slides out while "No overdue or upcoming receivables" appears. `src/lib/motion/rowExit.ts`. |
| D7 | **A partial payment keeps the row.** Its amount, its button's accessible name and Owed now update together (D5). No highlight: that is MUT-81's shared after-save mechanism. |
| D8 | **Undo.** After a save from Home, a toast says what was recorded ("Recorded ₪3,550 from Acme Studio") with Undo. Undo deletes that record through `useDeletePaymentRecord` → `paymentRecordRepo.delete`, which recalculates the entry from the records left (ADR-038, ADR-039), so status, remaining and paidAt return to what they were. If the delete fails, an error toast says the payment is still recorded. `src/hooks/usePaymentUndo.ts`. |
| D9 | **One Undo at a time.** The toast store gains an optional `group`: a new toast replaces the one showing in its group. A second save while an Undo is showing replaces it; the earlier payment stays recorded. |
| D10 | **Undo survives navigation.** The toast lives in the app-wide container and its action only needs the record's id, so after leaving Home it still deletes the record, and every list refreshes through the usual invalidation. It does not depend on Home being mounted. |
| D11 | **A toast with an action waits while you are on it.** The container pauses a toast's timer while the pointer is over it or focus is inside it, and resumes with the time that was left. Without this a keyboard user tabbing to Undo can lose it on the way. |
| D12 | **Focus.** A payment that settles a row moves focus to the next row's Record payment button (else the previous row's, else the Needs attention heading) as soon as it is recorded, before the drawer closes; waiting for the row to leave depended on whether the drawer or the refetch came first (found in the browser). A row that still holds focus when it leaves hands it on the same way. After Undo, when focus was lost with the toast, it goes to the restored row's button. |
| D13 | **Styles** live in a co-located `HomeNeedsAttention.css` with the `home-attention-` prefix and logical properties. The section clips its content (`overflow: hidden`) so a sliding row never crosses into Recent payments. |
| D14 | *(found in the browser)* Below 400 px of card width (a phone, or two columns on a small window) the client column collapsed to one letter. A container query on the section moves the button to its own line under the client and the amount. |
| D15 | *(found in the browser)* A payment drawer opened while another drawer's exit snapshot was still in the page submitted the snapshot's form: both had `id="partial-payment-form"`, and the footer button finds its form by id. `exitSnapshot` now strips ids from its clones, as `rowExit` does. |
| D16 | *(found in the browser)* The row copy's first cell collapsed in a one-row table (`.home-row-main { max-width: 0 }`); copied cells are pinned with `min-width` and `max-width` too. |

## Rules under test

| # | Rule | Level |
|---|---|---|
| T1 | `selectAttentionReceivables`: keeps overdue and due within 7 days (today and day 7 included); drops due on day 8, undated, paid and expense rows; sorts by due date, then client name, then id; does not mutate its input | unit |
| T2 | `transactionRepo.getAttentionReceivables` still returns the same rows in the same order (existing `transactionRepo.test.ts` cases) | unit |
| T3 | Toast store `group`: a toast with a group replaces the toast showing in that group; other groups and ungrouped toasts stack | unit |
| T4 | `ToastContainer`: a toast goes after its duration; hovering or focusing it pauses the timer, leaving resumes with the remaining time; pressing the action runs it once and removes the toast | component |
| T5 | `RecordPaymentButton` `compact`: the visible text is the label alone; the accessible name still has the remaining amount | component |
| T6 | Drawer store: `onRecorded` travels with `openPartialPaymentDrawer`; close clears it; `editPaymentRecord` keeps it for the same transaction and drops it for another | unit |
| T7 | `PartialPaymentDrawer`: after Record, `onRecorded` receives the created record, then the drawer closes; Update never calls it; returning to the entry after an edit passes it along | component |
| T8 | `rowExit`: without layout nothing is captured; with layout the copy is inert, `aria-hidden`, placed over the row, slides toward the inline end (positive x in LTR, negative in RTL) while fading, and is removed at rest; the rows after it start one row height down and come to rest with no inline transform; reduced motion fades the copy with no translate and leaves the other rows alone; a container that has left the document plays nothing | component |
| T9 | Undo is exact (real repository): status, remaining and paidAt after Undo equal their values before the payment, for (a) an unpaid entry paid in full, (b) a part-paid entry (a dated earlier record) paid in full, (c) a second partial payment on a part-paid entry | integration |
| T10 | `usePaymentUndo`: the toast names the amount and client; a second payment replaces the first Undo and the first payment stays; Undo still deletes after the hook's component unmounts; a failed delete shows the error toast | integration |
| T11 | Home, full payment: Record payment on a row opens the drawer prefilled with the remaining amount; Record → the drawer closes, the row leaves, Owed now drops to the new total, and the Undo toast shows | integration |
| T12 | Home, same frame: at no DOM commit is the paid row gone while Owed now still shows the old total, or the reverse (a `MutationObserver` checks every batch) | integration |
| T13 | Home, partial payment: the row stays with the new remaining amount and button name; Owed now shows the new total | integration |
| T14 | Home, Undo: the row comes back with its old amount, Owed now returns, and focus lands on the restored row's button | integration |
| T15 | Home, keyboard: the button is reachable with Tab, its name is "Record Payment — Remaining: …", Enter opens the drawer and does not navigate; the client link opens the client; a click elsewhere on the row opens the client; a no-client row's button opens the entry | integration |
| T16 | Home, focus after a full payment: focus moves to the next row's Record payment button | integration |
| T17 | Home reads one receivables query: `useReceivables({ profileId: 'p1' })` feeds both Owed now and Needs attention; `useAttentionReceivables` is not called (`OverviewPage.test.tsx`) | component |
| T18 | i18n: `overview.paymentRecorded`, `overview.paymentRecordedNoClient` and `overview.undoFailed` are non-empty in en and ar, with `{amount}` (and `{client}`) kept | unit |
| T19 | Browser: from Home, Record payment → Record → the row slides out (its copy moves toward the inline end and is removed), Owed now updates, focus moves to the next row; Undo → the row and Owed now come back | qa: `web.home.attention-pay-full` |
| T20 | Browser: a partial payment from Home keeps the row with the new remaining amount | qa: `web.home.attention-pay-partial` |
| T21 | Browser, reduced motion: the copy only fades (no translate); Arabic: it slides left | qa: `web.home.attention-pay-reduced-motion`, `web.home.attention-pay-rtl` |
| T22 | Axe on Home with a Needs attention row showing its button: only the known `color-contrast` (`home` surface) | qa: a step of `web.home.attention-pay-full` |

## Edge cases

- Arabic UI: the row and its copy slide toward the left (inline end); the amount in the toast stays whole (FSI/PDI isolates).
- The last row paid: the copy slides out over the empty state.
- Navigating away mid-slide: the copy goes with the section; nothing throws.
- Profile switch or any removal that a Home payment did not cause: no slide.
- An entry with a received amount but no payment record (sample data, TD-063 / MUT-60): the save itself already drops the uncovered part, so Undo restores the record-derived state, not the seeded number. Logged in TD-064.
- 375 px: the row keeps the client, the amount and the button on one line, with the client ellipsised.

## Run status

At the owner's request, lint, typecheck and tests are not part of this lane's finish; they run once on main after every lane has merged. Before that instruction, before merging main: vitest 198 files, 3,006 passed, 4 skipped; typecheck clean; lint 0 errors; T19–T22 (then in `e2e/`) 5/5. T19–T22 were dropped when main retired `e2e/` (MUT-97); on 2026-10-12 they were recovered from checkpoint `660ba96` and ported to `qa/specs/web/home.spec.ts`, where all four features pass. Not re-run since: D15's fix and the merge of main. The full browser suite and `test:bundles` were never run on this branch. See `.claude/TEST_PLAN.md` § MUT-82.
