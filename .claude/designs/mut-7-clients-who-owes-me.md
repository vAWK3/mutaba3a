# Design Brief — MUT-7: The clients index answers "who owes me, and who is late"

- **Date:** 2026-10-11
- **Ticket:** MUT-7 (epic MUT-1). Closes parent-brief D6 (`lastPaymentAt` ignores partial/backdated payments) and the index half of TD-030.
- **Parent brief:** `.claude/designs/mut-1-client-accounting-core.md` Phase 4. Builds on MUT-3 / ADR-033.
- **Branch / worktree:** `feature/mut-1-client-core` in `.claude/worktrees/mut-1-client-core`, from `main` c122543
- **Status:** approved by Basel 2026-10-11 — D8 = A (rank by today's rate, nothing converted on screen), D9 = 1 (Owed-now strip for all listed clients), rest as written

---

## 1. Problem

`src/pages/clients/ClientsPage.tsx` lists clients by name with activity-oriented columns (active projects, received, unpaid, last payment date, last activity). The question asked of this screen is always "who owes me, and who is late".

Audit findings beyond the ticket:

| # | Finding | Consequence |
|---|---|---|
| F1 | The ticket says the aggregation exists. `clientSummaryRepo.list` has no overdue amount, no overdue age, and no last-payment amount | New derivation is needed. It is small and reuses MUT-3's helpers |
| F2 | `lastPaymentAt` is set only from fully-paid entries' `tx.paidAt` (`aggregateTransactionTotalsWithActivity`) | Partial and backdated payments never show as "last payment" (parent-brief D6) |
| F3 | Unpaid per currency counts archived income | It disagrees with the client profile's Owed Now (TD-030) |
| F4 | The `value` and `unpaid` sorts add raw minor units across USD, ILS and EUR | The cross-currency summing the epic forbids |
| F5 | The summary strip and the amount cells use `CurrencySummaryPopup` | Every client's money is converted into one ILS figure |
| F6 | `clients.emptyFiltered`, `clients.emptyFilteredCount` and `clients.clearSearch` don't exist; the page relies on `t(key) \|\| 'fallback'`, but `t` returns the key | The search-empty state shows raw keys to users |
| F7 | The cross-profile badge has a literal `"txns"` | An i18n violation |
| F8 | Each client filters every transaction (`O(clients × transactions)`) | Wasted work at a few hundred clients |

## 2. Acceptance criteria (MUT-7, unchanged)

- [ ] Default view sorted by owed now, descending
- [ ] Owed now and overdue shown per currency, no cross-currency summing
- [ ] Last payment shows date and amount; a clear "never" state
- [ ] Clients owing nothing read as settled, not blank
- [ ] Row click opens the client profile
- [ ] Archived clients excluded by default
- [ ] Sorting by each column works and is stable for ties
- [ ] Column definitions memoised with a stable dependency list; rows pre-shaped in `useMemo`
- [ ] Tests: sort order, per-currency display, never-paid state, archived exclusion
- Guardrails: responsive with a few hundred clients, RTL numeric alignment, i18n keys, `Intl` formatting

## 3. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **`clientSummaryRepo.list` adds three fields.** `owed: OwedByCurrency[]` comes from `summarizeOwedByCurrency`, so it excludes archived income. `oldestOverdueDays?: number` is the age of the client's oldest overdue item. `lastPayment?: { paidAt, amountMinor, currency }` is the newest of the client's payments. `lastPaymentAt` becomes `lastPayment.paidAt` in both `list` and `get` | One definition of owed now (ADR-033). It closes D6 and the index half of TD-030 |
| D2 | **"Payments" means the MUT-3 definition.** The record-plus-entry derivation in `listByClient` moves into a pure `paymentRowsForIncome(tx, records)` in `aggregations.ts`. Both `listByClient` and the summary call it | The index's last payment then always matches the profile's Payments section, including income saved as Received |
| D3 | **One pass, no per-client scans.** Transactions are grouped by `clientId` and non-deleted payment records by `transactionId` once per `list()` call | F8; a few hundred clients stays linear |
| D4 | ~~The per-currency paid/unpaid fields leave `ClientSummary`~~ **Reverted during the build (2026-10-11):** the Insights and Reports client tables read them too, which the audit missed. They stay, computed as before; `owed` is the collection figure, and the remaining difference (report totals count archived income) stays under TD-030 | Removing them would break a live optional area for no gain on this ticket |
| D5 | **Columns:** Client · Owed now · Overdue · Last payment · Last activity. Owed now lists each currency on its own line, or shows **Settled** (muted success) when the client owes nothing. Overdue lists each overdue currency in the error colour with **"oldest Nd"** beneath, or a muted "—". Last payment shows the date over the amount, or **Never paid**. The overdue portion is "distinguished" by its own column beside Owed now rather than repeated inside it | Exactly the ticket's column set; no blank cells |
| D6 | **Sort by clicking a column header** (button inside `th`, `aria-sort`, the existing `.data-table th.sortable` style). This replaces the sort dropdown and stays URL-persisted through `useSortState` (`sort` / `dir`). Default: `owed` / `desc`. Ties always fall back to name, then id, so the order is stable | "Sorting by each column works"; one way to sort, not two. A small `SortableHeader` component is registered for reuse (ProjectsPage can adopt it later) |
| D7 | **Non-owed sorts never touch currency.** Overdue sorts by `oldestOverdueDays` (days late), Last payment and Last activity by date, Client by name | Currency-free comparisons need no rule |
| D8 | **Owed-now ordering ranks by today's rate; nothing converted is ever shown** (§5 option A, chosen by Basel). Rank key: ILS-converted total over currencies with a rate, then the unrated amounts in USD → ILS → EUR order. The header tooltip says so. ADR-034 | A ranking is not a displayed total; only a conversion makes "owes most" true across currencies |
| D9 | **Summary strip = client count + `OwedNowSummary` over the listed clients** (§5 option 1, chosen by Basel); per-currency sums of each client's `owed`, via a pure `combineOwed` | The page's question is "who owes me"; the old converted Received/Unpaid totals go |
| D10 | **Whole row navigates to the profile** (`navigate({ to: '/clients/$clientId' })`). The name stays a `Link` for keyboard and middle-click | AC "row click opens the profile" |
| D11 | **Rows are shaped by `toClientIndexRow(summary)`, and the comparator is `compareClientRows(field, dir, rank)`**, both pure in `src/components/clients/clientIndexRows.ts` and both tested. The page wraps them in `useMemo`, and the column list is `useMemo(..., [t])` | AC memoisation; per-cell work becomes formatting only |
| D12 | **F6/F7 fixed:** add the three missing `clients.*` keys and `clients.crossProfileTxCount` in en and ar | The rewritten page must have no raw keys or literals |

## 4. API contracts

```ts
// src/db/aggregations.ts
paymentRowsForIncome(tx: Transaction, records: PaymentRecord[]): PaymentByClientRow[]
  // records = that entry's non-deleted records; returns record rows + at most one 'entry' row (ADR-033)
latestPayment(rows: PaymentByClientRow[]): { paidAt; amountMinor; currency } | undefined
  // newest paidAt; ties → larger amount, then id — deterministic

// src/types/index.ts — ClientSummary
+ owed: OwedByCurrency[]            // [] = settled
+ oldestOverdueDays?: number
+ lastPayment?: { paidAt: string; amountMinor: number; currency: Currency }
  lastPaymentAt?: string            // now = lastPayment?.paidAt
- paidIncomeMinorUSD/ILS/EUR, unpaidIncomeMinorUSD/ILS/EUR   // removed (D4)

// src/components/clients/clientIndexRows.ts
toClientIndexRow(s: ClientSummary): ClientIndexRow
compareClientRows(field: ClientSortField, dir: SortDir, owedRank: (row) => number): (a, b) => number
ClientSortField = 'name' | 'owed' | 'overdue' | 'lastPayment' | 'activity'
```

No thrown errors are added. An empty database lists nothing, and the existing empty state renders.

## 5. Open decisions (resolved 2026-10-11: D8 = A, D9 = 1)

**D8 — how "owed now, descending" orders clients who owe in different currencies.** You cannot rank $5,000 against ₪12,000 without either a conversion or a rule.

- **A. Rank by today's rate, show nothing converted (recommended).** The comparator ranks by each client's owed total converted to ILS with the same `useFxRate` rates `AmountWithConversion` already uses. Only the order uses it; every amount on screen stays in its own currency. The Owed now header's tooltip says "Ordered by today's exchange rate". If a rate is unavailable (offline first launch), that currency ranks after the ones with a rate, by amount.
- **B. No conversion: the main currency first.** Rank by the amount owed in the profile's default currency, then by the next currency in USD → ILS → EUR order. A client owing only ₪ always ranks below every client owing any $ (when USD is default).
- **C. Rank by lateness, not size.** Overdue clients first, oldest overdue first; then clients owing but on time; then settled. Amount never decides across currencies. This departs from the ticket's literal "owed now descending".

**D9 — the summary strip above the table.** It now shows "Total received" and "Total unpaid" converted to ILS (F5).

- **1. Owed now for all listed clients (recommended):** the same `OwedNowSummary` the profile uses (per currency, overdue part called out), plus the client count. "Total received" goes.
- **2. Client count only:** drop the money totals from this page and leave totals to Home (MUT-8).

## 6. Reuse analysis

Reused: `summarizeOwedByCurrency`, `OwedNowSummary`, the ADR-033 payment derivation (extracted, not duplicated), `useSortState`, `SearchInput`, `EmptyState`, `OrphanedRecordsModal`, cross-profile badges, `formatDate` / `formatRelativeDate`, `formatAmount`, `useFxRate` (if D8 = A).
New: `paymentRowsForIncome`, `latestPayment`, `clientIndexRows.ts`, `SortableHeader` (no sortable-header component exists; the CSS does).
Not used: `CurrencySummaryPopup` (F5).

## 7. Impact

| Area | Impact |
|---|---|
| `ClientsPage.tsx` | Columns, sort UI, strip, row navigation rewritten |
| `ClientsPage.test.tsx` | Rewritten: the old cases assert the name-asc default and cross-currency sums this ticket removes |
| `clientSummaryRepo.list/get` | Additive fields; per-currency paid/unpaid removed (only this page read them) |
| `listByClient` | Behaviour unchanged; it now delegates to `paymentRowsForIncome` (its 15 tests guard that) |
| Overview / Home | Untouched (MUT-8); TD-030's overview half stays open |
| i18n | New column, state and sort-hint keys; dead `clients.columns.activeProjects/received/paidIncome/unpaid`, `clients.summary.totalReceived/totalUnpaid` and `common.sort.*` keys pruned if unused elsewhere |

## 8. i18n / RTL

The new keys are in en and ar. Amount lines use `<bdi dir="ltr">`. Numeric columns use the existing `[dir="rtl"] .data-table .amount-cell` end alignment. "oldest Nd" reuses the `transactions.status.overdue`-style interpolation with its own key, so word order is the translator's.

## 9. Cost / infra

None. Offline, local Dexie, no schema or version change, no new dependency. D8 = A reuses FX rates the app already fetches for tooltips; it adds no request.

## 10. Out of scope

Dunning and reminders; Home (MUT-8); the overview totals' archived handling (TD-030 remainder); URL-synced search; ProjectsPage sort UI.
