# Design Brief — MUT-1: Client accounting core

- **Date:** 2026-10-08
- **Epic:** MUT-1 (scope: MUT-3, MUT-4, MUT-5, MUT-6, MUT-7, MUT-8)
- **Blockers in scope:** MUT-17 (overdue unification), MUT-18 (backdatable markPaid), MUT-19 (IncomeDrawer tests), MUT-22 (lint errors)
- **Explicitly out:** MUT-9 (statement export, optional), MUT-20 (ExpensesLedger tests — known debt), engagements/retainers/invoice generation, expense analytics, forecasting
- **Status:** approved at intake review 2026-10-08
- **Progress (2026-10-11):** MUT-6 merged. MUT-3 built on `feature/mut-1-client-core` together with the MUT-4 Payments UI and MUT-23 — brief `.claude/designs/mut-3-client-profile.md`, ADR-033. The MUT-4 data layer (`listByClient`, `usePaymentsByClient`) landed 2026-10-08 and was extended by MUT-3 (entry rows, calendar-date bounds). D6 (`lastPaymentAt` payment-record aware) is closed by MUT-7 (2026-10-11, brief `.claude/designs/mut-7-clients-who-owes-me.md`, ADR-035). D10 (Home's `PredictiveKpiStrip` / `MonthActualsRow`) remains for MUT-8.

---

## 1. Problem

Three questions define the product's job, and none is answerable without navigation:

1. What have I worked on for this client?
2. How much money am I owed by this client?
3. When did they make payments, and for what?

Today the client profile (`src/pages/clients/ClientDetailPage.tsx`, 637 lines) splits across Summary / Projects / Receivables / Transactions tabs. Owed-now is a small "Unpaid" stat in a header strip; payment history is absent at client level (`paymentRecordRepo` has only `listByTransaction`); recording a payment hides behind a kebab menu; income entry is an 8-field form.

## 2. Decisions locked at intake (2026-10-05, MUT-1 description)

- The income entry **is** the work record. `title` = what you did. `projectId` is an optional grouping tag. No schema change.
- Multi-profile and multi-currency kept as-is; per-currency totals, never silent FX mixing.
- Expenses optional, not core.

## 3. Decisions made during planning (2026-10-08)

| # | Decision | Rationale |
|---|---|---|
| D1 | `listByClient` joins through the `transactions.clientId` index; **no Dexie schema change / no version bump** | MUT-4 AC requires it; `paymentRecords` has no `clientId`, `transactions.clientId` is already indexed (v17) |
| D2 | Overpayment on Record payment is **rejected with a clear field-level message** | Matches existing validation style in `PartialPaymentDrawer`; smallest change; overpayment shown as an error, not silently absorbed |
| D3 | Overdue for all income/receivable surfaces comes from `src/lib/dates.ts` (`isOverdueReceivable` / `daysOverdue`), ADR-010 semantics: `kind=income && status=unpaid && dueDate < today` — due-today is **not** overdue | Fixes MUT-17; single shared helper per MUT-8 AC |
| D4 | Retainer (`retainerRepository`) and recurring-expense UTC `todayISO()` stay as-is (TD-014) | Different domains, separate debt; documented in TECH_DEBT |
| D5 | `markPaid` and `recordPartialPayment` gain an optional `paidAt` parameter, defaulting to today | MUT-18; `paymentRecordRepo.create` already accepts `paidAt` — only the entry points discard it |
| D6 | `lastPaymentAt` becomes payment-record aware (reads non-deleted `PaymentRecord.paidAt`, not just fully-paid `tx.paidAt`) | MUT-7/MUT-8 "last payment" would otherwise hide partial and backdated payments |
| D7 | "Owed Now" is a **new** i18n label (new keys in `en.json` + `ar.json`); nearest existing key is `clients.columns.unpaid` | No `owedNow` key exists anywhere today |
| D8 | Hand-rolled `<table className="data-table">` remains the table pattern; `DataTable`/`KpiRow`/`AttentionList` from COMPONENT_REGISTRY do not exist and are **not** created in this epic | Reuse rule applies to components that exist; building a table abstraction mid-epic is scope creep |
| D9 | Phase order: hygiene → data → profile → input → index/home → release gate | Each phase ends green and demo-able |
| D10 | Home keeps or drops `PredictiveKpiStrip` / `MonthActualsRow` — **open, decided during Phase 4** | MUT-8 says "remove anything that does not serve those three blocks" |

## 4. Phased solution

### Phase 0 — Release hygiene
- **MUT-19:** fix 3 IncomeDrawer tests (2 typeahead tests never open the combobox; 1 `toBeNull()` vs Dexie deleting `undefined` keys).
- **MUT-22:** zero lint errors. 76/88 are `no-explicit-any`, concentrated in `ProjectDetailPage.test.tsx` (54) and `IncomePage.test.tsx` (22).

### Phase 1 — Data layer
- `paymentRecordRepo.listByClient(clientId, filters?)` — filters `dateFrom`/`dateTo` (inclusive), `currency`, `limit`; sorted `paidAt` desc; excludes `deletedAt`; returns `paidAt, amountMinor, currency (parent), notes, transactionId, parent title`; empty array for unknown client.
- `usePaymentsByClient(clientId, filters)` hook; query key `['paymentRecords','client',clientId,filters]`; wired into `invalidatePaymentRecordQueries`.
- MUT-17: replace every `getDaysUntil(dueDate) < 0` overdue reimplementation (`TransactionsPage`, `ProjectDetailPage`, `ReportsPage`, `InsightsPage`) with the shared helper; fix `InsightsPage` outstanding math to use `accumulateIncomeAmount`.
- MUT-18: `markPaid(id, paidAt?)`, `recordPartialPayment(..., paidAt?)` through `synced-repository.ts`.
- D6 aggregation fix.

### Phase 2 — Client profile (MUT-3, MUT-4 UI, MUT-6)
Single scrollable profile:
1. **Header** — name, contact, **Owed Now** per currency (dominant number), overdue portion distinguished.
2. **Work and billing** — date, title, amount+currency, status, remaining-if-partial, project as tag; date-range + search; empty state with one primary action opening the income drawer prefilled with this client.
3. **Payments** — client-level history via `usePaymentsByClient`; edit/delete via existing `PartialPaymentDrawer`.

MUT-6: primary **Record payment** button on unpaid/partial rows (profile + `/income`), prefilled with the remaining balance, overpayment rejected (D2). Kebab keeps edit/duplicate/archive/delete. Two clicks to settle; locked transactions must not throw unhandled `TransactionLockedError`.

### Phase 3 — Fast income input (MUT-5)
`IncomeDrawer`: fast path (title, amount+currency affix, client) + collapsed "More details" (currency, date, due date, project, notes, profile). Defaults visible: profile from `useProfileAwareAction`, currency = profile `defaultCurrency` (today hardcoded `'USD'` — fixed), `occurredAt = today`. EUR added to the select (schema allows it, select doesn't). Zod messages aligned to i18n keys. No new drawer component.

### Phase 4 — Index + home (MUT-7, MUT-8)
- Clients: columns Client · Owed now (per currency, overdue portion) · Overdue (amount + age) · Last payment (date+amount, "never" state) · Last activity; default sort owed desc, stable ties, **no cross-currency summing** (current comparator sums USD+ILS+EUR — removed); archived excluded.
- Home: Owed now → Needs attention (overdue + due ≤7 days, oldest first, links to client) → Recent payments (last 10). Overdue from shared helper (D3).

## 5. API contracts & error states

```
paymentRecordRepo.listByClient(clientId, filters?) -> PaymentByClientRow[]
PaymentByClientRow = { id, paidAt, amountMinor, currency, notes?, transactionId, transactionTitle }
  errors: none thrown for unknown client / no payments -> []
  filters: dateFrom/dateTo inclusive on paidAt, currency exact, limit applied after sort

transactionRepo.markPaid(id, paidAt = nowISO()) -> void
  errors: TransactionLockedError (unchanged), invalid id (unchanged)
  sync: paidAt carried in sync op (already the shape in synced-repository.ts:176)

usePaymentsByClient(clientId, filters) -> { data, isLoading, error }
  invalidation: create/update/delete payment -> ['paymentRecords','client',clientId] + existing tx/summary keys
```

Overpayment (D2): `PartialPaymentDrawer` submit with `amount > remaining` → field-level error, no write.

## 6. Reuse analysis (COMPONENT_REGISTRY)

Reused, no new variants: `PaymentStatusBadge`, `AmountWithConversion`, `DateRangeControl`, `SearchInput`, `RowActionsMenu`, `EmptyState`, `CurrencySummaryPopup`, `ClientTypeahead`, `PartialPaymentDrawer`, `InlineStats`.

Registry drift recorded (COMPONENT_REGISTRY.md must be corrected in Phase 5): `DataTable`, `CellAmount`, `CellStatus`, `CellDate`, `KpiRow`, `AttentionList` do not exist; actual equivalents are hand-rolled tables, `AmountWithConversion`, `PaymentStatusBadge`, `AttentionFeed`.

## 7. Impact analysis

| Area | Impact |
|---|---|
| `ClientDetailPage.tsx` | Tab state and 4 tab bodies removed; 3-section layout; stale test mocks re-baselined |
| `ClientsPage.tsx` | Columns + default sort change; 33 tests partially updated |
| `OverviewPage.tsx` | Restructured; currently **has no test file** — one is added |
| `IncomeDrawer.tsx` | Layout restructure only; every field stays reachable |
| `PartialPaymentDrawer.tsx` | + remaining-balance prefill option, + overpayment rejection |
| Repo/sync | Read-only addition (`listByClient`) + optional param on 2 methods; no schema version bump |
| MUT-23 | Fixed incidentally (discarded `useProjects(clientId)` call removed) — comment on the ticket |

## 8. i18n / l10n

- New keys in **both** `src/lib/i18n/translations/en.json` and `ar.json`: `clients.owedNow`, work-list headers, payments-section headers, record-payment button copy, fast-path labels, `validation.overpayment`.
- All amounts LTR inside RTL; amount input stays LTR with currency affix on the correct side.
- Dates/amounts via `Intl` with active locale; RTL verified on all four changed surfaces.
- `Translations` type in `src/lib/i18n/types.ts` is stale — new keys still typed as plain strings; type overhaul out of scope.

## 9. Cost / infra implications

None. Offline-first, local Dexie only, no network, no new dependencies, no infra changes.

## 10. Guardrails (from CLAUDE.md + epic)

- Rows pre-shaped in `useMemo`; column defs memoized with stable deps.
- No cross-currency summing in any total.
- Offline against Dexie; no network calls.
- TDD: tests written before/with implementation per phase.
- Verification per phase: `npm run lint`, `npx tsc -b`, `npx vitest run`; final gate adds `npm run test:tz` and `npm run build`.
