# MUT-87 — Expenses: one Needs attention row per recurring rule: test plan

- **Ticket:** MUT-87 (epic MUT-74) · **Decision:** E1 in `.claude/designs/landing-apple-redesign.md` (approved 2026-10-11)
- **Builds on:** the recurring-expenses brief (`.claude/designs/recurring-expenses.md`), MUT-14 (one gated expense ledger), ADR-032 (Expenses is an optional area), ADR-034 / `useMenuButton` (menu buttons)
- **ADR:** ADR-052 · **Debt ids reserved:** TD-069, TD-070

## What changes

Today the Expenses page's "Needs attention" section shows one card per missed payment of a recurring rule, each with Mark Paid, Skip, Snooze and Edit recurring rule. Three missed months of server hosting are three identical cards and 12 buttons for one decision.

After this ticket:

1. **One row per rule.** "Server hosting · $80 monthly · Aug, Sep, Oct not marked · $240". The amount under it says how late the oldest payment is ("68d overdue", "Due today"), like Home's Needs attention.
2. **One primary button, Mark paid.** It opens a small drawer (the shared `Drawer`, unchanged) listing the rule's missed payments, oldest first, all checked, each with its date and an amount field prefilled with the rule's amount. Saving writes one expense per checked payment, dated on that payment's expected date, in one all-or-nothing write.
3. **Skip, Snooze, Edit rule move to a ⋯ menu** (`useMenuButton`): Skip and Snooze there apply to all of the rule's missed payments. Inside the drawer each payment has its own Skip and Snooze.
4. **Snooze is a view of the same drawer** (date + quick picks), for one payment or all of them. `RecurringConfirmModal` and `RecurringSnoozeModal` lose their last consumer and are deleted; `RecurringOccurrenceCard` keeps only the read-only form the forecast uses.
5. **The section total shows each non-zero currency side by side**, never combined, like Owed now. The page's "Total Expenses" strip follows the same rule (brief craft fix: "Expenses total shows one currency with the rest behind ⓘ").

## Implementation decisions

| # | Decision |
|---|---|
| D1 | Grouping is a pure function in `src/components/expenses/recurringAttention.ts`: `groupOccurrencesByRule(occurrences)` → one group per `ruleId`, occurrences sorted oldest first; groups ordered by their oldest expected date, then title, then rule id. The group carries title, frequency, currency, the per-period amount (the newest payment's amount), the total and the occurrences. |
| D2 | `VirtualOccurrenceDisplay` gains `frequency` (resolved from the rule in `getVirtualOccurrences`), so the row can say "monthly" / "yearly". Occurrence generation is not touched. |
| D3 | Batch writes reuse the single-payment service functions. `confirmPayments`, `skipOccurrences` and `snoozeOccurrences` loop over `confirmPayment` / `skipOccurrence` / `snoozeOccurrence` inside `recurringOccurrences.runAtomically(work)`, a new repository method. The Dexie implementation is one `rw` transaction over `recurringRules`, `recurringOccurrences` and `expenses`; any throw rolls back every write. |
| D4 | Each marked payment is dated on its own expected date (the AC). The old modal defaulted the paid date to today; the drawer has no date field. The amount stays editable per payment (the recurring brief's "amount can be edited before confirming"); `amountMinor` is sent only when it differs from the payment's amount, so `actualAmountMinor` records a real override. The old modal's notes field is dropped (the rule's default notes still apply). |
| D5 | The ⋯ menu uses `useMenuButton()` (menu kind): items are `role="menuitem"`, `tabIndex={-1}`; the menu renders next to its button (rows are a list, not a scrolling table, so nothing clips it). Skip all asks first (native confirm, as Skip did); Snooze all opens the drawer on its snooze view; Edit rule opens the expense drawer on the rule (unchanged). |
| D6 | Totals: `currencyTotals(groups)` returns non-zero currencies in USD → ILS → EUR order; `CurrencyAmounts` (new, `components/ui`) renders each as its own `<bdi dir="ltr">`. Amounts are never added across currencies. |
| D7 | Strings: new keys under `expenses.recurring.attention.*`, en and ar. Counted strings are CLDR plural objects through `tp()` (en `one`/`other`, ar all six). Month names and dates come from `Intl.DateTimeFormat`, month lists from `Intl.ListFormat`, quick snooze picks from `Intl.RelativeTimeFormat`. Amounts inside sentences are isolated with U+2068/U+2069 (written as escapes). |
| D8 | Mutation hooks: `useConfirmRecurringPayments`, `useSkipRecurringOccurrences`, `useSnoozeRecurringOccurrences` replace the single-payment hooks, whose only consumer was the old cards. They invalidate the same keys as before (and `['expenses']` for confirm), never `invalidateMoneyEventQueries`. `useExpenseQueries.ts` is not touched. |

## Rules under test

| # | Rule | Level | File |
|---|---|---|---|
| T1 | One missed payment → one group with one occurrence; total = its amount | unit | `components/expenses/__tests__/recurringAttention.test.ts` |
| T2 | Three missed payments of one rule → one group, occurrences oldest first even when the input is unsorted; total = sum | unit | same |
| T3 | Two rules → two groups, ordered by oldest expected date, ties by title then id; another rule's payments never leak into a group | unit | same |
| T4 | The group carries title, frequency, currency and the per-period amount (newest payment) | unit | same |
| T5 | Empty input → no groups; `currencyTotals` of no groups → `[]` | unit | same |
| T6 | `currencyTotals` sums per currency, drops zero, orders USD → ILS → EUR, never combines | unit | same |
| T7 | `formatMonthList` gives "Aug, Sep, Oct" in English and Arabic month names in Arabic (`Intl`), reading the date as a local calendar date (no UTC shift west of UTC); adds the year only when the payments span two years | unit | same |
| T8 | `snoozeDateAfter(today, days)` adds calendar days, across a month and a year end | unit | same |
| T9 | `confirmPayments` with three payments writes three expenses, each dated on its own expected date, each linked to its resolved occurrence, in one call | integration (fake-indexeddb) | `services/__tests__/recurringExpenseService.batch.test.ts` |
| T10 | `confirmPayments` with a partial selection (2 of 3) writes only those two; the third is still due afterwards | integration | same |
| T11 | `confirmPayments` is all or nothing: when one payment fails (an unknown rule or a forced failure on the second write), no expense and no occurrence is left behind | integration | same |
| T12 | `confirmPayments` stores an edited amount as the expense amount and `actualAmountMinor`; an unedited one leaves `actualAmountMinor` unset | integration | same |
| T13 | `skipOccurrences` (one, or all) resolves each as skipped and writes no expense; all or nothing | integration | same |
| T14 | `snoozeOccurrences` snoozes each until the date; a past date rejects the whole batch with nothing written | integration | same |
| T15 | `getVirtualOccurrences` carries the rule's `frequency` | integration | same |
| T16 | The batch hooks call the batch service functions and invalidate occurrences, due occurrences, rule history (and expenses on confirm) | hook | `hooks/__tests__/useRecurringExpenseQueries.test.tsx` |
| T17 | The list renders one row per rule: title, "$80 monthly · Aug, Sep, Oct not marked", "$240", and "Nd overdue" from the oldest | component | `components/expenses/__tests__/RecurringAttentionList.test.tsx` |
| T18 | A one-payment rule reads "… · Oct not marked" and its menu says "Skip" / "Snooze…", not "all" | component | same |
| T19 | The header shows the number of rules and the total per currency side by side ($ and ₪ as separate amounts) | component | same |
| T20 | Mark paid calls `onMarkPaid(group)`; the ⋯ menu opens with focus on its first item, arrows move, Escape closes and returns focus to the ⋯ button; Skip all / Snooze all / Edit rule call their handlers with the group | component | same |
| T21 | In Arabic the row is RTL-correct: months in Arabic, amounts in `<bdi dir="ltr">`, plural forms picked by `Intl.PluralRules('ar')` | component | same |
| T22 | The drawer lists every payment checked, with its date; saving with all checked sends every payment, each with its expected date | component | `components/drawers/__tests__/RecurringMarkPaidDrawer.test.tsx` |
| T23 | Unchecking one sends only the rest; the primary button counts the selection ("Mark 2 paid"); none checked disables it | component | same |
| T24 | Editing a payment's amount sends that amount; an unreadable or zero amount shows the field error and blocks saving | component | same |
| T25 | Skip on a payment asks first, then skips only that payment; Snooze on a payment opens the snooze view for that payment and saves its date | component | same |
| T26 | Opened on the snooze view (Snooze all from ⋯), it snoozes every payment; Cancel closes | component | same |
| T27 | The drawer in Arabic: dialog named by the rule title, month names and the button text in Arabic | component | same |
| T28 | The page shows the grouped section (not cards), Mark paid opens the drawer, Skip all confirms and skips every payment; the total strip shows each non-zero currency | component (page) | `pages/expenses/__tests__/ExpensesLedgerPage.test.tsx` |
| T29 | Every new key exists in en and ar; every plural key has `one` + `other` in en and all six forms in ar; `{count}`/`{months}`/`{title}`/`{amount}` placeholders survive translation | unit | `lib/i18n/__tests__/recurringAttentionKeys.test.ts` |

## Edge cases

- A yearly rule: "$1,200 yearly · Oct not marked".
- A rule whose payments straddle a year end: "Dec 2025, Jan 2026 not marked".
- A payment due today (not overdue): status "Due today".
- Unchecking every payment: Mark paid is disabled, nothing is written.
- Skipping the last payment in the drawer closes it; so does marking all paid.
- A snoozed payment that has woken up appears again in its rule's row (the existing virtual-occurrence rules decide this; not changed here).
- Arabic: amounts stay left to right inside Arabic sentences; month names and digits come from `Intl` with the `ar` locale.

## Out of scope (logged, not changed)

- `getDueOccurrences` looks back only 90 days, so a payment missed four months ago never shows. Pre-existing; changing the window is a product decision.
- The recurring service still derives "today" from the UTC date (TD-014).
