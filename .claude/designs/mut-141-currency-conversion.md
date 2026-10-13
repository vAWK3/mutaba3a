# MUT-141 — Log currency conversion events (no balance tracking, no fund-tracing)

> **Status:** Draft plan, pending user approval
> **Date:** 2026-10-13
> **Jira:** MUT-141 (Story, Backlog)
> **Blocked by:** MUT-140 (JOD + per-currency decimal precision) — shows "In Review" in
> Jira but is confirmed merged to local main (`3c8c9f7 Merge branch
> 'feat/mut-140-jod-currency'`, per the known Jira-status-lag pattern). Treated as resolved.
> **Relates to:** MUT-142 (swipe-to-change-currency on capture amount display) — checked,
> nothing has landed or branched for it yet, so there is no real conflict today. Re-check
> `git log`/`git branch -a` immediately before starting build in case it lands first; its
> likely collision surface would be `src/lib/utils.ts` (`amountInputCurrency`) and
> `src/lib/paymentEntry.ts` (`minorToAmountInput`), both reused below.
> **Revision note:** the first draft of this plan assumed the ticket's "Transactions
> ledger" existed as a unified, live page (per CLAUDE.md's spec and the ticket's own
> text). `gstack`'s project-learnings cache flagged that `TransactionsPage.tsx` is dead
> code before any implementation started — confirmed by reading `router.tsx` directly.
> Section "Ground-truth findings" item 6 below reflects the corrected architecture;
> the UI-surface decision (new dedicated page vs. other options) was confirmed with
> Basel before finalizing this plan.

---

## Ground-truth findings (read the code before planning the code)

1. **The ticket's own premise — "excluded from all P&L by construction" — is not true today.**
   Every aggregation function that separates income from expenses uses an `if (kind ===
   'income') {...} else {...}` shape, where the `else` branch unconditionally treats
   *anything that isn't income* as an expense. A new `kind: 'conversion'` would silently
   fall into that `else` branch and inflate expense totals everywhere. Confirmed exact
   locations:
   - `src/db/aggregations.ts:308-313` (`aggregateTransactionTotals`)
   - `src/db/aggregations.ts:338-348` (`aggregateTransactionTotalsByCurrency`)
   - `src/db/aggregations.ts:365-368` (`aggregateTransactionTotalsWithActivity`)
   - `src/lib/aggregations.ts:284-293` (`calculateForecastKPIs`)
   - `src/lib/aggregations.ts:391-399` (`calculateMonthActuals`)

   One function already does it safely with a strict check: `src/lib/aggregations.ts:478-481`
   (`calculateDailyBalances`) uses `else if (tx.kind === 'expense')` — this is the pattern
   to replicate everywhere else, not a new pattern to invent.

   This `else`-as-"not income" shape is not an accident to "clean up" — **ADR-062**
   (`.claude/DECISIONS.md:2593`) explicitly documents that `kind !== 'income'` rows from
   `db.transactions` are still summed as expenses on purpose, because demo seed data and
   CSV import still write legacy `kind:'expense'` transaction rows (real expenses have
   lived in `db.expenses` since MUT-14; TD-105/MUT-138 is the tracked follow-up for that
   split). **So the fix must be surgical** — tighten the 5 `else` branches to `else if
   (tx.kind === 'expense')` (matching the one function that already does this), not
   remove the branch or restructure the function. This is additive-safe: it changes
   behavior only for the new `'conversion'` kind; every existing `'income'`/`'expense'`
   call site is untouched.

   `src/lib/aggregations.ts:555` (`if (tx.kind !== 'income') return false`) is a
   receivables-only filter — already safe, a conversion row correctly returns `false`
   here with no change needed.

   Every real totals reader (`getOverviewTotals`, `getOverviewTotalsByCurrency`,
   `projectSummaryRepo.list`/`get`, client summary) in `src/db/repository.ts` funnels
   through one of the three `db/aggregations.ts` functions above — fixing those three
   closes every reader in one place, no call-site changes needed there.

2. **No Dexie schema version bump needed.** Checked how MUT-140 added JOD: it didn't
   touch `src/db/database.ts` at all, because `Currency`/`kind` are plain string-valued
   indexed fields in Dexie — new union members don't require a `.stores()` change. The
   same applies here:
   - `kind: 'conversion'` is a new value for an *already-indexed* field
     (`transactions: 'id, kind, status, ...'`, `src/db/database.ts:805`) — Dexie doesn't
     type-constrain index values, so no version bump is needed for the new kind itself.
   - `toCurrency`/`toAmountMinor` are brand-new, **unindexed** optional fields — the
     closest precedent is v14's `receivedAmountMinor` (`src/db/database.ts:615-674`),
     added as an unindexed optional field with no index-string change. The difference:
     v14 needed a `.upgrade()` backfill because it retrofitted meaning onto *existing*
     rows; conversion rows are entirely new going forward, so **no backfill, no
     `.upgrade()`, no version bump at all** — just add the two fields to the
     `Transaction` TypeScript interface and start writing them.
   - Current max version is 21 (`src/db/database.ts:932`, MUT-73). This plan adds no v22.

3. **No single `TransactionDrawer` or URL-param drawer state exists** (CLAUDE.md's
   `?tx=`/`?newTx=` spec is aspirational, not implemented — confirmed by grepping for
   `newTx`/`searchParams.get('tx')`, zero hits). The real pattern: one Zustand-backed
   drawer per kind, mounted globally in `AppShell.tsx`, each with its own `isOpen`/`mode`
   slice in `useDrawerStore` (`src/lib/stores.ts`). `IncomeDrawer` and `ExpenseDrawer`
   are the two siblings to follow; a `ConversionDrawer` is a **third sibling**, not a
   branch inside an existing drawer — conversions have a two-currency shape neither
   existing drawer's form can represent without a confusing conditional UI.

4. **Currency-aware amount parsing/formatting from MUT-140 is directly reusable, twice
   per form** (once per currency side):
   - `src/lib/utils.ts`: `CURRENCY_EXPONENT` (`JOD: 3`, others `2`), `parseAmountInput(value,
     { currency, maxDecimals? })` (currency is a **required** param by design — ADR from
     MUT-140 — so there is no silent-rounding footgun), `amountInputCurrency(value)`.
   - `src/lib/paymentEntry.ts:44-55`: `minorToAmountInput(amountMinor, currency)` for
     edit-mode prefill.
   - No existing drawer validates **two independent amount+currency pairs** in one form —
     `IncomeDrawer`/`ExpenseDrawer`'s Zod `.superRefine()` cross-field pattern
     (`src/components/drawers/incomeFormSchema.ts:30-39`,
     `expenseDrawerFormSchema.ts:29-39`) needs to run twice, once per side, in the new
     `conversionFormSchema.ts`. This is new ground but mechanically identical — not a new
     pattern, two applications of the existing one.

5. **`TxStatus` (`'paid' | 'unpaid'`) doesn't have a natural meaning for a conversion** —
   there's no due date, no partial payment, no "unpaid" conversion. Rather than widen
   `TxStatus` (which would force every `status === 'paid'`/`'unpaid'` switch in the
   codebase to consider a third value it doesn't expect), **conversions are always
   created with `status: 'paid'`, hardcoded, not user-facing.** This keeps `TxStatus`
   untouched.

6. **There is no live "Transactions ledger" to add a row to — the ticket's own premise
   is stale, confirmed by reading `router.tsx` directly, not assumed from CLAUDE.md:**
   - `/transactions` is a pure redirect to `/income` (`router.tsx:67-75`).
   - `TransactionsPage.tsx`, `TransactionTypeBadge.tsx`'s usage in it, and
     `TypeSegment.tsx` (the All/Income/Receivable/Expense filter) have **zero live
     callers** — `TransactionsPage.tsx` is imported only by itself and by
     `useTransactionFilters.ts` (also only used there), and `TypeSegment` is imported
     only by `TransactionsPage.tsx`. This matches a project-learnings pitfall already on
     record: *"Two documents-era surfaces are dead but still tested/edited:
     ImportDataModal.tsx and TransactionsPage.tsx ... Check for a renderer/route before
     editing a page or modal."*
   - Since MUT-5/MUT-83/MUT-14, Income and Expenses are **two separate, dedicated,
     purpose-built pages reading different tables**: `/income` → `IncomePage.tsx` (reads
     `db.transactions` filtered to `kind: 'income'` via `useIncome`), `/expenses` →
     `ExpensesLedgerPage.tsx` (reads `db.expenses`, a different table entirely, gated
     behind `requireFeature('expenses')`). Neither page is a generic "all transactions"
     view, and a `'conversion'` row doesn't belong in either — `IncomePage`'s query hook
     is income-only by construction, and `ExpensesLedgerPage` doesn't read
     `db.transactions` for real data at all.
   - **Decision (confirmed with Basel):** conversions get their **own new dedicated
     page**, `/conversions`, mirroring the Income/Expenses split-by-kind pattern already
     established, rather than reviving the dead unified-ledger code or cramming a new
     row shape into an existing single-purpose page.

7. **The sidebar nav has exactly two tiers, and a new page must pick one — this forces a
   feature-flag decision, not a style preference:**
   - `coreItems` (`src/components/layout/SidebarNav.tsx:60-64`) is a hardcoded,
     explicitly-frozen 3-item array (Home/Clients/Income) — ADR-034/MUT-15 is explicit
     that nothing may move or extend this list.
   - `optionalItems` (lines 68-75) is the only other place a nav entry can live, and
     every entry there requires a `FeatureKey` (`src/types/index.ts`) gating it —
     Expenses, Documents, Retainers, Insights, Planning, Projects all follow this.
   - **There is no third "ungated but not core" nav slot.** So `/conversions` showing up
     in the sidebar at all means adding a 7th `FeatureKey` (`'conversions'`), following
     the exact MUT-12 pattern (`src/lib/features/features.ts`), not a new mechanism.
   - This is cheaper than it looks: `FEATURE_DATA_PROBES` (`features.ts:100-109`)
     already has a `[]` ("owns no data of its own, never auto-enabled") precedent —
     `insights` uses it. **Conversions qualifies for the same empty-probe treatment**,
     for a stronger reason than insights: this is a brand-new `kind` value that cannot
     exist in any pre-upgrade database, so there is no "existing data would be hidden
     behind an off toggle" risk to guard against at all (the exact risk the probe
     mechanism exists for). No new migration, no `.upgrade()` callback, no probe-reading
     code — just `conversions: []` alongside `insights: []`.
   - `AdvancedFeaturesSection.tsx` (Settings) renders its toggle list by mapping
     `FEATURE_KEYS` (`FEATURE_KEYS.map(...)`, line 41) — adding the key to that array is
     the entire Settings-UI change; no new component.
   - `migration-v20.test.ts`'s assertions use `{ ...DEFAULT_FEATURES, invoices: true,
     projects: true }` (spread, not a hardcoded literal) — confirmed this test needs no
     change; `DEFAULT_FEATURES` picks up the new key automatically with everyone
     defaulting to `false`.
   - This also reverses a call made in the first draft of this plan, which proposed an
     *always-visible*, non-gated Add-menu entry — that's not actually available as an
     option once the nav-tier constraint above is accounted for.

8. **Data access needs no repository changes at all.** `transactionRepo.list(filters)`
   (`src/db/repository.ts:212`) already takes a generic `filters.kind` (line 233:
   `if (filters.kind && tx.kind !== filters.kind) return false`) and its row-mapping
   (`return { ...tx, clientName, projectName, categoryName, ... }`, line 303) spreads the
   full raw `Transaction`, so once `toCurrency`/`toAmountMinor` exist on the type they
   flow through to `TransactionDisplay` automatically. `transactionRepo.list({ kind:
   'conversion', profileId, dateFrom, dateTo })` is a complete, ready-to-use query for
   the new page — only a thin React Query hook wrapper is needed (mirroring
   `useExpenseQueries.ts`'s `expenseQueryKeys` pattern), not new repo logic.

9. **Currency-aware amount parsing/formatting from MUT-140 is directly reusable, twice
   per form** (once per currency side) — see finding 4 above; unchanged by the UI-surface
   revision.

10. **Row-level UI components need a third branch, not a new abstraction, for the two
    spots a conversion row actually touches** (both now inside the *new* page, not
    `TransactionsPage.tsx`):
    - A ledger row showing **two amounts** (from → to), not one amount with an FX
      tooltip — `AmountWithConversion` (`src/components/ui/AmountWithConversion.tsx`)
      is built for a single amount with a hover-converted value and doesn't fit; a
      small inline two-span cell local to the new page is simplest (exactly one caller,
      so no shared component is warranted — same "enough engineering" call as the first
      draft made for `TransactionsPage.tsx`, just relocated).
    - `RowActionsMenu` (`src/components/ui/RowActionsMenu.tsx`) is fully generic
      (`actions: RowAction[]`, no kind-awareness baked in) — reused as-is for
      edit/duplicate/delete on conversion rows, same as `IncomePage`/
      `ExpensesLedgerPage` already do.
    - `TransactionTypeBadge`/`TransactionStatusCell`/`TypeSegment` are **not reused** —
      they only ever had one caller (the dead `TransactionsPage.tsx`) and the new page
      doesn't need a type badge (every row on `/conversions` is, definitionally, a
      conversion) or a status cell (finding 5: status is always `'paid'`, never shown).

11. **CSV export/import touches four files, two of which have duplicated logic** (a
   pre-existing seam, not something this ticket should try to fix). This is unaffected
   by the UI-surface revision — CSV is a data-shape concern, not a page concern:
   - `src/utils/csv.ts`: `TRANSACTION_COLUMNS` (line 98-115, full-table backup export,
     used only by `DeleteAllDataModal`) and `IMPORT_TEMPLATE_COLUMNS` (line 118-134, the
     unified clients/projects/income/expense CSV template) both need `toCurrency`/
     `toAmount` columns added; `exportDataToCSV` (line 420-521) needs its `kind` type
     widened and the new columns populated for conversion rows.
   - `src/utils/csvValidation.ts`: `VALID_TYPES` (line 17) needs `'conversion'`; the
     `switch(type)` (line 49-62) needs a `case 'conversion': validateConversion(row,
     errors)`, mirroring `validateIncome`/`validateExpense` (lines 122-166) but also
     requiring `toCurrency`/`toAmount`.
   - **Import write paths are duplicated in two files** — `ImportDataModal.tsx` (lines
     201-317) and `ImportDataPage.tsx` (lines 168-272) — both need the same new
     `conversionRows`/`r.type === 'conversion'` branch writing `kind: 'conversion'` with
     the new fields. Per the same project-learnings pitfall cited in finding 6,
     `ImportDataModal.tsx` is **also dead code** (only reachable from its own test),
     with `ImportDataPage.tsx` at `/settings/import` the live import path — **this plan
     only touches `ImportDataPage.tsx`**, not `ImportDataModal.tsx` (confirm MUT-145's
     status before building in case it has deleted the dead modal by then — either way,
     nothing in this ticket depends on it).

12. **The global `+ Add` menu (`src/components/layout/addMenuActions.ts`) is a closed,
    explicit list** (`AddMenuAction = 'income' | 'client' | 'expense' | 'project'`,
    `ADD_MENU_ACTIONS` array) with optional feature-flag gating per entry. Per finding 7,
    `'conversion'` is gated the same way `'expense'`/`'project'` are — `{ action:
    'conversion', feature: 'conversions' }`.

---

## File-level plan

### 1. `src/types/index.ts`
- `TxKind = 'income' | 'expense' | 'conversion'`.
- `Transaction` interface: add `toCurrency?: Currency` and `toAmountMinor?: number`
  (both optional — only set on `kind: 'conversion'` rows; never read for
  income/expense rows).
- `FeatureKey`: add `'conversions'`.

### 2. `src/db/aggregations.ts`
- `aggregateTransactionTotals`, `aggregateTransactionTotalsByCurrency`,
  `aggregateTransactionTotalsWithActivity`: change the bare `else { expensesMinor +=
  ... }` to `else if (tx.kind === 'expense') { expensesMinor += ... }` in all three
  (lines 312, 342, 368). A `'conversion'` row now contributes to neither bucket.

### 3. `src/lib/aggregations.ts`
- `calculateForecastKPIs` (line 284-293) and `calculateMonthActuals` (line 391-399):
  same `else` → `else if (tx.kind === 'expense')` tightening.
- `calculateDailyBalances` (line 478-481): no change, already correct.
- Line 555 (`tx.kind !== 'income'`): no change, already correct.

### 4. `src/lib/features/features.ts`
- `FEATURE_KEYS`: add `'conversions'`.
- `FEATURE_DATA_PROBES`: add `conversions: []` (never auto-enabled by data — finding 7).

### 5. `src/components/drawers/conversionFormSchema.ts` (new file)
- Zod object: `fromCurrency`, `fromAmount` (string input), `toCurrency`, `toAmount`
  (string input), `occurredAt` (date), `notes?`.
- `.superRefine()` validates `fromAmount` against `fromCurrency`'s exponent and
  `toAmount` against `toCurrency`'s exponent independently, via two calls to
  `parseAmountInput`, mirroring `expenseDrawerFormSchema.ts:29-39`.
- Cross-field rule: `fromCurrency !== toCurrency` (converting a currency to itself is
  not a conversion) — reject with a field error if equal.
- Implied rate is **derived for display only**, not stored or validated as a field —
  see the open scope question below.

### 6. `src/components/drawers/ConversionDrawer.tsx` (new file)
- New sibling drawer, same shape as `IncomeDrawer.tsx`/`ExpenseDrawer.tsx`: mode
  create/edit, fields for from-amount/currency, to-amount/currency, date, optional
  note.
- Implied exchange rate: computed read-only from the two amounts
  (`toAmountMajor / fromAmountMajor`, using each currency's own exponent from
  `CURRENCY_EXPONENT` to go from minor to major), displayed below the two amount
  fields, recalculated on every keystroke in either amount field. Not an editable
  field, not persisted as a separate stored value.
- On submit: writes `kind: 'conversion'`, `status: 'paid'` (hardcoded, not shown in
  the form — see finding 5), `currency`/`amountMinor` = from-side,
  `toCurrency`/`toAmountMinor` = to-side, via the existing `transactionRepo.create`/
  `update`.
- No category field, no client/project field (ticket scope: date + two
  currency/amount pairs + optional note only).

### 7. `src/lib/stores.ts`
- New `conversionDrawer: { isOpen, mode, transactionId? }` slice +
  `openConversionDrawer`/`closeConversionDrawer`, mirroring `expenseDrawer`'s shape
  (simplest of the existing drawers — no prefill data, no recurring flag needed).

### 8. `src/components/layout/AppShell.tsx`
- Import and mount `<ConversionDrawer />` alongside the other drawers (same
  `InlineErrorBoundary`-wrapped pattern as lines 122-151), gated on
  `conversionDrawer.isOpen`.

### 9. `src/components/layout/addMenuActions.ts`
- `AddMenuAction` → add `'conversion'`.
- `ADD_MENU_ACTIONS` → add `{ action: 'conversion', feature: 'conversions' }`, placed
  after `'expense'` so money-movement actions stay grouped before `'project'`.

### 10. `src/hooks/useAddMenuActions.ts`
- Add `openConversionDrawer` wiring + a `conversion` entry in `pickers`, mirroring
  `expense`'s `useProfileAwareAction` block exactly (profile-aware, sets working
  profile on execute).

### 11. `src/components/layout/SidebarNav.tsx`
- `optionalItems`: add `{ path: '/conversions', labelKey: 'nav.conversions', icon:
  <new or reused icon>, feature: 'conversions' }`.
- `newMenuEntries`: add a `conversion` entry (labelKey + icon), same shape as the
  existing four.

### 12. `src/router.tsx`
- New `conversionsRoute`: `path: '/conversions'`, `beforeLoad:
  requireFeature('conversions')`, `component: lazyPage(() => import('./pages/conversions'),
  'ConversionsPage')`, mirroring the `expensesRoute` block (lines 192-198).

### 13. `src/pages/conversions/ConversionsPage.tsx` (new file) + `src/pages/conversions/index.ts`
- New page, modeled on `ExpensesLedgerPage.tsx`'s simpler single-view shape (no
  grouping/tabs needed — `IncomePage`'s status-tab complexity doesn't apply here,
  conversions have no status).
- `TopBar` + `DateRangeControl` + `SearchInput` (search over `notes`, reusing the
  existing search convention) + a hand-rolled `<table>` (same "no generic DataTable
  exists yet" reality as the rest of the app) with columns: date, from-amount+currency,
  arrow, to-amount+currency, implied rate, note, row actions.
- Data: `useConversions(filters)` hook (new, see file 14) wrapping
  `transactionRepo.list({ kind: 'conversion', ...filters })` — no new repo code
  (finding 8).
- Row click / "Add conversion" button → `openConversionDrawer({ mode: 'edit'/'create',
  transactionId })`.
- Empty state: reuse `EmptyState` component, same as other ledgers.

### 14. `src/hooks/useConversionQueries.ts` (new file)
- `conversionQueryKeys.conversions(filters)` + `useConversions(filters)` (React Query
  wrapper over `transactionRepo.list`) + `useCreateConversion`/`useUpdateConversion`/
  `useDeleteConversion` mutations (wrapping `transactionRepo.create`/`update`/`delete`),
  mirroring `useExpenseQueries.ts`'s query-key/invalidation shape exactly, scoped to
  `kind: 'conversion'` transactions only — not a generic transactions hook.

### 15. `src/utils/csv.ts`
- `TRANSACTION_COLUMNS` and `IMPORT_TEMPLATE_COLUMNS`: add `toCurrency`, `toAmount`
  columns.
- `exportDataToCSV`: widen the `transactions` param's `kind` type to include
  `'conversion'`; row-building adds `toCurrency: tx.toCurrency`, `toAmount:
  tx.toAmountMinor ? amountMinorToMajorString(tx.toAmountMinor, tx.toCurrency) :
  undefined`.

### 16. `src/utils/csvValidation.ts`
- `VALID_TYPES`: add `'conversion'`.
- New `validateConversion(row, errors)`, mirroring `validateIncome`/
  `validateExpense` (amount/currency/date required) plus requiring `toAmount`/
  `toCurrency`, and the same `fromCurrency !== toCurrency` check as the drawer schema
  (defense in depth — CSV import bypasses the Zod form schema entirely).

### 17. `src/pages/settings/ImportDataPage.tsx`
- Add a `conversionRows`/`r.type === 'conversion'` filter + write branch, mirroring
  the existing income/expense branches, writing `kind: 'conversion'`,
  `toCurrency`/`toAmountMinor` parsed from the new columns. `ImportDataModal.tsx` is
  dead code (finding 11) — not touched.

### 18. i18n — `src/lib/i18n/translations/en.json` and `ar.json`
- `nav.conversions`, `nav.newMenu.conversion` (mirrors the existing `nav.*` block).
- `settings.features.items.conversions.label`/`.description` (auto-picked-up by
  `AdvancedFeaturesSection`'s `FEATURE_KEYS.map`).
- Drawer field labels (from-amount, from-currency, to-amount, to-currency,
  implied-rate label, date, note) and drawer title (mirrors `transactions.newIncome`/
  `newExpense` pattern).
- Mirror every new key in `ar.json` in the same structural position.

### 19. Tests (TDD — write first)
- `src/db/__tests__/aggregations.test.ts`: a `'conversion'` transaction contributes
  `0` to `paidIncomeMinor`/`unpaidIncomeMinor`/`expensesMinor` in all three functions
  patched in file 2 — this is the regression gate for the ticket's core acceptance
  criterion ("never appear in Income/Expense totals anywhere").
- `src/lib/__tests__/aggregations.test.ts`: same exclusion assertion for
  `calculateForecastKPIs`/`calculateMonthActuals`.
- `src/db/__tests__/migration-v20.test.ts`: confirm existing assertions still pass
  unchanged (spread-based, finding 7) — no new test needed here, just a regression run.
- `src/components/drawers/__tests__/conversionFormSchema.test.ts` (new, mirrors
  `ExpenseDrawer.schema.test.ts`): valid two-currency conversion parses; mismatched
  decimal precision per currency rejected (JOD 3dp vs USD 2dp, independently, on
  each side); same from/to currency rejected.
- `src/components/__tests__/ConversionDrawer.test.tsx` (new, mirrors
  `IncomeDrawer.test.tsx` shape): create flow writes a `kind:'conversion'` row with
  both currency pairs; implied rate displays and updates live; edit flow loads and
  re-saves correctly.
- `src/pages/conversions/__tests__/ConversionsPage.test.tsx` (new): empty state;
  renders from→to amounts correctly per row; date-range/search filtering; row click
  opens edit drawer; feature-flag-gated route redirects when off (mirror
  `ExpensesLedgerPage.test.tsx`'s gating test if one exists).
- `src/utils/__tests__/csv.test.ts` / `csvValidation.test.ts`: conversion row
  round-trips export→import; missing `toCurrency`/`toAmount` rejected; same
  from/to-currency rejected.

---

## Open scope question for confirmation before build

The ticket's "Scope (out)" explicitly defers manual FX rate configuration /
"All Converted" reporting — but doesn't say whether a logged conversion's **implied
rate** should ever be surfaced outside the drawer/ledger row (e.g. a "last known
JOD→USD rate" hint shown elsewhere). This plan treats the implied rate as local to
the drawer and the `/conversions` row, read-only, and not persisted as a separate
value or surfaced anywhere else — matching the ticket's explicit note that "this
feature's captured real rates could feed that later" (future work, not this ticket).

---

## Quality bar

- **DRY/reuse**: no new shared abstraction invented beyond what the nav-tier
  constraint requires (the 7th feature flag — finding 7, which reuses the exact
  MUT-12 pattern rather than inventing one). Reuses `CURRENCY_EXPONENT`/
  `parseAmountInput`/`minorToAmountInput` from MUT-140 unchanged; reuses the
  Zod-`superRefine` cross-field pattern already established by `IncomeDrawer`/
  `ExpenseDrawer`, applied twice; reuses `transactionRepo.list`'s existing generic
  `kind` filter with zero repository changes (finding 8); reuses `RowActionsMenu`
  and `EmptyState` as-is. The new two-amount ledger cell has exactly one caller, so
  it's written inline rather than extracted.
- **Testable**: the P&L-exclusion behavior (the ticket's core acceptance criterion)
  is pure-function arithmetic in already-unit-tested files — no UI, no network, no
  DB needed to prove it. Drawer/schema/page logic follows the exact test shape
  already established for `ExpenseDrawer`/`IncomeDrawer`/`ExpensesLedgerPage`.
- **Scalable**: no new Dexie index, no new table, no migration/backfill (finding 2) —
  zero data-shape risk at scale. CSV columns grow by two; no new per-row computed
  cost. The new page's query is bounded by the existing date-range filter, same as
  every other ledger.
- **Cost-effective**: zero new dependencies, zero new network/API calls — this is a
  purely local, offline-first feature matching the rest of the app.
- **Constraints honored**: CLAUDE.md's currency rules ("always store original amount
  + currency", "reports are per-currency by default") are upheld — a conversion row
  stores both legs' original amounts/currencies and never gets converted/blended into
  a report total. i18n: every new label goes through the existing `useT()`/
  `en.json`/`ar.json` pattern, RTL untouched. Feature-gating follows the established
  optional-area convention exactly (same `requireFeature`/Settings-toggle/nav-item
  triad as Expenses/Projects/etc.).

---

## Business / product impact

- Closes a real, already-confirmed pain point ("it costs me money and confusion,
  this bites me") for freelancers who hold multiple currencies and periodically move
  money between them (e.g. JOD→USD) — without this, that movement either goes
  unrecorded or gets miscategorized as a fake expense/income, corrupting the exact
  P&L totals this app's "honest conversions" principle (CLAUDE.md) exists to protect.
- Sits directly after MUT-140 in the same office-hours-driven currency-accuracy track;
  unblocks nothing downstream by itself, but its captured real conversion rates are
  explicitly intended to feed a future manual-FX-rate / "All Converted" reporting
  feature (pre-existing spec gap, tracked separately) without rework.
- Low risk, high-confidence surface: every aggregation fix is a one-line tightening
  of an existing conditional, verified against ADR-062's documented legacy-expense
  carve-out so the fix cannot regress real expense totals for existing data. The
  UI surface reuses an established, repeated pattern (dedicated page + feature flag,
  as already shipped three times for Expenses/Retainers/Projects) rather than
  resurrecting dead code, so the new page carries no inherited tech debt.
