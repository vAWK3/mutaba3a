# MUT-169 — Edit a payment's date from the ledger and the entry

Status: plan (eng-ticket, 2026-10-14). Not built.
Ticket: https://barmajiyat.atlassian.net/browse/MUT-169 · blocked by MUT-60 (merged `61aa801`, released in web v0.1.4, so the block is cleared)

## Problem

Fast-added Received income is dated **now**. `IncomeDrawer` calls `createReceivedMutation.mutateAsync({ …, paidAt: nowISO() })`, and since MUT-60 that writes a `PaymentRecord`. Users reconcile hours or days later from the `/income` ledger, and the only way to fix a payment's date is through the client profile's Payments section (`ClientPaymentsSection` → `editPaymentRecord`).

There are two gaps in today's code:

| Surface | Today |
|---|---|
| `/income` row, **fully paid** | `RecordPaymentButton` hides itself (`paymentStatus === 'paid'`). The kebab has only Duplicate. **There is no way to reach the payment drawer.** |
| `/income` row, **part-paid** | You can reach it, but only by accident: Record payment → scroll to history → pencil. The create form is focused first, so Enter records a *second* payment. |
| `IncomeDrawer` edit of a record-backed entry | The status is locked, and the hint says *"Manage payments from the client page."* The hint sits inside "More details", which a fast-added entry keeps **collapsed** (`shouldExpandDetails` doesn't trigger on paid state). |

`/transactions` is a legacy redirect to `/income` (`router.tsx:68`), so "Transactions ledger" in the ticket means `IncomePage`.

## What already exists (reuse, no new logic)

- `paymentRecordRepo.update` (`db/repository.ts`) rejects a future `paidAt` (MUT-18/ADR-038). It then runs `recalculateReceivedAmount`, which re-derives `status`, `receivedAmountMinor` and `paidAt` (the latest record) inside one Dexie transaction. This covers AC3 and AC5 with no changes.
- `PartialPaymentDrawer` edit mode (`editingPaymentRecordId`), `PaymentForm` with a date-only `<input type="date">`, and `PaymentRecordRow` with edit and delete. This covers the "which payment" picker (ticket scope bullet 2).
- `useSavedFlashStore.markSaved({ ids: [recordId, txId] })`, so the ledger row flashes after an edit.
- i18n: `transactions.partialPayment.editPayment` ("Edit Payment" / "تعديل الدفعة"), `…history`, `…noPayments`.

## Design

### D1 — One new drawer intent, resolved inside the drawer

Add `intent?: 'editPayment'` to `partialPaymentDrawer` in `lib/stores.ts`:

- `openPartialPaymentDrawer({ transactionId, onRecorded?, intent? })` stores it.
- `editPaymentRecord` keeps `intent` when it's the same `transactionId`, the same rule it already uses for `onRecorded`.
- `closePartialPaymentDrawer` clears it.

Callers don't know the record ids, and fetching records at each call site would duplicate what the drawer already loads (`usePaymentRecords`). So the drawer resolves the intent itself, as **derived state with no effect**:

```
waitingForRecord = (editingRecordId || intent === 'editPayment') && recordsLoading   // never flash a create form
autoRecord       = intent === 'editPayment' && !editingRecordId && records.length === 1 ? records[0] : undefined
editingRecord    = explicit match ?? autoRecord
pickerMode       = intent === 'editPayment' && !editingRecord          // 0 or ≥2 records
```

- **1 record** (the usual fast-add case): the drawer opens straight into edit mode, prefilled. That is AC2.
- **≥2 records** (part-paid): picker mode. There is **no create form**, just the existing history list, each row with its pencil. The title is "Edit Payment" and the footer has Close only.
- **0 records** (only sample data, TD-063/MUT-95): picker mode shows `noPayments`. It never falls back to a create form, because the user asked to edit, not to record.
- **Records failed to load** (eng review R6): under the intent, a failed query shows the existing `paymentsLoadFailed` notice with Retry (`refetch`), never the empty state.

### D2 — What happens after save or cancel under the intent

- Today, without the intent, `returnToEntry()` reopens the create view.
- With the intent and a single record: Save runs `markSaved` and then `onClose()`, and Cancel runs `onClose()`. The job is done, so the drawer doesn't bounce back to Record payment.
- With the intent and ≥2 records: Save and Cancel go back to the picker (`openPartialPaymentDrawer({ transactionId, intent })`), so the user can fix the next date.
- A delete from the picker uses the existing behaviour. If it leaves one record, the derived `autoRecord` opens that record's edit form. That's acceptable and needs no extra state.

### D3 — Focus the date, not the amount, under the intent

`PaymentForm` gets `focusDate?: boolean`. When it's set, `dateOpen` starts true and the date input takes focus instead of amount-select. The user came to change the date, and focusing a selected amount invites an accidental overwrite.

### D4 — Ledger row action (`/income`)

- `incomeRows.ts`: `IncomeRow.canEditPayment = (tx.receivedAmountMinor ?? 0) > 0` (income only). It's pure and unit-tested next to `canMarkPaid`.
- `IncomePage.rowActions`: when `row.canEditPayment`, add `{ label: t('transactions.partialPayment.editPayment'), onClick: () => openPartialPaymentDrawer({ transactionId: row.id, intent: 'editPayment' }) }`.
- Covers fully-paid and part-paid rows (AC1 and AC4). The Mark paid and Record payment buttons are unchanged.

### D5 — The IncomeDrawer entry point (fast path, not More details)

When `mode === 'edit' && hasRecords`, render one line under the Client field:

- *"Last payment {date}"* (the latest record's `paidAt`) and a text button labelled "Edit Payment".
- The button calls `closeIncomeDrawer()` and then `openPartialPaymentDrawer({ transactionId, intent: 'editPayment' })`.
- New key `drawer.income.lastPayment`: "Last payment {date}" / "آخر دفعة {date}".
- **Copy fix:** `drawer.income.paymentsRecordedHint` drops *"Manage payments from the client page."* (en and ar). It now points to the wrong place.
- **Unsaved edits:** drawers have no dirty guard anywhere (checked `Drawer`/`DrawerFrame`), so switching drawers would silently drop typed changes. Proposed: while `form.formState.isDirty`, the button is disabled with `aria-describedby` on a short hint, `drawer.income.saveBeforePayment` ("Save your changes to edit the payment" / "احفظ تغييراتك لتعديل الدفعة"). **Resolved in eng review (R2/D2): disable + hint.**

### D6 — Prefill the edit form with the payment's local day (eng review R1, approved)

`PaymentForm` prefills `editingRecord.paidAt.split('T')[0]`, the UTC date. A Received fast-add stores `nowISO()`, so between local midnight and ~3am in Israel the form opens one day before the row the user clicked, and any save writes that earlier day. A new `lib/dates.ts` helper returns the local calendar date of a timestamped `paidAt` (date-only strings pass through) and the prefill uses it. Tested under a UTC+ timezone.

### D7 — Date-only payment dates render as their local day (eng review R5, approved: build now)

Every edit saves `paidAt` date-only, and `formatDate(new Date('2026-10-13'))` reads that as UTC midnight, so west of UTC the payment lists show the day before. The `lib/dates.ts` helper from D6 gains its display twin: parse a date-only `paidAt` as local midnight (`${paidAt}T00:00:00`), an instant as itself. `PaymentRecordRow` (`PartialPaymentDrawer.tsx:571`), `ClientPaymentsSection` and the new IncomeDrawer "Last payment" line use it. Unit-tested under a west-of-UTC timezone.

### Out of scope (and why)

- **Home → Recent payments.** Its rows go to the client page, or to `IncomeDrawer` when there's no client. They don't route through this drawer, so the ticket's "if they already route through the same drawer" doesn't apply. The no-client path picks up D5 for free.
- **`ClientWorkSection`, `ProjectDetailPage`.** Not named in the ticket.
- **Expenses.** Already editable through `ExpenseDrawer.occurredAt`.
- **Time of day and bulk editing.** Out of scope per the ticket.
- **The hosted portal (`src/hosted`).** It's a separate, read-only payments view with no payment-record writes. This is local/desktop/web only.
- **MUT-85** (one payment covering several entries) will change what "a record of this entry" means. The D1 picker works per transaction and stays valid until then.

## Files

| File | Change |
|---|---|
| `src/lib/stores.ts` | Add the `intent` field and keep it in `open…`, `editPaymentRecord` and `close…` |
| `src/components/drawers/PartialPaymentDrawer.tsx` | Derived `autoRecord`/`pickerMode`, extend `waitingForRecord`, intent-aware save and cancel, `focusDate` on `PaymentForm` |
| `src/components/layout/AppShell.tsx` | None: the drawer reads `intent` from the store, as it does `editingPaymentRecordId` |
| `src/pages/income/incomeRows.ts` | `canEditPayment` |
| `src/pages/income/IncomePage.tsx` | Kebab action |
| `src/components/drawers/IncomeDrawer.tsx` | Fast-path "Last payment · Edit Payment" line and the dirty guard |
| `src/lib/i18n/translations/{en,ar}.json` | `drawer.income.lastPayment`, `drawer.income.saveBeforePayment`, edited `paymentsRecordedHint` |
| `src/lib/dates.ts` | Local-day helpers for a payment date: edit prefill (D6) and display parse (D7) |
| `src/components/clients/ClientPaymentsSection.tsx` | Render `paidAt` through the D7 parse |
| `.claude/{CHANGELOG,COMPONENT_REGISTRY,TEST_PLAN}.md` | Document the `PartialPaymentDrawer` intent and new coverage |

There are no schema, migration or repository changes, and no new queries. The drawer reuses the `usePaymentRecords` cache that the IncomeDrawer has already warmed.

## Tests (TDD, written first)

1. `pages/income/__tests__/incomeRows.test.ts`: `canEditPayment` is true for paid and part-paid rows, false for unpaid with 0 received, and false with `receivedAmountMinor` undefined.
2. `lib/__tests__/stores.test.ts`:
   - `intent` is stored.
   - `editPaymentRecord` keeps it for the same transaction and drops it for another.
   - `close` clears it.
3. `components/drawers/__tests__/PartialPaymentDrawer.test.tsx`:
   - Intent with 1 record: the edit form is prefilled with that record's date and amount, the title is "Edit Payment", and there's no Record button.
   - Intent with 2 records: no amount field, two history rows; the pencil calls `editPaymentRecord`.
   - Intent with 0 records: shows `noPayments` and Close.
   - Intent while loading: spinner, and no form ever mounted.
   - Intent with a failed records query (R6): the load-failed notice and Retry show, "No payments recorded yet" doesn't, and Retry calls `refetch`.
   - Intent with 1 record and Save: `updateMutation` gets the new `paidAt`, then `markSaved` and `onClose` run (no `openPartialPaymentDrawer` call).
   - Intent with 2 records and Save: the drawer returns to the picker.
   - A future date under the intent shows the existing error, and the mutation is not called (AC5).
   - Under the intent, the date input has focus.
   - No intent: every existing test passes unchanged (AC6 guard).
4. `pages/income/__tests__/IncomePage.test.tsx`: a paid row's kebab has "Edit Payment", which opens with `intent: 'editPayment'`. A part-paid row has it too. An unpaid row doesn't.
5. `components/drawers/__tests__/IncomeDrawer.paymentLink.test.tsx` (new):
   - A record-backed edit shows "Last payment {date}" and the button, which closes IncomeDrawer and opens the payment drawer with the intent.
   - The line is absent in create mode and with no records.
   - The button is disabled while the form is dirty.
6. Repository (eng review R4): extend `src/db/__tests__/paymentRecords.test.ts` "should update date without changing amount": the fully-paid entry's `paidAt` follows the moved record, `status` stays `paid`, `receivedAmountMinor` unchanged (AC3). Add a part-paid case: 2 records, move one date, entry stays `unpaid` with the same received total and no `paidAt` (AC4).
6a. `src/lib/__tests__/dates.test.ts` (eng review R1): under `TZ=Asia/Jerusalem`, the new local-date helper maps `2026-10-13T22:30:00.000Z` to `2026-10-14`; a date-only `2026-10-13` passes through. Drawer test: a record with that timestamp prefills `2026-10-14`.
6c. `src/lib/__tests__/dates.test.ts` (eng review R5): under a west-of-UTC timezone, the display parse renders date-only `2026-10-13` as Oct 13; `PaymentRecordRow` and `ClientPaymentsSection` show that day.
6b. Drawer and IncomeDrawer additions (eng review R2/R3): under the intent the date input has focus (without it, the amount does); the IncomeDrawer link is disabled with the hint while the form is dirty.
7. Regression: the `ClientPaymentsSection` and `ClientDetailPage` suites pass unchanged (AC6).
8. Browser QA: in `qa/specs/web/record-payment.spec.ts`, add `web.income.edit-payment-date` and its `-rtl` variant.

Verification (Node 22, TD-054): `npm run lint && npm run typecheck && npm run test:run && npm run build`.

## Acceptance criteria → proof

| AC | Proven by |
|---|---|
| A paid or part-paid ledger row offers the edit | Tests 1 and 4 |
| Opens `PartialPaymentDrawer` edit mode with the correct record | Test 3 (1 record → prefilled; ≥2 → picker → pencil) |
| Saving updates `paidAt` and recalculates status and received | Test 6 (extended repository test, R4) |
| Works for full and part-paid entries | Tests 3, 4 and 6 |
| A future `paidAt` is rejected | Test 3 (UI) and the existing repository test |
| No regression to the client-profile path | Tests 3 ("no intent") and 7 |

## Open questions for review

- ~~**Q1.**~~ Resolved (R2): disable + hint.
- ~~**Q2.**~~ Resolved (R3): ship `focusDate`.

---

# Eng review (/plan-eng-review, 2026-10-14)

Target: `.claude/designs/mut-169-edit-payment-from-ledger.md` (this file; the plan above is the original, unchanged).
Scope Challenge: 7 product files, 0 new classes/services (complexity gate not tripped). No scope findings. Factual correction: the ticket's "Transactions ledger" is `/income` (`router.tsx:68` redirects `/transactions`). Result: scope accepted as-is.

## Decision ledger

### R1: Edit-form date prefill for a timestamped paidAt
Finding: F1, P2, confidence 9/10, `src/components/drawers/PartialPaymentDrawer.tsx:319`, reviewer: Claude (plan-eng-review, Architecture)
Plan baseline: original proposal reuses `PaymentForm` unchanged; prefill is `editingRecord.paidAt.split('T')[0]`
Runtime evidence: Received fast-add writes `paidAt: nowISO()` (`IncomeDrawer.tsx:307`), a UTC instant. Probe under TZ=Asia/Jerusalem for `2026-10-13T22:30:00.000Z`: split gives `2026-10-13`, local calendar date is `2026-10-14`. Ledger/history rows render with `formatDate(new Date(iso))` (local), so the list says Oct 14 while the form says Oct 13; saving any edit writes Oct 13. Window: local 00:00 to 02:00/03:00 in Israel, every day.
Comparison grid:
| Choice | Current | A) Local date | B) Keep split |
|---|---|---|---|
| R1 prefill of a timestamped paidAt | UTC date (`split('T')[0]`) | local calendar date via a `lib/dates.ts` helper (`formatLocalDate(new Date(paidAt))` when it has a time, else unchanged) + unit test under a UTC+ TZ | UTC date, unchanged |
| R2 IncomeDrawer dirty-edit guard | pending | pending | pending |
| R3 focus the date under the edit intent | pending | pending | pending |
Question D1:
D1 — Prefill the payment date in the user's local day, not UTC
Project/branch/task: mini-crm main, MUT-169 plan (edit a payment's date from the /income ledger).
ELI10: A fast-added "Received" payment is saved with the exact UTC moment. The edit form cuts that moment down to its UTC date, but every list shows the local date. Between midnight and about 3am in Israel, the form opens one day earlier than the row the user clicked, and pressing Update (even to fix only the amount) silently moves the payment back a day. MUT-169 makes this form the main way to fix dates, so it hits exactly the users this ticket is for.
Stakes if we pick wrong: a reconciliation tool that quietly writes the wrong date, the bug the ticket exists to fix.
Recommendation: A because it is a three-line helper plus one test, and it makes the prefill match what the user sees.
Completeness: A=10/10, B=6/10
Pros / cons:
A) Local date (recommended)
  ✅ The form opens on the same day the ledger and history rows show, in every timezone
  ✅ One small `lib/dates.ts` helper next to `isFuturePaymentDate`, unit-tested under a UTC+ TZ
  ❌ Touches the shared PaymentForm, so the client-profile edit path changes too (intended fix)
B) Keep split
  ✅ No change to PaymentForm; the client-profile path stays byte-for-byte as today
  ✅ Zero extra work in this ticket (human: 0 / CC: 0)
  ❌ Late-night fast-adds open a day early and an innocent save shifts the payment date back
Net: three lines and a test buy a date prefill users can trust, on the exact path this ticket opens up.
Header: Date prefill
Options:
A) Local date (recommended)
Prefill with the local calendar date of a timestamped paidAt via a small lib/dates.ts helper, unit-tested under a UTC+ timezone. Also fixes the client-profile edit path. Human ~30min / CC ~5min. Low risk.
B) Keep split
Keep paidAt.split('T')[0]. No code change; late-night fast-adds keep opening a day early and a save shifts them back. Zero effort.

State: approved
Actual answer: A) Local date (D1, AskUserQuestion answer 2026-10-14)
Accepted scope: Add a `lib/dates.ts` helper that returns a paidAt's local calendar date (`formatLocalDate(new Date(paidAt))` when it carries a time; the string unchanged when date-only), use it for `PaymentForm`'s edit prefill (`PartialPaymentDrawer.tsx:319`), and unit-test it under a UTC+ timezone (late-night instant → next local day; date-only passthrough). Applies to the client-profile edit path too (intended fix).
History: none

### R2: IncomeDrawer "Edit Payment" link while the form has unsaved edits
Finding: F2, P2, confidence 9/10, plan D5 (`src/components/drawers/IncomeDrawer.tsx`, proposed fast-path line), reviewer: Claude (plan-eng-review, Architecture); the plan's open question Q1
Plan baseline: original proposal: disable the button while `form.formState.isDirty`, with a hint (`drawer.income.saveBeforePayment`); marked open for review
Runtime evidence: no drawer has a dirty guard (`src/components/drawers/Drawer.tsx` wraps `DrawerFrame` with title/onClose/children/footer only); IncomeDrawer and PartialPaymentDrawer are separate overlays in `AppShell.tsx`, so the link must close IncomeDrawer, which unmounts its react-hook-form state
Comparison grid:
| Choice | Current | A) Disable + hint | B) Switch anyway |
|---|---|---|---|
| R1 prefill of a timestamped paidAt | approved: local date (D1) | approved: local date (D1) | approved: local date (D1) |
| R2 link while the form is dirty | pending (plan proposes disable) | disabled + `aria-describedby` hint "Save your changes to edit the payment" (new en/ar key) + test | always enabled; switching drops typed edits; no new key |
| R3 focus the date under the edit intent | pending | pending | pending |
Question D2:
D2 — What the IncomeDrawer's "Edit Payment" link does when the form has unsaved edits
Project/branch/task: mini-crm main, MUT-169 plan (edit a payment's date from the /income ledger).
ELI10: When you reopen a paid entry, the drawer will show "Last payment {date} · Edit Payment". Clicking it closes this drawer and opens the payment drawer. If you had already typed changes (a new title, a different amount), closing throws them away with no warning, because no drawer in the app asks "discard changes?". We can grey the link out until you save, or let it switch and lose the typing.
Stakes if we pick wrong: a user fixes a title, clicks Edit Payment, fixes the date, and later finds the title change gone.
Recommendation: A because it costs one short string and one test, and it never loses typed work.
Completeness: A=10/10, B=7/10
Pros / cons:
A) Disable + hint (recommended)
  ✅ Typed edits can never be lost through this link; the hint says exactly what to do next
  ✅ Small: one en/ar string pair and one test for the disabled state (human ~45min / CC ~5min)
  ❌ One extra click for a user who changed something: Save first, then reopen and edit the payment
B) Switch anyway
  ✅ Matches every other drawer today, which closes without asking about unsaved changes
  ✅ No new string and no disabled state to explain (human ~0 / CC ~0)
  ❌ Unsaved title or amount edits vanish silently the moment the link is clicked
Net: a greyed-out link with one sentence of help versus a silent data loss on an uncommon path.
Header: Unsaved edits
Options:
A) Disable + hint (recommended)
Disable the link while the IncomeDrawer form is dirty, with an aria-describedby hint "Save your changes to edit the payment" (new en/ar key) and a test. Human ~45min / CC ~5min. No data loss.
B) Switch anyway
Keep the link always enabled; clicking closes IncomeDrawer and drops unsaved edits, like every drawer today. No new string. Silent loss of typed changes.

State: approved
Actual answer: A) Disable + hint (D2, AskUserQuestion answer 2026-10-14)
Accepted scope: While the IncomeDrawer form is dirty (`form.formState.isDirty`), the fast-path "Edit Payment" link is disabled and `aria-describedby` points at a hint, new key `drawer.income.saveBeforePayment` ("Save your changes to edit the payment" / "احفظ تغييراتك لتعديل الدفعة"); a test covers the disabled state and the hint.
History: none

Note (Code quality, F3, P3, confidence 8/10, no behaviour change, no question): plan D2's intent branching (single record → close; ≥2 → picker) would otherwise be written three times (`handleUpdated`, the edit-mode Cancel button, `returnToEntry` in `PartialPaymentDrawer.tsx`). Build routes all three through one `leaveEdit()` in the drawer.

### R3: Focus the date, not the amount, when the drawer opens under the edit intent
Finding: F4, P3, confidence 8/10, plan D3 (`src/components/drawers/PartialPaymentDrawer.tsx:328-331`, the mount effect `amountRef.current?.focus(); amountRef.current?.select();`), reviewer: Claude (plan-eng-review, Code quality); the plan's open question Q2
Plan baseline: original proposal D3: `PaymentForm` gets `focusDate?: boolean`; under the intent the date field starts open and takes focus; marked open for review (scope creep?)
Runtime evidence: today every PaymentForm mount focuses and selects the amount (`PartialPaymentDrawer.tsx:328-331`), and the date sits behind a "Today ›"/date pill (`dateOpen` starts false, line 321)
Comparison grid:
| Choice | Current | A) Focus date | B) Keep amount focus |
|---|---|---|---|
| R1 prefill of a timestamped paidAt | approved: local date (D1) | approved: local date (D1) | approved: local date (D1) |
| R2 link while the form is dirty | approved: disable + hint (D2) | approved: disable + hint (D2) | approved: disable + hint (D2) |
| R3 initial focus under the edit intent | amount focused + selected, date collapsed | `focusDate` prop: date input open and focused; amount not selected; without the intent unchanged; one drawer test | unchanged: amount focused + selected; user clicks the date pill |
Question D3:
D3 — When "Edit Payment" opens from the ledger, put the cursor in the date
Project/branch/task: mini-crm main, MUT-169 plan (edit a payment's date from the /income ledger).
ELI10: The payment form always opens with the amount selected, ready to be typed over, and the date hidden behind a small "Oct 14 ›" button. From the ledger the user came to change the date, so they must click that button first, and a stray keystroke on the selected amount changes the amount instead. We can open the date field and focus it when the drawer was opened to edit a payment.
Stakes if we pick wrong: either one extra click on the main reconciling path, or a small prop that the ticket did not ask for.
Recommendation: A because it is the job the user came to do, and it costs one prop and one test.
Completeness: A=10/10, B=8/10
Pros / cons:
A) Focus date (recommended)
  ✅ One step shorter: the date field is open and focused, so typing or picking fixes the date at once
  ✅ The selected amount can no longer be overwritten by a stray keystroke on this path
  ❌ A new `focusDate` prop on PaymentForm plus one test (human ~30min / CC ~5min)
B) Keep amount focus
  ✅ No PaymentForm change; edit mode behaves the same from every entry point
  ✅ Strictly what the ticket asks, nothing more (human 0 / CC 0)
  ❌ Every ledger date fix costs a click on the date pill, with the amount selected under the cursor
Net: one prop buys a ledger fix that starts on the field the user is there to change.
Header: Date focus
Options:
A) Focus date (recommended)
Add focusDate to PaymentForm: under the edit intent the date input starts open and focused and the amount is not selected; other entry points unchanged; one drawer test. Human ~30min / CC ~5min.
B) Keep amount focus
No PaymentForm change: the amount stays focused and selected and the user clicks the date pill first. Matches the ticket's minimum. Zero effort.

State: approved
Actual answer: A) Focus date (D3, AskUserQuestion answer 2026-10-14)
Accepted scope: `PaymentForm` gets `focusDate?: boolean`, passed only under the edit intent: the date input starts open and focused and the amount is not selected; every other entry point keeps amount focus + select; one drawer test asserts the date input has focus under the intent and the amount has it without.
History: none

### R4: How to prove AC3/AC4 (recalculation after a date edit)
Finding: F5, P3, confidence 9/10, plan Tests item 6 (new real-Dexie integration file), reviewer: Claude (plan-eng-review, Tests)
Plan baseline: original proposal Tests item 6: a new real-Dexie integration test (fast-add Received, edit record date, assert tx paidAt/status/received; part-paid 2 records, edit one date)
Runtime evidence: the save path is the existing `paymentRecordRepo.update` → `recalculateReceivedAmount`, already exercised in `src/db/__tests__/paymentRecords.test.ts:222` ("should update date without changing amount": asserts the record only, not the transaction) and `src/db/__tests__/partialPayment.test.ts:135` (tx paidAt = latest record date, create path). MUT-169 adds no repository code, so a new integration file re-tests existing code through mocks-free plumbing the drawer tests already mock at the hook boundary.
Comparison grid:
| Choice | Current | A) Extend repo test | B) New integration file |
|---|---|---|---|
| R1 prefill of a timestamped paidAt | approved: local date (D1) | approved: local date (D1) | approved: local date (D1) |
| R2 link while the form is dirty | approved: disable + hint (D2) | approved: disable + hint (D2) | approved: disable + hint (D2) |
| R3 initial focus under the edit intent | approved: focus date (D3) | approved: focus date (D3) | approved: focus date (D3) |
| R4 proof of AC3/AC4 recalculation | plan item 6: new Dexie integration file | extend `paymentRecords.test.ts` update-date case: fully-paid tx gets the new `paidAt`, stays `paid`, same `receivedAmountMinor`; add a part-paid row (2 records, move one date: stays `unpaid`, same received, `paidAt` undefined); drop plan item 6 | keep plan item 6 as a new file in addition to existing repo tests |
Question D4:
D4 — Prove "saving a new date recalculates the entry" by extending the existing repository test
Project/branch/task: mini-crm main, MUT-169 plan (edit a payment's date from the /income ledger).
ELI10: The plan proposed a brand-new database test to prove that moving a payment's date updates the entry (its paid date, status and received total). The code that does that already exists and already has a test file, but that test only checks the payment itself, not the entry. Adding the missing entry checks to that test proves the same thing in one place, instead of a second file testing the same code path again.
Stakes if we pick wrong: either a duplicate test file to maintain, or (if neither) AC3 stays unproven at the data layer.
Recommendation: A because it closes the exact gap (entry fields after a date update) where the code lives, with no duplicate file.
Completeness: A=10/10, B=9/10
Pros / cons:
A) Extend repo test (recommended)
  ✅ Closes the real gap: today's update-date test never checks the entry's paidAt, status or received total
  ✅ One place to look for recalculation behaviour; no second file re-testing the same repository code
  ❌ The drawer-to-database wiring is proven by the drawer unit test plus the browser QA spec, not one integration test
B) New integration file
  ✅ One test walks the whole save from a Received fast-add to the recalculated entry in real Dexie
  ✅ Matches the plan as written, no re-planning (human ~1.5h / CC ~10min)
  ❌ Duplicates repository coverage and still leaves the existing update-date test blind to the entry fields
Net: put the missing assertions where the recalculation code is tested, instead of a parallel file.
Header: AC3 proof
Options:
A) Extend repo test (recommended)
Extend paymentRecords.test.ts: after a date update, assert the fully-paid entry's paidAt/status/received; add a part-paid two-record case. Drop the plan's new integration file. Human ~45min / CC ~5min.
B) New integration file
Keep the plan's new real-Dexie integration test file for the whole save path, alongside the existing repository tests (which stay as they are). Human ~1.5h / CC ~10min.

State: approved
Actual answer: A) Extend repo test (D4, AskUserQuestion answer 2026-10-14)
Accepted scope: Extend `src/db/__tests__/paymentRecords.test.ts` update-date case so a fully-paid entry's `paidAt` follows the moved record, `status` stays `paid`, `receivedAmountMinor` unchanged; add a part-paid case (2 records, move one date: stays `unpaid`, same received, `paidAt` undefined). Plan Tests item 6 (new integration file) is dropped.
History: none

### R5: TODO: date-only paidAt renders a day early west of UTC
Finding: F6, P3, confidence 9/10, `src/components/drawers/PartialPaymentDrawer.tsx:571` (`formatDate(record.paidAt, locale)`) and `src/components/clients/ClientPaymentsSection.tsx` (`formatDate(payment.paidAt, locale)`), via `src/lib/utils.ts:257-258` (`const date = new Date(isoString);`), reviewer: Claude (plan-eng-review, final planning)
Plan baseline: not in the plan; pre-existing, not caused by MUT-169. Every edited record is saved date-only (`YYYY-MM-DD`), so MUT-169 makes more of them.
Runtime evidence: probe `TZ=America/New_York`: `new Date("2026-10-13")` formats as "Oct 12, 2026" (date-only strings parse as UTC midnight). The drawer's own pill already uses `${paidAt}T00:00:00` (local) and is correct. Users today are UTC+ (Israel/Palestine), where it renders correctly.
Comparison grid:
| Choice | Current | A) Add TODO | B) Skip | C) Build now |
|---|---|---|---|---|
| R1–R4 | approved (D1–D4) | unchanged | unchanged | unchanged |
| R5 date-only paidAt display west of UTC | unfixed, untracked | TODOS.md item 13 (What/Why/Context/Effort S/Priority P3/Depends on none) | untracked | fix `formatDate` callers for date-only strings in this PR (scope growth) |
Question D5:
D5 — Track "a date-only payment date shows a day early west of UTC" as a TODO?
Project/branch/task: mini-crm main, MUT-169 plan (edit a payment's date from the /income ledger).
ELI10: When a payment date is saved without a time (which every edit does), the payment lists turn it into a date by treating it as midnight in London. For anyone west of London (the Americas), that shows the day before. Your users are in Israel and Palestine, where it shows correctly, so nothing breaks today, but it is a trap for any user abroad.
Stakes if we pick wrong: a traveller or an overseas user sees every corrected payment one day early; or this PR grows past its ticket.
Recommendation: A because it is real but does not affect today's users, and the fix touches shared date formatting outside this ticket.
Pros / cons:
A) Add TODO (recommended)
  ✅ The trap is written down with the exact lines and the one-line fix, so it is cheap to pick up later
  ✅ MUT-169 stays scoped to the ticket; no shared formatter change in a UI ticket
  ❌ Users west of UTC keep seeing date-only payments one day early until someone picks it up
B) Skip
  ✅ No backlog noise for a case that does not hit any current user
  ✅ Zero effort now (human 0 / CC 0)
  ❌ The bug is forgotten; it resurfaces as a confusing report from the first overseas user
C) Build now
  ✅ Fixed while the code is fresh; every payment list shows the right day everywhere
  ✅ Small change in display code (human ~1h / CC ~10min)
  ❌ Touches shared date formatting used across the app, beyond MUT-169's acceptance criteria
Net: a known, cheap, not-yet-hurting bug: record it rather than widen this ticket.
Note: options differ in kind, not coverage — no completeness score.
Header: TODO: tz date
Options:
A) Add TODO (recommended)
Add TODOS.md item 13 with What/Why/Context (the formatDate lines and the T00:00:00 fix the drawer pill already uses), Effort S, P3, no dependencies.
B) Skip
Do not record it. No TODO entry; the west-of-UTC display stays unfixed and untracked.
C) Build now
Fix date-only paidAt display in this PR's scope (PaymentRecordRow and ClientPaymentsSection, via a local-date parse). Human ~1h / CC ~10min. Grows MUT-169 beyond its ACs.

State: approved
Actual answer: C) Build now (D5, AskUserQuestion answer 2026-10-14)
Accepted scope: In this PR, payment dates saved date-only render as their local calendar day in `PaymentRecordRow` (`PartialPaymentDrawer.tsx:571`) and `ClientPaymentsSection.tsx`, via a local-date parse (`${paidAt}T00:00:00` for date-only strings, the instant otherwise) shared with R1's helper in `lib/dates.ts`; the new IncomeDrawer "Last payment" line uses the same parse. Unit test under a west-of-UTC TZ. No TODOS.md entry.
History: none

Scope record (complexity gate re-run after D5 raised the plan to 9 product files): feature answers: D5 (C, build now); structure: A) Original arrangement (D6, AskUserQuestion answer 2026-10-14); accepted scope: 9 product files (stores.ts, PartialPaymentDrawer.tsx, incomeRows.ts, IncomePage.tsx, IncomeDrawer.tsx, en.json, ar.json, lib/dates.ts, ClientPaymentsSection.tsx), no new classes/services; pending remedies: none.

### R6: Edit intent when the payment records fail to load
Finding: F7, P2, confidence 8/10, plan D1 (`pickerMode` for 0 records) against `src/components/drawers/PartialPaymentDrawer.tsx:57` (`const { data: paymentRecords = [], isLoading: recordsLoading } = usePaymentRecords(transactionId);`), reviewer: Claude (plan-eng-review, Failure modes)
Plan baseline: original proposal D1: under the intent, 0 records → picker shows `noPayments` ("No payments recorded yet") and Close; the query's error state is not mentioned
Runtime evidence: on a failed IndexedDB read the hook's `isLoading` is false and `data` is undefined, so `paymentRecords` defaults to `[]`; the drawer never reads `isError`. IncomeDrawer already handles the same failure (`IncomeDrawer.tsx:123-124` `recordsFailed`, notice + Retry at :470-474, keys `drawer.income.paymentsLoadFailed` / `paymentsRetry`).
Comparison grid:
| Choice | Current | A) Error + retry | B) As planned |
|---|---|---|---|
| R1–R5 | approved (D1–D5, arrangement D6) | unchanged | unchanged | 
| R6 intent + records query error | (proposed) "No payments recorded yet" | under the intent, a failed records query shows the existing `paymentsLoadFailed` notice with a Retry (`refetch`) and no form; reuses existing en/ar keys; one drawer test | unchanged: misleading empty state, no retry |
Question D7:
D7 — Under "Edit Payment", say the payments failed to load (with Retry) instead of "No payments recorded yet"
Project/branch/task: mini-crm main, MUT-169 plan (edit a payment's date from the /income ledger).
ELI10: The new edit view decides what to show from the list of payments it loads from the local database. If that read fails, the list just looks empty, so the drawer would say "No payments recorded yet" on an entry that is clearly paid, with no way to try again. The income drawer already has a message and a Retry button for exactly this failure; we can reuse it here.
Stakes if we pick wrong: on a rare storage error, a user is told a paid entry has no payments and has to close and reopen to recover.
Recommendation: A because it reuses an existing message, strings and pattern, and turns a false statement into a recoverable one.
Completeness: A=10/10, B=6/10
Pros / cons:
A) Error + retry (recommended)
  ✅ The user is told the truth (payments failed to load) and can Retry in place, as in the income drawer
  ✅ Reuses `paymentsLoadFailed` / `paymentsRetry` and the `refetch` pattern; no new strings (human ~30min / CC ~5min)
  ❌ One more branch and one more drawer test in PartialPaymentDrawer
B) As planned
  ✅ No extra branch; the drawer stays as simple as the plan drew it
  ✅ The failure is rare: a local IndexedDB read, not a network call (human 0 / CC 0)
  ❌ On that failure the drawer states something false about a paid entry and offers no recovery
Net: a reused notice and a Retry button versus a rare but misleading empty state.
Header: Load failure
Options:
A) Error + retry (recommended)
Under the edit intent, a failed records query shows the existing paymentsLoadFailed notice with Retry (refetch) and no form; reuse the en/ar keys; add one drawer test. Human ~30min / CC ~5min.
B) As planned
Keep the plan: a failed load reads as zero records and shows "No payments recorded yet" with Close. No extra branch or test.

State: approved
Actual answer: A) Error + retry (D7, AskUserQuestion answer 2026-10-14)
Accepted scope: Under the edit intent, a failed records query (`isError`) shows the existing `drawer.income.paymentsLoadFailed` notice with a `drawer.income.paymentsRetry` button that calls `refetch`, and mounts no form or picker; reuse the existing en/ar keys; one drawer test (intent + query error → notice + Retry, no "No payments recorded yet", Retry calls refetch).
History: none

Approval readiness: PASS. R1 (D1, A), R2 (D2, A), R3 (D3, A), R4 (D4, A), R5 (D5, C), arrangement (D6, A), R6 (D7, A); regression contract AC6 carried from the ticket (existing `PartialPaymentDrawer.test.tsx:562` and `:603` stay green unchanged).

## Review findings by section

**Scope Challenge:** no issues found. Factual correction: the "Transactions ledger" is `/income`. Scope accepted as-is; the D5 build-now answer later grew the plan to 9 product files, and the arrangement was confirmed (D6).

**1. Architecture**
- `[P2] (confidence: 9/10) src/components/drawers/PartialPaymentDrawer.tsx:319`: the edit prefill uses the UTC date of a `nowISO()` fast-add, so late-night entries open a day early. Accepted (D1 → D6).
- `[P2] (confidence: 9/10) src/components/drawers/IncomeDrawer.tsx (plan D5)`: switching drawers drops unsaved edits. Accepted: disable + hint (D2).
- `[P3] (confidence: 8/10)`: from IncomeDrawer, the user lands back on the ledger after the edit. Kept as planned (no remedy).
Dispositions: F1 accepted D1; F2 accepted D2.

**2. Code quality**
- `[P3] (confidence: 8/10) PartialPaymentDrawer.tsx (plan D2)`: the intent branching would otherwise be written three times. Build routes it through one `leaveEdit()` (no behaviour change).
- `[P3] (confidence: 8/10) PartialPaymentDrawer.tsx:328-331`: amount focus+select on the date-fix path. Accepted: `focusDate` (D3).
Dispositions: F3 noted for build; F4 accepted D3.

**3. Tests** (Vitest + Testing Library; Playwright QA specs under `qa/specs/web`)
```
CODE PATHS                                              USER FLOWS
[+] lib/stores.ts partialPaymentDrawer                  [+] Ledger date fix, full payment
  ├── open w/ intent ............ [GAP] → test 2          ├── [GAP] [→E2E] kebab → edit → Update → row flash (QA spec)
  ├── editPaymentRecord keeps/drops intent [GAP] → 2      └── [GAP] [→E2E] Enter in date field updates, never creates
  └── close clears intent ....... [★★ :538, extend]           (user-event can't submit form= buttons; learning)
[+] PartialPaymentDrawer                                [+] Ledger date fix, part-paid
  ├── waitingForRecord explicit . [★★★ TESTED :615]       └── [GAP] picker → pencil → Update → back to picker → 3
  ├── waitingForRecord intent ... [GAP] → 3             [+] IncomeDrawer jump
  ├── autoRecord (1 record) ..... [GAP] → 3               ├── [GAP] link shown on record-backed edit only → 5
  ├── pickerMode 0 / ≥2 ......... [GAP] → 3               └── [GAP] disabled + hint while dirty (D2) → 5/6b
  ├── records isError (D7) ...... [GAP] → 3             [+] Client-profile edit (no intent, AC6)
  ├── leaveEdit single/multi .... [GAP] → 3               └── [★★★ TESTED :562 :603] returns to entry view
  ├── no-intent returnToEntry ... [★★★ TESTED :562]     [+] Error states
  ├── focusDate (D3) ............ [GAP] → 6b              ├── [★★ TESTED :473] future date refused (create)
  └── future date under intent .. [GAP] → 3               └── [GAP] future date refused under intent → 3
[+] lib/dates.ts local-day prefill + display (D6/D7) [GAP] → 6a/6c (UTC+ and UTC- TZ)
[+] incomeRows.canEditPayment ... [GAP] → 1
[+] IncomePage kebab action ..... [GAP] → 4
[+] paymentRecordRepo.update → entry recalculation
  └── entry paidAt/status/received after date move [★ record-only :222] → extend (D4)
COVERAGE (existing): 4/22 paths  |  every GAP has a planned test above
QUALITY: ★★★:3 ★★:2 ★:1  |  GAPS: 18 (2 E2E)
```
- `[P3] (confidence: 9/10) src/db/__tests__/paymentRecords.test.ts:222`: the update-date test never asserts the entry's recalculated fields. Accepted: extend it, and drop the new integration file (D4).
Regression contract: ticket AC6, carried forward (existing tests `:562`/`:603` unchanged). Test Plan artifact: `~/.gstack/projects/vAWK3-mutaba3a/basel-main-eng-review-test-plan-20261014-013912.md`. Tests to retire: none.
Dispositions: F5 accepted D4.

**4. Performance:** no issues found. No new queries. The drawer reads the `usePaymentRecords` cache that IncomeDrawer has already loaded, and `canEditPayment` is O(1) on memoised rows. Scale: one cached IndexedDB read per drawer open.

## NOT in scope
- **Home → Recent payments:** its rows route to the client page, not this drawer (the no-client path inherits D5).
- **ClientWorkSection / ProjectDetailPage entry points:** not named in the ticket.
- **Expenses:** already editable through `ExpenseDrawer.occurredAt`.
- **Time-of-day and bulk editing:** out of scope per the ticket.
- **The hosted portal (`src/hosted`):** read-only payments, with no payment-record writes.
- **MUT-85 (one payment across entries):** future; the picker is per transaction.
- **Returning to IncomeDrawer after the edit:** this would need cross-drawer return state that no other drawer has.

## What already exists
- `paymentRecordRepo.update` and `recalculateReceivedAmount` (`src/db/repository.ts`) handle the future-date refusal and the re-derived `status`/`receivedAmountMinor`/`paidAt`. They are reused unchanged (AC3, AC5).
- `PartialPaymentDrawer` edit mode, `PaymentForm` and `PaymentRecordRow` (edit/delete) are reused; the picker is the existing history list.
- `useSavedFlashStore.markSaved` gives the row flash after an edit, unchanged.
- IncomeDrawer's `recordsFailed` notice and Retry (`drawer.income.paymentsLoadFailed`/`paymentsRetry`) are reused for D7.
- `lib/dates.ts` `formatLocalDate` / `isFuturePaymentDate` are the base for the D6/D7 helpers.

## Flow diagram
```
/income row kebab ──┐                         IncomeDrawer (edit, hasRecords, !dirty)
 (canEditPayment)   │                              │ "Edit Payment" → closeIncomeDrawer()
                    ▼                              ▼
     openPartialPaymentDrawer({ transactionId, intent: 'editPayment' })
                    │
            records loading? ──yes──► spinner (no form)
                    │no
            records isError? ──yes──► "Couldn't load…" + Try again (refetch)   [D7]
                    │no
        ┌───────────┼──────────────────────┐
     0 records   1 record              ≥2 records
  "No payments"  autoRecord → edit form  picker (history list, pencils)
     + Close     (date open+focused, D3;     │ pencil → editPaymentRecord (intent kept)
                  local-day prefill, D6)     ▼
                    │                     edit form
                    ▼ Update                 │ Update / Cancel
     paymentRecordRepo.update → recalculateReceivedAmount
                    │
            leaveEdit(): 1 record → close · ≥2 → back to picker · no intent → returnToEntry (unchanged)
```

## Failure modes
| New path | Realistic failure | Test / handling | User sees |
|---|---|---|---|
| Edit intent opens | IndexedDB read of records fails | D7 notice + Retry; drawer test | Clear error, recoverable |
| Prefill of a timestamped paidAt | UTC/local day mismatch after midnight | D6 helper; dates test (UTC+) | Correct day |
| Save under intent | Future date chosen | Existing `isFuturePaymentDate` + repository refusal; drawer test | Clear inline error |
| Save under intent | Repository rejects (e.g. record deleted elsewhere) | Existing inline error path (`surfaces a repository rejection inline`) | Clear inline error |
| IncomeDrawer link | Unsaved edits dropped | D2 disable + hint; test | Clear hint, no loss |
| History/payments display | Date-only paidAt west of UTC | D7 parse; dates test (UTC-) | Correct day |
Critical gaps: 1 flagged (records load failure shown as empty), resolved by D7. 0 open.

## Worktree parallelization strategy
Sequential implementation, no parallelization opportunity. One primary module (the payment drawer and its two openers), and every step depends on the store intent. Build in a dedicated worktree: another session is merging into mini-crm `main` (MUT-160 landed during this review).

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **T1 (P1, human: ~1h / CC: ~10min)** — lib/dates — Local-day helpers for payment dates (prefill + display parse)
  - Surfaced by: Architecture F1 (D1) and final planning F6 (D5)
  - Files: `src/lib/dates.ts`, `src/lib/__tests__/dates.test.ts`
  - Verify: `npm run test:run -- src/lib/__tests__/dates.test.ts` under UTC+ and UTC- TZ
- [ ] **T2 (P1, human: ~2h / CC: ~15min)** — PartialPaymentDrawer — Edit intent: store field, derived autoRecord/pickerMode, intent-aware waiting, D7 error + retry, one `leaveEdit()`, `focusDate`, local-day prefill
  - Surfaced by: plan D1/D2/D3 with F1, F3, F4, F7 (D1, D3, D7)
  - Files: `src/lib/stores.ts`, `src/components/drawers/PartialPaymentDrawer.tsx`, their tests
  - Verify: `npm run test:run -- PartialPaymentDrawer stores`
- [ ] **T3 (P1, human: ~1h / CC: ~10min)** — /income ledger — `canEditPayment` and the kebab "Edit Payment" action
  - Surfaced by: ticket AC1/AC4 (plan D4)
  - Files: `src/pages/income/incomeRows.ts`, `src/pages/income/IncomePage.tsx`, their tests
  - Verify: `npm run test:run -- incomeRows IncomePage`
- [ ] **T4 (P1, human: ~1.5h / CC: ~10min)** — IncomeDrawer — "Last payment {date} · Edit Payment" line, dirty guard + hint, corrected `paymentsRecordedHint`
  - Surfaced by: plan D5 and Architecture F2 (D2)
  - Files: `src/components/drawers/IncomeDrawer.tsx`, `src/lib/i18n/translations/{en,ar}.json`, `src/components/drawers/__tests__/IncomeDrawer.paymentLink.test.tsx`
  - Verify: `npm run test:run -- IncomeDrawer`
- [ ] **T5 (P1, human: ~45min / CC: ~5min)** — Payment date display — Render date-only paidAt as its local day in PaymentRecordRow and ClientPaymentsSection
  - Surfaced by: final planning F6 (D5, build now)
  - Files: `src/components/drawers/PartialPaymentDrawer.tsx`, `src/components/clients/ClientPaymentsSection.tsx`
  - Verify: `npm run test:run -- ClientPaymentsSection PartialPaymentDrawer`
- [ ] **T6 (P2, human: ~45min / CC: ~5min)** — Repository test — Assert entry recalculation after a date move (full and part-paid)
  - Surfaced by: Tests F5 (D4)
  - Files: `src/db/__tests__/paymentRecords.test.ts`
  - Verify: `npm run test:run -- paymentRecords`
- [ ] **T7 (P2, human: ~1.5h / CC: ~15min)** — QA spec — `web.income.edit-payment-date` (+ `-rtl`), including Enter-updates-never-creates
  - Surfaced by: Tests diagram [→E2E] gaps; learning user-event-no-implicit-submit-form-attr
  - Files: `qa/specs/web/record-payment.spec.ts`
  - Verify: `npm run test:e2e -- record-payment`
- [ ] **T8 (P2, human: ~30min / CC: ~5min)** — Knowledge files — CHANGELOG, COMPONENT_REGISTRY (drawer intent), TEST_PLAN
  - Surfaced by: CLAUDE.md knowledge protocol
  - Files: `.claude/CHANGELOG.md`, `.claude/COMPONENT_REGISTRY.md`, `.claude/TEST_PLAN.md`
  - Verify: `npm run lint && npm run typecheck && npm run test:run && npm run build` (Node 22)

## Unresolved decisions
None.

## Completion summary
- Step 0: Scope Challenge — scope accepted as-is (D5 later added the date-display fix by explicit choice; arrangement confirmed, D6)
- Architecture Review: 2 issues found
- Code Quality Review: 2 issues found
- Test Review: diagram produced, 1 gap identified (plus 18 planned-new-path gaps, each with a planned test)
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 1 item proposed to user (built now instead, D5)
- Failure modes: 0 critical gaps open (1 flagged and resolved, D7)
- Unresolved decisions: 0 in this review
- Outside voice: codex, unavailable (CLI not installed; native fallback needs TaskOutput, absent in this session)
- Parallelization: 1 lane, 0 parallel / 1 sequential
- Lake Score: 5/5 = answers picking a 10/10 option / answers scored for Completeness

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex (`/plan-eng-review` outside voice) | Independent 2nd opinion | 1 | unavailable | CLI not installed; no native fallback (TaskOutput absent) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open (all resolved) | 5 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review phase, unavailable (not installed); no findings; missing coverage, not a clean pass.
- **VERDICT:** No review CLEAR: Eng Review is issues_open (5 findings, all resolved into the plan as D1–D7; mapped work, not failure). eng review required

NO UNRESOLVED DECISIONS
