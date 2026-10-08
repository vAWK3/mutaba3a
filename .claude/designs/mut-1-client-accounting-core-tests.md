# Test Plan — MUT-1: Client accounting core

- **Date:** 2026-10-08
- **Companion:** `.claude/designs/mut-1-client-accounting-core.md`
- **Framework:** Vitest 4 + jsdom + fake-indexeddb; TZ pinned `Asia/Jerusalem` (`vitest.config.ts:12`)
- **Commands:** `npx vitest run <path>` (scoped) · `npx vitest run` (full) · `npm run test:tz` (date-sensitive) · `npx tsc -b` · `npm run lint`

## Baseline (2026-10-08)

| Check | Result |
|---|---|
| `npx tsc -b` | green |
| `npm run lint` | 88 errors, 24 warnings |
| `npx vitest run` | 2011 passed, 21 failed, 7 skipped (101 files) |

Known failures in scope: **MUT-19** = 3 (IncomeDrawer), **MUT-22** = lint.
Known failures deferred: **MUT-20** = 18 (ExpensesLedgerPage) — documented debt, suite green otherwise.

---

## Phase 0 — Hygiene

### MUT-19 `src/components/__tests__/IncomeDrawer.test.tsx`
- [ ] `should show clients in dropdown when available` (`:296`) — open the typeahead (focus/type) before asserting option text; `EntityTypeypeahead` only renders options when `isOpen`
- [ ] `should show projects filtered by selected client` (`:311`) — same interaction fix; assert actual project filtering, not just the client name
- [ ] `should clear paidAt and receivedAmountMinor when changing from received to invoiced` (`:362`) — align assertion with Dexie behaviour (keys written as `undefined` are deleted → `toBeUndefined()`), or normalize write to `null`; pick one, note in DECISIONS
- [ ] All 14 tests in file green (1 previously `it.skip` at `:329` stays skipped — tracked separately)

### MUT-22 lint
- [ ] `npm run lint` → **0 errors** (warnings may remain: 7× `react-hooks/incompatible-library` etc.)
- [ ] Heavy hitters: `ProjectDetailPage.test.tsx` (54 `any`), `IncomePage.test.tsx` (22), `useClientProjectCascade.test.tsx` (4), `paymentRecords.test.ts` (2), singles in 6 files

**Phase 0 gate:** lint 0 errors · `npx tsc -b` green · `npx vitest run` → only MUT-20's 18 failures remain.

---

## Phase 1 — Data layer

### MUT-4a `src/db/__tests__/paymentRecords.test.ts`
- [ ] Happy path: multiple transactions for a client, payments joined with parent title + currency, newest first
- [ ] Empty: client with transactions but no payments → `[]`
- [ ] Unknown client id → `[]`, never throws
- [ ] Soft-deleted payment records excluded
- [ ] Multi-currency: currency taken from parent transaction, never mixed
- [ ] Date boundaries: `dateFrom`/`dateTo` inclusive on `paidAt`
- [ ] `limit` applied after sort
- [ ] Index documented in code comment (transactions `clientId` → paymentRecords `transactionId`, no schema bump)

### MUT-4b `src/hooks/__tests__/useQueries.test.tsx`
- [ ] `usePaymentsByClient` returns rows for a client
- [ ] Create/update/delete payment invalidates `['paymentRecords','client',…]` → hook refetches

### MUT-17 overdue unification
- [ ] Existing `src/lib/__tests__/dates` / aggregation tests still green (canonical helper unchanged)
- [ ] `TransactionsPage`, `ProjectDetailPage`, `ReportsPage`, `InsightsPage` tests green after swapping to `isOverdueReceivable`/`daysOverdue`
- [ ] Regression: due-today income is **not** overdue anywhere (ADR-010)
- [ ] `InsightsPage` outstanding uses `accumulateIncomeAmount` → partial payments reduce outstanding (new test if none exists)

### MUT-18 backdatable markPaid
- [ ] `transactionRepo.markPaid(id, '2026-09-15')` stores `paidAt = '2026-09-15'` (PaymentRecord path and full-paid path, `repository.ts:366-390`)
- [ ] `markPaid(id)` with no date → today (existing behaviour preserved)
- [ ] `recordPartialPayment(..., paidAt)` same
- [ ] Sync op carries `paidAt` (`synced-repository.ts:176`)
- [ ] Locked transaction still throws `TransactionLockedError`

### D6 `lastPaymentAt`
- [ ] Client summary `lastPaymentAt` reflects a partial payment's `PaymentRecord.paidAt`
- [ ] Backdated payment moves `lastPaymentAt` to the backdated date
- [ ] Soft-deleted payment records ignored
- [ ] `src/db/__tests__/clientRepo.test.ts` updated green

**Phase 1 gate:** new repo/hook/aggregation tests green; rest of suite unchanged from Phase 0.

---

## Phase 2 — Client profile (MUT-3, MUT-4 UI, MUT-6)

### `src/pages/clients/__tests__/ClientDetailPage.test.tsx` (rewrite)
Existing mocks are stale (stub `useMarkTransactionPaid`/`openTransactionDrawer`, never mock `useReceivables`). Re-baseline:
- [ ] Header: Owed Now is the largest element, rendered per currency, overdue portion distinguished
- [ ] No tab UI in DOM; all three sections present at once
- [ ] Work list rows: date, title, amount+currency, status, remaining shown when partial
- [ ] Project rendered when set; absent (no empty field) when not
- [ ] Empty state: single primary action → opens income drawer with `defaultClientId` prefilled
- [ ] Date-range filter and search narrow the work list
- [ ] Payments section: date, amount, parent title, notes
- [ ] Rows pre-shaped in `useMemo` (assert via component contract — table receives prepared rows)
- [ ] Create/edit/delete payment refreshes Payments section **and** Owed Now without manual refresh

### MUT-6 Record payment
- [ ] Button visible only on unpaid/partial income rows; absent on paid rows and expenses
- [ ] 2-click settle: Record payment → confirm (drawer prefilled with remaining balance)
- [ ] Prefill = full remaining; overwriting with smaller amount succeeds
- [ ] Overpayment rejected with field-level message, no write (decision D2)
- [ ] Payment date defaults today, backdating stores the backdated date (MUT-18 end-to-end)
- [ ] Locked transaction: no unhandled `TransactionLockedError`
- [ ] `/income` rows also expose the primary action (`IncomePage.test.tsx`)
- [ ] Tests: full settle, partial settle, backdated, overpayment, locked

**Phase 2 gate:** three questions answerable with zero tab clicks; Phase 2 tests green.

---

## Phase 3 — Fast income input (MUT-5)

### `src/components/__tests__/IncomeDrawer.test.tsx`
- [ ] Save with exactly title + amount + client succeeds
- [ ] Currency/date/profile prefilled correctly and the defaults are visible
- [ ] "More details" collapsed by default; reveals currency, date, due date, project, notes, profile
- [ ] Edit mode: More details expanded when any of those fields has a value
- [ ] Prefilled client when opened from client profile; not prefilled from sidebar
- [ ] No project → submit succeeds; project never required
- [ ] Title without amount → field-level validation error, no thrown exception
- [ ] Amount parsing: decimals, thousands separators, Arabic-Indic digits (`parseAmountToMinor` cases)
- [ ] Currency default = profile `defaultCurrency`; EUR selectable
- [ ] Keyboard path: title → Tab → amount → Tab → client → Enter saves
- [ ] MUT-19 tests from Phase 0 still green

**Phase 3 gate:** 3-field save works; drawer fields all reachable; no new drawer component.

---

## Phase 4 — Index + home (MUT-7, MUT-8)

### `src/pages/clients/__tests__/ClientsPage.test.tsx` (update, 33 existing)
- [ ] Default sort = owed now descending
- [ ] Owed now / overdue per currency, **no cross-currency summing** (old comparator summed USD+ILS+EUR — assert it no longer does)
- [ ] Overdue shows amount + age of oldest overdue item
- [ ] Last payment: date + amount; explicit "never" state
- [ ] Zero-balance clients read as settled, not blank
- [ ] Row click → client profile
- [ ] Archived excluded by default
- [ ] Column sort stable for ties
- [ ] Existing: empty state, loading, search, multi-currency popups still green

### `src/pages/overview/__tests__/OverviewPage.test.tsx` (new file)
- [ ] Owed now most prominent, per currency, overdue portion distinguished
- [ ] Needs attention: overdue + due within 7 days, oldest first; clean empty state
- [ ] 7-day boundary inclusive/exclusive asserted explicitly
- [ ] Recent payments: last 10 with date, amount, client, what-for
- [ ] Rows navigate to client profile
- [ ] Brand-new install → useful empty state with one primary action (not zeroes)
- [ ] Overdue bucketing via shared helper (D3)
- [ ] Existing component tests (`PredictiveKpiStrip`, `MonthActualsRow`, `AttentionFeed`) green

**Phase 4 gate:** both screens per AC; no cross-currency totals anywhere.

---

## Phase 5 — Release gate

- [ ] `npm run lint` → 0 errors
- [ ] `npx tsc -b` → green
- [ ] `npx vitest run` → green except MUT-20's 18 known failures (documented)
- [ ] `npm run test:tz` → green (date-sensitive tests under `TZ=America/New_York`)
- [ ] `npm run build` → succeeds
- [ ] Manual RTL pass in Arabic: ClientDetailPage, ClientsPage, OverviewPage, IncomeDrawer
- [ ] Offline check: no network dependency introduced
- [ ] Knowledge files updated (CHANGELOG, SYSTEM_OVERVIEW, DECISIONS, COMPONENT_REGISTRY, PATTERNS, TECH_DEBT, TEST_PLAN)
- [ ] Jira: MUT-3…8, MUT-17/18/19/22 transitioned with evidence comments

## Coverage targets

- Repo/hook logic (listByClient, markPaid date, lastPaymentAt): **100%** of new branches (critical money logic)
- Changed pages: all new sections + empty states covered
- Overall suite must not regress below baseline (2011 passing, excluding known failures)
