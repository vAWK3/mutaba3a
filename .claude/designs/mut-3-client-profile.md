# Design Brief — MUT-3: The client profile is one page that answers the three questions

- **Date:** 2026-10-11
- **Ticket:** MUT-3 (epic MUT-1). Folds in the MUT-4 Payments section UI and MUT-23.
- **Parent brief:** `.claude/designs/mut-1-client-accounting-core.md` (Phase 2, approved 2026-10-08). This brief records what changed since, and the decisions specific to the page.
- **Branch / worktree:** `feature/mut-1-client-core` in `.claude/worktrees/mut-1-client-core`
- **Status:** awaiting approval

---

## 1. Problem

`src/pages/clients/ClientDetailPage.tsx` (684 lines) splits a client across four tabs — Summary, Projects, Receivables, Transactions — so none of the three questions is answerable without clicking:

1. What have I worked on for this client?
2. How much do they owe me?
3. When did they pay, and for what?

What the audit found on top of the ticket:

| # | Finding | Consequence |
|---|---|---|
| F1 | The header strip reads `summary.unpaidIncomeMinorUSD/ILS/EUR`, but `clientSummaryRepo.get()` never returns per-currency fields (only `list()` does) | Owed-now is not just small — it is **always zero** on the client page today |
| F2 | The header's money stats use `CurrencySummaryPopup`, which converts every currency to ILS and shows one sum | Violates the currency rule ("never silently summed") |
| F3 | `paymentRecordRepo.listByClient` and `usePaymentsByClient` **already exist** (commit 9c10354, 2026-10-08, with 7 repo tests) but nothing renders them | MUT-3's blocker is only the UI, which this ticket owns anyway |
| F4 | Income saved as **Received** in the income drawer writes `status: 'paid'` + `receivedAmountMinor` but **no PaymentRecord** (`IncomeDrawer.tsx:184-199`) | `listByClient` silently omits every income the user logged as already paid — likely most payments. Question 3 would be answered wrong |
| F5 | `markPaid` creates a PaymentRecord, but `useMarkIncomePaid`, `useMarkTransactionPaid`, update/delete/archive income do not invalidate `['paymentRecords']` | The Payments section would stay stale after "Mark paid" (and after deleting or retitling an entry) for the 60s staleTime. Same bug class as TD-021 |
| F6 | `listByClient` compares `paidAt` strings directly; `markPaid` without a date stores a full timestamp (`nowISO()`) | A `dateTo` of `2026-10-11` excludes a payment stored as `2026-10-11T09:00:00.000Z`. Not hit by this page (payments are unfiltered, §3 D5) but wrong for the next caller (MUT-9) |
| F7 | `useProjects(clientId)` is called and discarded (MUT-23) | Wasted query on the hottest screen |

## 2. Acceptance criteria (from MUT-3, unchanged)

- [ ] Opening a client answers all three questions with zero tab clicks and no horizontal scroll
- [ ] Owed Now is the largest number on the page, per currency, with the overdue portion distinguished
- [ ] Work list row: date, title, amount+currency, status, remaining amount when partial
- [ ] A client with no work shows an empty state with a single primary action that opens the income drawer prefilled with this client
- [ ] Project shown when set, simply absent when not
- [ ] Rows pre-shaped in `useMemo` before reaching the table
- [ ] `ClientDetailPage` tests updated and green; new tests cover the three sections and the empty state
- Guardrails: RTL (amounts stay LTR), i18n keys only, no currency mixing in any total, offline against Dexie

Plus, because this brief folds in the MUT-4 UI:

- [ ] Payments section: date, amount, "for" (entry title), notes; edit via the existing `PartialPaymentDrawer`
- [ ] Creating, editing or deleting a payment — including **Mark paid** — refreshes the Payments section and Owed Now without a manual refresh

## 3. Decisions

| # | Decision | Why | Alternative rejected |
|---|---|---|---|
| D1 | **Owed Now is computed from the client's receivables list, by one pure helper `summarizeOwedByCurrency(transactions, today)` in `src/db/aggregations.ts`.** It counts unpaid, non-deleted, non-archived income; owed = `amount − received` clamped at 0; overdue = the same on `isOverdueReceivable` rows (ADR-010/ADR-022). Returns one entry per currency with a non-zero balance, in fixed USD → ILS → EUR order | The page already fetches `useReceivables({ clientId })`; a memoised selector over it costs no query. One helper is the definition MUT-7 (index) and MUT-8 (home) will reuse, so the three screens cannot disagree the way overdue did before MUT-17 | Fixing `clientSummaryRepo.get` to return per-currency fields (F1): still no overdue split, and it counts archived rows that the page's own list hides |
| D2 | **Archived entries do not count toward Owed Now** | The work list hides archived rows (as `/income` does); a hero number that the list below cannot add up to is worse than either convention. Recorded as debt for MUT-7/8 alignment because `clientSummaryRepo`/overview totals still include archived rows | Counting archived rows |
| D3 | **`listByClient` returns payments, not just payment records**: every non-deleted PaymentRecord *plus* one row per income whose received amount is not covered by its records (income saved as Received — F4). The extra row is dated `tx.paidAt ?? tx.occurredAt`, carries the uncovered amount, and has `source: 'entry'` (records get `source: 'record'`) | Read-side reconciliation is correct for every write path, past and future, with no migration and no Dexie version bump (MUT-4 guardrail). Question 3 is otherwise answered wrong for the most common way people log a paid job | Writing a PaymentRecord on create-as-received + a v21 backfill: touches the income drawer's save path (MUT-5's area) and its received→invoiced edit path, which clears `receivedAmountMinor` but would leave records behind. Noted as the long-term fix (TD) |
| D4 | **A payment row opens what owns it**: `source: 'record'` → `editPaymentRecord({ transactionId, paymentRecordId })` (existing drawer edit mode, which also offers delete); `source: 'entry'` → the income drawer for that entry | No new drawer; delete stays behind the drawer's existing confirm | A row-level delete with a new confirm modal |
| D5 | **The filter row (date range, status, search) sits in the Work section and filters only the work list. Owed Now and Payments are never filtered** | "Owed now" is not a period figure; payments are few per client and the full history is the answer to question 3. Filters sit on the list they filter | Page-level filters that also narrow payments (confusing beside an unfiltered Owed Now) |
| D6 | **Keep the status segment** (All / Paid / Unpaid / Overdue) on the work list | It is how the old Receivables tab's job survives: "Unpaid" or "Overdue" is one click instead of a tab | Dropping it (the ticket only says *keep* date range and search) |
| D7 | **Removed from the page:** the four tabs, the stats strip (active projects, paid income, unpaid, expenses), Recent activity, the Projects table, expense rows, `useProjectSummaries`, `useClientSummary`, `useProjects` (MUT-23) | None answers one of the three questions; expenses are optional (minimize decision 3) and live in the gated ledger | Keeping a secondary stats row |
| D8 | **Project is a tag inside the "What" cell**, a link to the project page while Projects is on and plain text while off (MUT-16 behaviour preserved). No tag when unset | "Project becomes a column/tag"; a tag avoids an empty-looking column for the many entries without one | A Project column |
| D9 | **Empty states:** no income at all (default filters, empty list) → `EmptyState` with one primary action, *Add income*, which opens `openIncomeDrawer({ mode: 'create', defaultClientId })`. Filters that match nothing → "No entries match" with *Clear filters*, no add action | AC #4; and a filtered-empty list must not claim the client has no work | One empty state for both |
| D10 | **Section components:** `OwedNowSummary` (presentational, `src/components/clients/`, reusable by MUT-8 home), `ClientWorkSection`, `ClientPaymentsSection` (same folder as `ClientRetainersCard`). Row shaping lives in `src/components/clients/clientProfileRows.ts` as pure functions | Page drops from 684 to ~120 lines; pure shaping is unit-testable at 100% | Keep one 600-line page file |
| D11 | **Invalidation (F5):** `useQueries.ts`, which owns the payment-record keys, exports `invalidatePaymentRecordLists(queryClient)`; `invalidateTransactionQueries` and `invalidateIncomeQueries` both call it | Follows TD-021's recorded precedent: the key list lives in the module that owns the keys, not a new file | Adding the key literal in two places |
| D12 | **Date filter compares calendar dates (F6):** `listByClient` compares `paidAt.slice(0, 10)` against `dateFrom`/`dateTo` | Matches the documented contract ("inclusive, YYYY-MM-DD or ISO") | Leave it for MUT-9 |
| D13 | **Filter state is one object in `useState`**, not the URL | Same as `/income` and the page today; URL sync for the profile is not in any AC | Route `validateSearch` for `/clients/$clientId` |

## 4. Layout

```
TopBar: Clients › Acme Corp                                   [Edit]
┌ header card ──────────────────────────────────────────────────────┐
│ contact@acme.com · +1 234 567 890            (notes, if any)      │
│                                                                   │
│ OWED NOW                                                          │
│ $1,500            ₪4,200                    ← largest text, LTR   │
│ $500 overdue      Nothing overdue           ← danger / muted      │
└───────────────────────────────────────────────────────────────────┘
Work and billing                         [+ Project]  [+ Add income]
[All time ▾]  [All|Paid|Unpaid|Overdue]  [Search…]
 Date    What                     Amount         Status           ⋯
 Oct 1   Homepage  [Website]      $500           Partial (40%)    [Record payment $300] ⋮
                                  Remaining $300  Due in 4d
 Sep 12  Logo                     $200           Paid                                 ⋮
Payments
 Date    Amount     For            Notes
 Oct 5   $200       Homepage       wire
 Sep 14  $200       Logo           Recorded on the entry
(Retainers card — only while Retainers is on)
```

When nothing is owed the hero reads **Nothing owed** in the same slot. Five work columns and four payment columns fit the 1024px desktop minimum without horizontal scroll; the "What" cell truncates with an ellipsis.

## 5. API contracts and error states

```ts
// src/db/aggregations.ts
summarizeOwedByCurrency(transactions: Transaction[], today: string): OwedByCurrency[]
OwedByCurrency = { currency: Currency; owedMinor: number; overdueMinor: number }
  // only currencies with owedMinor > 0; order USD, ILS, EUR; never throws; [] when nothing owed

// src/types/index.ts — PaymentByClientRow gains:
source: 'record' | 'entry'
  // 'entry' rows: id = `entry:${transactionId}`, notes undefined

// src/db/repository.ts — listByClient(clientId, filters?) contract (D3, D12)
  every non-deleted PaymentRecord of the client's non-deleted income
  + one 'entry' row per income where effectiveReceived − Σrecords > 0
      effectiveReceived = status === 'paid' ? amountMinor : (receivedAmountMinor ?? 0)
  dateFrom/dateTo inclusive on the calendar date of paidAt
  unknown client / no payments → []   (never throws)

// src/hooks/useQueries.ts
export function invalidatePaymentRecordLists(queryClient): void   // ['paymentRecords'] prefix

// src/components/clients/clientProfileRows.ts
toWorkRow(tx: TransactionDisplay, today: string): WorkRow
WorkRow = { id, tx, date, title?, projectId?, projectName?, amountMinor, currency,
            paymentStatus, remainingMinor?  /* only when partial */,
            overdueDays?, dueInDays?, isReceivable }
```

Error states: loading → existing spinner; client not found → existing empty state; a query error in a section leaves the rest of the page usable (sections render their own empty state from `data ?? []`). No new thrown errors.

## 6. Reuse analysis (COMPONENT_REGISTRY)

Reused unchanged: `TopBar`, `DateRangeControl`, `StatusSegment`, `SearchInput`, `PaymentStatusBadge`, `AmountWithConversion`, `RecordPaymentButton`, `RowActionsMenu`, `EmptyState`, `ClientRetainersCard`, `PartialPaymentDrawer` (via `openPartialPaymentDrawer` / `editPaymentRecord`), `IncomeDrawer` (via `openIncomeDrawer`), `useReceivables`, `useIncome`, `usePaymentsByClient`, `isOverdueReceivable` / `daysOverdue` / `daysUntilDue`, `accumulateIncomeAmount`.

New: `summarizeOwedByCurrency` (no equivalent — `aggregateTransactionTotalsByCurrency` has no overdue split and counts archived), `OwedNowSummary` (no per-currency hero exists: `KpiCard`, `CurrencySummaryPopup` and `UnifiedAmount` all convert to ILS), `ClientWorkSection`, `ClientPaymentsSection`, `clientProfileRows.ts`.

Not used: `CurrencySummaryPopup` (F2), `InlineStats`, `useClientSummary`, `useProjectSummaries`.

## 7. Impact

| Area | Impact |
|---|---|
| `ClientDetailPage.tsx` | Rewritten as a composition of three sections; tab state gone |
| `ClientDetailPage.test.tsx` | Tab/stats tests replaced; MUT-6 / MUT-13 / MUT-16 behaviours re-asserted on the new sections |
| `listByClient` + `PaymentByClientRow` | Additive field and rows; existing 7 repo tests stay green (they use unpaid income) |
| Hooks | Every transaction/income write now also refreshes payment lists (also fixes the `PartialPaymentDrawer` history going stale after Mark paid) |
| `clientSummaryRepo`, `ClientsPage`, `OverviewPage` | Untouched (MUT-7 / MUT-8) |
| i18n | New `clients.profile.*` keys in `en.json` + `ar.json`; tab/stats keys that become unused are pruned |
| CSS | Small block in `src/index.css` for the hero, the section headers and the project tag, using existing tokens; RTL amounts isolated LTR |
| Jira | MUT-4: comment that its UI ships here; MUT-23: comment that the removal ships here |

## 8. i18n / l10n

- New keys under `clients.profile` (owed now, nothing owed, `{amount} overdue`, nothing overdue, work section title/columns/empty/no-match, payments title/columns, "Recorded on the entry", "Open income entry"). Reused: `transactions.partialPayment.remaining`, `.noPayments`, `.editPayment`, `.notes`, `transactions.columns.*`, `filters.*`, `drawer.income.title`.
- Amounts render inside `<bdi dir="ltr">` / `unicode-bidi: isolate` so `$1,500` stays LTR in Arabic; table amount alignment uses the existing `[dir="rtl"] .amount-cell` rule.
- Dates via `formatDate(…, locale)`; RTL checked in the browser in Arabic.

## 9. Cost / infra

None. Offline, local Dexie, no new dependency, no schema version bump, no network.

## 10. Out of scope (recorded, not done)

- Writing a PaymentRecord when income is saved as Received (D3 long-term fix) — TD
- `clientSummaryRepo` / overview totals counting archived rows — TD, for MUT-7/8 to align on `summarizeOwedByCurrency`
- `lastPaymentAt` ignoring partial and backdated payments (parent brief D6) — MUT-7
- URL-synced profile filters (D13)
- Statement export (MUT-9)
