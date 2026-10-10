# Design Brief — MUT-14: Collapse expenses from 7 pages to 1 ledger, behind the Advanced toggle

- **Date:** 2026-10-10
- **Epic:** MUT-2 "Strip to the core: delete dead surface, gate the optional"
- **Blocked by:** MUT-12 (built on this branch, 8fab72a). **Fixes:** MUT-20 (18 failing `ExpensesLedgerPage` tests).
- **Related:** MUT-13 (gating pattern, ADR-030 addendum), MUT-15 (sidebar / `+ Add` menu), MUT-16 (projects, insights, planning), ADR-029 (removing a feature's UI never removes its tables).
- **Worktree:** `.claude/worktrees/mut-2-strip-core`, branch `feature/mut-2-strip-core`. **Safety tag before any deletion:** `mut-14-pre-expenses-collapse` (at 2855558).
- **Status:** planned 2026-10-10; outside-voice review folded in (§9); building under the owner's standing instruction (MUT-12 → 13 → 14 → 16).

---

## 1. Problem and acceptance criteria

Expenses occupy nine routes and nine pages (3,666 LOC) for an area the intake made optional. The ticket keeps **one** ledger behind the Expenses switch, deletes the rest, prunes repository code nobody calls any more, and demands data safety for receipts (user-uploaded files) and vendors (user-authored records).

Acceptance criteria (ticket):

1. Exactly one expense page remains, reachable only when the Expenses toggle is on.
2. Its 18 currently failing tests are green.
3. Deleted routes give a clean not-found or redirect, never a crash.
4. No user data is unreachable afterwards: receipts and vendors are still viewable or were exportable first — stated explicitly on the ticket.
5. Repository pruning removes only code with no remaining consumer, verified by `git grep`.
6. `tsc -b` passes; lint introduces no new errors; full suite green.
7. Dexie schema version unchanged; existing databases open intact.
8. No orphaned i18n keys in either locale file.

## 2. What the audit found (verified 2026-10-10)

| Fact | Evidence | Consequence |
|---|---|---|
| The 18 failures are a test-setup gap, not a product bug | `ExpensesLedgerPage.tsx:170` returns `expenses.noProfileSelected` when `useActiveProfile()` has no profile; the test mocks stores, recurring hooks and media query but never a business profile, and fake-indexeddb is empty | Mock `useActiveProfile` / `useProfileFilter` in the test (the same way `AttentionFeed.test` mocks `useProfileFilter`). No page change |
| Nothing outside `pages/expenses` and `pages/suppliers` links into the deleted pages | `grep` for `/expenses/profile`, `/expenses/overview`, `/expenses/forecast`, `/expenses/vendors`, `/expenses/close`, `/suppliers` in surviving code: empty | Redirects are a courtesy for bookmarks, not a dependency |
| The ledger itself depends on the recurring machinery | `ExpensesLedgerPage.tsx:14-27` imports `RecurringOccurrenceList`, `RecurringConfirmModal`, `RecurringSnoozeModal`, `useDueOccurrences`, `useVirtualOccurrences`, confirm/skip/snooze mutations; `ExpenseDrawer.tsx:13-16` creates/updates/deletes recurring rules | The ticket's "remove recurring-occurrence machinery" is **wrong as written**: it stays. Only `RecurringRuleDrawer` (rendered by nobody — `grep` finds no renderer) goes |
| Receipts are base64 files in the `receipts` table, reachable only through `ReceiptsPage` and `MonthCloseChecklistPage` | `Receipt.data: string // base64`; `receiptRepo` / `useReceipts*` consumers outside the deleted pages: none except `ExpenseDrawer`'s `useLinkReceiptToExpense` (used when creating an expense *from* a receipt) | **Ship an export path before the deletion commits** (§4) |
| Vendors stay in use | `VendorTypeahead` (`useVendors`, `useFindOrCreateVendor`, `vendorNormalization`) is used by `ExpenseDrawer`; vendor names show on ledger rows | Vendors remain viewable and creatable; only the management views (merge, alias, monthly table) go |
| Forecasting, receipt matching and month close have no consumer outside the deleted pages | `forecastCalculations` → only `useExpenseForecast`; `matchingAlgorithm` → only receipt-suggestion hooks; `monthCloseRepo` / `useMonthClose*` / `ClosedMonthWarning` → only the checklist page | Prune by the consumer script (§5), tables untouched (ADR-029) |
| `/suppliers` is a second view over `vendors` | `SuppliersPage.tsx` reads `useExpenses` + vendors | Deleted with the route; the Expenses switch covers it (ADR-030 §5) |

## 3. Where it lives

| Concern | Change |
|---|---|
| Surviving page | `src/pages/expenses/ExpensesLedgerPage.tsx` unchanged in behaviour; route `/expenses` gets `beforeLoad: requireFeature('expenses')` |
| Deleted pages (one commit each) | `ExpensesPage` (profiles), `ProfileExpensesPage`, `ReceiptsPage`, `ExpensesOverviewPage`, `ExpensesForecastPage`, `VendorsPage`, `MonthCloseChecklistPage`, `SuppliersPage` + their CSS, their tests (`ExpensesPage.test`, `ProfileExpensesPage.test`, `ExpensesOverviewPage.test`), `pages/expenses/components/ReceiptMatch*`, `components/ui/ClosedMonthWarning`, `components/drawers/RecurringRuleDrawer` |
| Routes | The eight legacy paths become `beforeLoad: () => { throw redirect({ to: '/expenses' }) }` (then the gate decides); `/suppliers` likewise. No `component`, so no chunk |
| Sidebar | Expenses leaves the main section and Suppliers leaves workspace; `optionalItems` gains `{ path: '/expenses', feature: 'expenses' }` first; the `+ Add → Expense` item is hidden while expenses is off (one filter; MUT-15 revisits the menu) |
| Receipts export | `exportAllReceiptsAsZip()` in `src/lib/zipExport.ts` (all profiles, folder per profile/month, reuses the existing per-month writer); Settings › Data tools row **Export receipts (N files)**, disabled at 0 |
| Repository / hooks pruning | consumer-driven (§5): `src/db/expenseRepository.ts`, `src/db/interfaces.ts`, `src/db/provider.ts`, `src/hooks/useExpenseQueries.ts`, `src/lib/forecastCalculations.ts`→`src/db/forecastCalculations.ts`, `src/lib/matchingAlgorithm.ts`, `src/components/ui/index.ts` |
| i18n | remove `suppliers.*`, `monthClose.*`, `receipts.*` and the `expenses.*` leaves no surviving file references (script, §6), in en and ar |
| Tests | fix the ledger test; delete the three page tests; extend `router.gates.test` (expenses gated, legacy paths redirect); sidebar test (Expenses in "More" only when on; `+ Add` hides Expense); zip export unit test; prune verification test (no import of deleted modules) |

## 4. Receipts and vendors — the data-safety answer for the ticket

- **Receipts:** every receipt remains in the `receipts` table (ADR-029; schema v20 unchanged). Before the `ReceiptsPage` deletion commit, Settings › Data tools gains **Export receipts**, which writes one ZIP with `<profile>/<YYYY-MM>/<fileName>` for every receipt across all profiles (the per-month writer `exportReceiptsAsZip` already exists and is reused). The JSON backup already includes the table. After this ticket receipts are **exportable, not viewable** in the app; viewing returns if a receipts surface is ever rebuilt inside the ledger. Linking a receipt to an expense from the drawer (`linkReceiptId`) keeps working for any caller.
- **Vendors:** remain **viewable and creatable** — the ledger rows show the vendor and `ExpenseDrawer`'s `VendorTypeahead` finds-or-creates — and are in the JSON backup. Merge / alias management and the monthly supplier table are gone with their pages.

## 5. Pruning rule (AC 5)

After the page deletions, a script lists every export of `expenseRepository.ts`, `useExpenseQueries.ts`, `useRecurringExpenseQueries.ts`, `forecastCalculations.ts`, `matchingAlgorithm.ts`, `vendorNormalization.ts` and `zipExport.ts` and counts references outside the defining file and its tests. **Zero references → removed, together with its interface member, provider slot and tests.** Anything with one surviving caller stays, even if the ticket named it. Expected to go: forecasting (`forecastCalculations.ts`, `useExpenseForecast`, `expenseRepo.getYearlyTotals/getAllProfilesTotals` if unused), receipt matching (`matchingAlgorithm.ts`, suggestion / duplicate / bulk hooks, `receiptRepo.getUnlinked*`), month close (`monthCloseRepo` + hooks), vendor management (`mergeVendors`, `addAlias`, delete). Expected to stay: expense CRUD and totals the ledger uses, recurring rules and occurrences, receipt CRUD + `getByProfileAndMonth` + `linkToExpense`, vendor `list/get/create/findOrCreate`.

## 6. i18n rule (AC 8)

For each leaf key under `expenses`, `suppliers`, `monthClose`, `receipts` (en as the source of truth): keep if its full dotted path appears in any surviving `src/**/*.{ts,tsx}` (excluding tests), or if a dynamic prefix (`t(\`expenses.something.${x}\`)`) covers it. Remove otherwise, from both locales. The parity test for `settings.features.*` stays; a new parity assertion checks en and ar have identical key sets under `expenses`.

## 7. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | The ledger is kept **as is**; no features are absorbed from the deleted pages | It already has the summary strip, list/grouped toggle, search, date range and the recurring due list the ticket names; absorbing anything else is scope creep |
| D2 | Recurring rules and occurrences **stay** | The ledger and the drawer depend on them (§2); the ticket's prune list predates that |
| D3 | Receipts become export-only; export ships before the deletion | Ticket's hard constraint; rebuilding a viewer inside the ledger is a separate decision |
| D4 | Legacy expense paths redirect to `/expenses`, which then gates | Ticket allows not-found or redirect; a redirect keeps old bookmarks useful and costs no chunk |
| D5 | Pruning is decided by the consumer script, not the ticket's list | AC 5 says "verified by `git grep`"; the ticket's list is already wrong about recurring |
| D6 | `+ Add → Expense` hides while expenses is off | One filter; creating an expense into a hidden area is the only confusing path left |
| D7 | One commit per deleted page, after the export commit and the test fix | Ticket guardrail; each page independently revertible |
| D8 | Tables and Dexie version untouched | ADR-029, AC 7 |

## 8. Build order

1. Fix the ledger test (mock the active profile) → 18 green. Commit.
2. `exportAllReceiptsAsZip` + Settings row + i18n + unit test. Commit ("export path before deletion").
3. Gate `/expenses`; sidebar moves Expenses to "More", drops Suppliers, hides `+ Add → Expense` while off; tests. Commit.
4. Delete pages one commit each (ExpensesPage, ProfileExpensesPage, ReceiptsPage [+ components], ExpensesOverviewPage, ExpensesForecastPage, VendorsPage, MonthCloseChecklistPage [+ ClosedMonthWarning], SuppliersPage [+ route], RecurringRuleDrawer), each replacing its route with a redirect and deleting its test and CSS.
5. Prune script → remove dead exports, interface members, provider slots, tests. Commit.
6. i18n orphan script → remove keys in en + ar; parity assertion. Commit.
7. Knowledge files; `npm run lint`, `tsc --noEmit`, full suite, `npm run build`.

## Business / product impact
- The product's largest non-core surface shrinks to one page behind a switch; users who track expenses keep the ledger, recurring reminders and the drawer; everyone else never sees it.
- Receipts and vendors are provably safe: exportable before the UI goes, tables untouched, backup unchanged.
- Closes MUT-20 on the way.

## 9. Engineering review (condensed) and outside voice

- **Scope:** 9 page deletions, 1 export feature, route/sidebar gating, pruning. Arrangement accepted (commit-per-page keeps it reviewable).
- **A1 [P1] (9/10)** `ExpensesLedgerPage.tsx:14-27` — the recurring machinery is a live dependency; pruning it would break the surviving page. Resolved: D2.
- **A2 [P1] (9/10)** `types/index.ts:577` `data: string // base64` — receipts are files; deleting `ReceiptsPage` first would strand them. Resolved: D3, export commit precedes deletion.
- **A3 [P2] (8/10)** `src/components/layout/SidebarNav.tsx:107` `+ Add → Expense` opens the drawer regardless of the switch. Resolved: D6.
- **C1 [P2] (8/10)** Interfaces and provider `satisfies` will fail typecheck for every pruned repository method — the prune touches `interfaces.ts` and `provider.ts` in the same commit.
- **Tests:** the ledger test fix is the MUT-20 bug; existing tests for deleted pages go with them; new tests listed in §3.
- Outside voice: recorded in §10 when the native fallback completes.
