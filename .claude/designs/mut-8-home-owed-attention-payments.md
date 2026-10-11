# Design Brief — MUT-8: Home becomes owed now + needs attention + recent payments

- **Date:** 2026-10-11
- **Ticket:** MUT-8 (epic MUT-1). Settles parent-brief D10 and the overview half of TD-030.
- **Parent brief:** `.claude/designs/mut-1-client-accounting-core.md` Phase 4. Builds on MUT-3 (ADR-033) and MUT-7 (ADR-035).
- **Branch / worktree:** `feature/mut-1-client-core` in `.claude/worktrees/mut-1-client-core`, from `main` 2151315
- **Status:** awaiting approval

---

## 1. Problem

`src/pages/overview/OverviewPage.tsx` (Home, the only eagerly loaded route) shows a forecast strip ("Will I make it?", cash on hand, coming/leaving), a collapsible month-actuals row (received / unpaid / expenses / net), a guidance-based attention feed and this month's recent transactions. None of it is framed around the three questions: how much am I owed, who is late, what came in.

Audit findings:

| # | Finding | Consequence |
|---|---|---|
| F1 | `AttentionFeed` is built on the money-event *guidance* engine: current month only, **USD and ILS only (EUR never appears)**, severity order, a cap of 5, retainer projections and "missing due date" hints mixed in, and no link to the client | It can't satisfy "overdue + due within 7 days, oldest first, each row to its client" |
| F2 | `transactionRepo.getAttentionReceivables` + `useAttentionReceivables` **already return exactly MUT-8's list**: overdue (ADR-010/022) or due within 7 days inclusive (`isDueSoon`), every currency, due date ascending, with client name and remaining balance. Nothing renders it | Needs attention is presentation plus a tie-break |
| F3 | No cross-client payment query exists; `listByClient` is per client | "Last 10 payments" needs one read-only repo method, built on `paymentRowsForIncome` (ADR-033) |
| F4 | `PredictiveKpiStrip`, `MonthActualsRow` and `AttentionFeed` are used **only** on Home. `useGuidance` and `useMonthKPIsBothCurrencies` are used only by them | Taking them off Home leaves the money-event read side with no screen — D10, §5 |
| F5 | A brand-new install that skipped onboarding gets a page of zeroes and empty cards | AC: one useful empty state with one primary action |
| F6 | `docs/ux-redesign/UX-REDESIGN-SPEC.md` §6 and `insights-reintegration.md` §2 define Home as "Am I okay? What needs attention?" with a KPI strip of received / unpaid / expenses / net | MUT-8 supersedes that contract. It is recorded as ADR-036 with a "Superseded" note in the spec, as MUT-15 did for the sidebar |
| F7 | The ticket names `KpiRow` / `InlineStat` / `AttentionList` | They don't exist (parent-brief D8 registry drift). `OwedNowSummary` and a section list are the real equivalents |

## 2. Acceptance criteria (MUT-8, unchanged)

- [ ] Owed now is the most prominent element, per currency, overdue portion distinguished
- [ ] Needs attention: overdue items + due within 7 days, oldest first, clean empty state
- [ ] Recent payments: last 10 with date, amount, client, what for
- [ ] Every row navigates to the relevant client profile
- [ ] Brand-new install: a useful empty state with one primary action, not zeroes and blank tables
- [ ] Overdue from the single shared helper
- [ ] Home stays the eagerly loaded route; initial load does not regress
- [ ] Tests: populated, empty, overdue bucketing, 7-day boundary
- Guardrails: no cross-currency summing, RTL in Arabic, i18n keys, offline

## 3. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Owed now** = `OwedNowSummary` over `summarizeOwedByCurrency(useReceivables({ profileId }), today)`: every receivable in the active profile, including income with no client | It's the same helper as the profile and the index (ADR-033). Home answers "what am I owed" in full; the index strip lists clients, so it omits client-less income (noted in ADR-036) |
| D2 | **Needs attention** renders `useAttentionReceivables(undefined, profileId)`, which already filters to overdue or due within 7 days. Each row shows the client (or the entry title when there is no client), what it was for, the remaining amount in its own currency, and "{n}d overdue" or "Due in {n}d" / "Due today". Ordered by due date ascending, ties by client name then id. No cap; a clean "Nothing to chase" empty state | F2. The shared helpers do the bucketing, the 7-day window is inclusive, and due today counts as due soon, not overdue |
| D3 | **Recent payments**: new read-only `paymentRecordRepo.listRecent({ profileId, limit = 10 })`, returning `RecentPaymentRow = PaymentByClientRow & { clientId?, clientName? }`. It is built from `paymentRowsForIncome`, so it includes income saved as Received, sorted newest first. The hook is `useRecentPayments(profileId)` under key `['paymentRecords', 'recent', …]`, so every payment and income write already refreshes it (MUT-3's `invalidatePaymentRecordLists`) | F3, with one payment definition everywhere |
| D4 | **Every row opens the client profile.** A row whose entry has no client opens that entry in the income drawer instead | AC "every row navigates to the relevant client profile"; nothing else exists to open |
| D5 | **Layout:** the Owed now card in hero size, then two columns, Needs attention and Recent payments (the existing `home-two-column`, which stacks when narrow) | The order is the ticket's; the hero is the largest text (30px) |
| D6 | **Empty state:** when the profile has no clients and no income (and onboarding is skipped or done), show `EmptyState` with one primary action, **Add income**. The income drawer's client field can create a client inline (`client.createNew`), so one action covers both | AC F5. The existing onboarding overlay for brand-new users is untouched (MUT-15 owns it) |
| D7 | **Removed from Home:** the forecast strip, the month-actuals row, the guidance attention feed, and "Recent activity" (transactions this month, expenses included). What happens to those components is D10 (§5) | Ticket: "remove anything that does not serve those three"; expenses are not core |
| D8 | **i18n:** new `home.owed.*`, `home.attention.*` (reused where they fit), `home.payments.*`, `home.empty.*` keys in en and ar; amounts in `<bdi dir="ltr">` | Guardrails |
| D9 | **Load:** Home goes from roughly six queries (two guidance, month KPIs, actuals, two transaction lists, clients) to four (clients, receivables, attention, recent payments), and the eager chunk no longer imports the forecast components | AC "does not regress initial load" |
| D10 | **The forecast strip, month actuals and guidance feed:** open, see §5 | — |

## 4. API contracts

```ts
// src/types/index.ts
interface RecentPaymentRow extends PaymentByClientRow { clientId?: string; clientName?: string }

// src/db/repository.ts — paymentRecordRepo (read-only addition; IPaymentRecordRepository + synced binding)
listRecent(filters?: { profileId?: string; limit?: number }): Promise<RecentPaymentRow[]>
  // non-deleted income in the profile (archived included: those payments happened), paymentRowsForIncome per entry,
  // client name joined, sorted paidAt desc then id; limit default 10; [] when none; never throws

// src/hooks/useQueries.ts
useRecentPayments(profileId?: string, limit = 10)   // key ['paymentRecords', 'recent', { profileId, limit }]
```

## 5. Open decision (needs Basel)

**D10 — what happens to the forecast strip ("Will I make it?", cash on hand, coming/leaving), the month-actuals row and the guidance attention feed once they leave Home?** All three are used only there.

- **A. Move the forecast strip and month actuals to the top of Insights; delete the guidance feed (recommended).** Insights is an optional area, off by default. That matches the 2026-10-05 rule: what doesn't serve the three questions goes behind the Advanced toggle. The forecasting work stays available, and the money-event engine keeps a screen. The guidance feed is replaced by Needs attention, so it, `useGuidance` and its two tests go.
- **B. Delete all three now.** File a follow-up ticket to prune the money-event read side (`useMoneyEventQueries`, `moneyEventRepository`, and the `invalidateMoneyEventQueries` calls in every write path). This is the leanest result, but the forecast feature disappears from the product.
- **C. Take them off Home only.** Leave the components in the code, unused, and log the dead code as debt.

## 6. Reuse analysis

Reused: `OwedNowSummary`, `summarizeOwedByCurrency`, `useReceivables`, `useAttentionReceivables` / `getAttentionReceivables`, `isOverdueReceivable` / `daysOverdue` / `isDueSoon` / `daysUntilDue`, `paymentRowsForIncome`, `invalidatePaymentRecordLists`, `EmptyState`, `OnboardingOverlay`, `formatAmount` / `formatDate`.
New: `listRecent` + `useRecentPayments`, two small section components (`HomeNeedsAttention`, `HomeRecentPayments` in `src/components/home/`), an `OverviewPage` test file (none exists today).

## 7. Impact

| Area | Impact |
|---|---|
| `OverviewPage.tsx` | Rewritten to three blocks; onboarding gate unchanged |
| `src/components/home/*` | Two new sections; the fate of the three existing ones depends on D10 |
| `paymentRecordRepo` + interface + synced binding | Read-only `listRecent` |
| Insights (if D10 = A) | Gains the forecast strip and month actuals above its period sections; gated as today |
| Docs | ADR-036; "Superseded" note in UX-REDESIGN-SPEC §6 and insights-reintegration §2; TD-030 overview half recorded |

## 8. i18n / RTL · 9. Cost / infra

New keys in en + ar; amounts LTR-isolated; RTL checked in the browser. No infra, no network, no schema or version change, no new dependency.

## 10. Out of scope

Charts, trends and forecasting on Home; expense figures on Home; onboarding changes (MUT-15); the hosted portal (MUT-34).
