# Design Brief: Financial Intelligence Integration

> **Status**: Draft v2
> **Created**: 2026-03-13
> **Revised**: 2026-03-13
> **Author**: Claude (AI)
> **Related ADR**: ADR-021 (Question-First UX Redesign)

---

## 1. Problem Statement

The deprecated `/money-answers` page contained predictive and actionable financial intelligence that should be promoted into the core product. The goal is **not** to restore Money Answers as a feature, but to **absorb its intelligence into Home and Insights** while deleting its identity as a separate conceptual island.

### What Money Answers Got Right
- Predictive KPIs that answer "Will I be okay?"
- Severity-based attention items with actionable buttons
- Cash flow visualization over time
- Year-level trend analysis

### What the Current Insights Page Lacks
- Predictive/forecast capability (only shows actuals)
- Actionable guidance (reports are passive)
- Time-series visualization (only tables and basic bars)

---

## 2. Page Contracts (Sharp Boundaries)

Each page has one job. This prevents scope creep.

| Page | Contract | Primary Question |
|------|----------|------------------|
| **Home** | Current month operating view | "Am I okay? What needs attention?" |
| **Insights** | Period analysis and trend interpretation | "How did I do? What patterns exist?" |
| **Income/Expenses** | Transaction-level truth and editing | "What are the line items?" |

### What This Means

- **Home** shows a snapshot: predictive health, attention items, recent activity
- **Insights** shows analysis: trends, comparisons, year review, cash flow over time
- **Ledger pages** (Income, Expenses) show the source truth and enable editing

Intelligence flows **up** from ledger → insights → home. Editing flows **down** through drawers.

---

## 3. Terminology (Aligned with ADR-010)

Per ADR-010, "receivable" is not a separate entity. It's a transaction with `kind='income'` and `status='unpaid'`.

**Correct terminology throughout this design:**

| Say This | Not This |
|----------|----------|
| Unpaid income | Receivables (as if separate) |
| Actuals | Realized / Confirmed |
| Projected income | Retainer forecasts |
| Forecast | Prediction / Smart guess |

**Toggle labels (for Insights):**
- "Include unpaid income" (not "Include receivables")
- "Include projected retainer income" (not "Include projections")

---

## 4. Home Page: Predictive Snapshot + Needs Attention

### 4.1 Information Hierarchy

Home answers two questions in under 10 seconds:
1. **Am I okay this month?** → Predictive Snapshot
2. **What needs my attention?** → Attention Feed

Everything else is secondary or deferred to Insights.

### 4.2 Predictive Snapshot (Primary Block)

One row of 3 cards. Not 7. Not 4. Three.

```
┌─────────────────────┐ ┌─────────────────────┐ ┌─────────────────────┐
│   Will I Make It?   │ │    Cash on Hand     │ │   Coming / Leaving  │
│                     │ │                     │ │                     │
│      +$4,250        │ │       $2,800        │ │  ↑$3,200 / ↓$1,750  │
│   End-of-month      │ │   Current balance   │ │   Net: +$1,450      │
│   forecast ⓘ       │ │                     │ │                     │
└─────────────────────┘ └─────────────────────┘ └─────────────────────┘
```

**Each card MUST have:**
- Clear label
- Amount (per-currency, never silently summed)
- Help icon (ⓘ) linking to methodology explanation

### 4.3 Forecast Methodology (Explicit and Transparent)

Per the product's principle of honest currency handling, forecasts must be equally honest.

| KPI | Formula | What's Included |
|-----|---------|-----------------|
| **Will I Make It?** | Cash on Hand + Coming - Leaving | Actuals to date + unpaid income expected this month + projected retainer income − upcoming known expenses |
| **Cash on Hand** | Opening balance + paid inflows − paid outflows (up to today) | Only actuals. No unpaid. No projections. |
| **Coming** | Sum of unpaid income due this month + projected retainer income this month | Explicitly unpaid + projected. User toggle controls whether projected is included. |
| **Leaving** | Sum of known upcoming expenses this month | Only expenses with future dates in current month. |

**User-facing explanation** (shown on hover/tap of ⓘ):
> "Will I Make It?" shows your projected end-of-month position based on: money you have now, unpaid income due this month, and expected expenses. It assumes unpaid invoices will be paid by their due date.

### 4.4 Actuals Row (Secondary, Collapsible)

Below the predictive row, a **collapsible** summary of month-to-date actuals:

```
▼ This Month's Actuals
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│   Received   │ │   Unpaid     │ │   Expenses   │ │     Net      │
│    $2,100    │ │    $3,200    │ │     $850     │ │   +$1,250    │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
```

- Collapsed by default on mobile
- Expanded by default on desktop
- Collapse state persisted in localStorage (not URL)

### 4.5 Attention Feed

Severity-ordered list of items requiring action.

**Display rules:**
- Maximum 5 items shown (link to "View all" → Insights Unpaid tab)
- Critical items always visible
- Warning/Info items collapse if >3 total

**Action button routing (strict rules):**

| Action | Behavior |
|--------|----------|
| "Mark Paid" | Opens `IncomeDrawer` in edit mode for that transaction |
| "View Unpaid" | Navigates to `/income?status=unpaid` |
| "View Details" | Opens `IncomeDrawer` in view mode |

**Actions MUST route through canonical drawers.** No parallel workflows. No special "mark paid" API bypasses.

### 4.6 Recent Activity

Compact feed of last 5-10 transactions (income received, expenses added, unpaid created).

- Click row → opens appropriate drawer (Income or Expense)
- "View all" → navigates to Income or Expenses page

### 4.7 What Home Does NOT Have

- Full cash flow timeline (that's Insights)
- Year mode toggle (that's Insights)
- Data export (that's Insights)
- Toggle controls for unpaid/projected inclusion (Home always shows full picture)

---

## 5. Insights Page: Period Analysis and Trend Interpretation

### 5.1 Page Structure

```
┌─────────────────────────────────────────────────────────────────────┐
│ Insights                                           [Export ▼]      │
├─────────────────────────────────────────────────────────────────────┤
│ [Summary] [Clients] [Projects] [Expenses] [Unpaid]                  │
├─────────────────────────────────────────────────────────────────────┤
│ Period: [Month ○] [Year ●]   ◀ 2026 ▶     Currency: [Both ▼]       │
│ [✓] Include unpaid income  [✓] Include projected retainer income   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│                        [Tab Content]                                │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.2 Summary Tab Enhancements

**Month Mode:**
- Period KPIs (received, unpaid, expenses, net)
- Cash Flow Timeline (daily inflow/outflow bars + running balance line)
- Click any day → Day Detail Drawer

**Year Mode:**
- Year KPIs (total income, total expenses, net)
- Monthly Trend Bars (12-month chart, click month → drills into month mode)
- Year Insights panel:
  - Best month (highest net)
  - Worst month (lowest net)
  - Retainer stability % (received on time / expected)

### 5.3 Toggle Behavior

| Toggle | Affects |
|--------|---------|
| Include unpaid income | KPIs, timeline "inflow" bars, summary totals |
| Include projected retainer income | KPIs, timeline "inflow" bars (shown with lower opacity), summary totals |

Toggle state stored in URL: `?unpaid=true&projected=true`

### 5.4 Cash Flow Timeline (Month Mode Only)

Reuse the visualization logic from Money Answers, but as a **shared primitive** not a copied component.

**Display:**
- X-axis: days of month
- Y-axis: amount (scaled to max)
- Green bars: inflows
- Red bars: outflows
- Line overlay: running balance

**Interaction:**
- Hover: tooltip with day totals (per currency)
- Click: opens Day Detail Drawer with `?dayDetail=YYYY-MM-DD`

### 5.5 Other Tabs (Unchanged from Current)

- **Clients**: Total received/unpaid by client
- **Projects**: Profitability by project
- **Expenses**: By category, by project
- **Unpaid**: Aging buckets, by client, by project

---

## 6. Day Detail Drawer

**Already exists.** No changes to the drawer itself.

**Integration points:**
- Openable from Home (if we add mini-timeline later, Phase 4+)
- Openable from Insights Cash Flow Timeline
- Deep-linkable: `?dayDetail=YYYY-MM-DD`

**Contents:**
- Date header
- List of all transactions for that day
- Grouped by currency
- Click transaction → opens Income/Expense drawer for editing

---

## 7. Implementation Phases

### Phase 1: Data Contracts and Shared Logic (No UI Changes)

**Goal:** Extract and stabilize the query/aggregation layer before touching UI.

- [ ] Define TypeScript interfaces for forecast KPIs (explicit about what's included)
- [ ] Audit `moneyEventRepo` for terminology alignment (no "receivable" as separate concept)
- [ ] Extract reusable aggregation functions (not components) into `src/lib/aggregations.ts`
- [ ] Add unit tests for forecast calculations (edge cases: month boundaries, missing due dates, partial payments)
- [ ] Verify `useMonthKPIsBothCurrencies` returns correct values with explicit inclusion flags

**Deliverables:**
- Clean data contracts
- Tested aggregation logic
- No UI changes yet

### Phase 2: Home Predictive Snapshot + Attention Feed

**Goal:** Home answers "Am I okay?" and "What needs attention?"

- [ ] Create `PredictiveKpiStrip` component (3 cards, not recycled from Money Answers)
- [ ] Add help tooltips explaining forecast methodology
- [ ] Create `AttentionFeed` component (severity-sorted, max 5 items)
- [ ] Wire action buttons to canonical drawers (strict routing)
- [ ] Add collapsible "This Month's Actuals" row
- [ ] Update Home page to compose these components

**Does NOT include:**
- Timeline on Home
- Year mode on Home
- Any toggles on Home

### Phase 3: Insights Month/Year Analysis

**Goal:** Insights becomes the analysis page with time-series visualization.

- [ ] Add Month/Year period toggle to Summary tab
- [ ] Add Cash Flow Timeline to Month mode (reuse visualization primitives)
- [ ] Add Year Mode View with monthly trend bars
- [ ] Add Year Insights panel (best/worst month, retainer stability)
- [ ] Add toggle controls for unpaid/projected inclusion
- [ ] Wire Day Detail Drawer from timeline clicks

### Phase 4: Polish, Responsiveness, Testing, Documentation

**Goal:** Production-ready quality.

- [ ] Responsive design for Predictive KPI strip (stack on mobile)
- [ ] Responsive design for Cash Flow Timeline (horizontal scroll on mobile)
- [ ] Accessibility audit (keyboard navigation, screen reader labels)
- [ ] Integration tests for critical flows
- [ ] Update COMPONENT_REGISTRY.md
- [ ] Update CHANGELOG.md
- [ ] Delete deprecated Money Answers page and components

---

## 8. Testing Requirements

### Unit Tests (Phase 1)

| Test | Assertion |
|------|-----------|
| Forecast with no unpaid income | Returns cash on hand only |
| Forecast with unpaid income | Includes unpaid amounts due this month |
| Forecast excludes overdue from prior months | Only current month's due items |
| Forecast with projected retainer | Includes expected retainer payments |
| Month boundary handling | Transactions on last day of month counted correctly |
| Currency separation | Never sums USD + ILS |

### Integration Tests (Phase 4)

| Flow | Expected Behavior |
|------|-------------------|
| Click "Mark Paid" in Attention Feed | Opens IncomeDrawer for that transaction |
| Click day in Cash Flow Timeline | Opens DayDetailDrawer for that date |
| Toggle "Include unpaid income" | KPIs and timeline update |
| Year mode → click month bar | Navigates to month mode for that month |
| DayDetailDrawer deep link | `?dayDetail=2026-03-15` opens correct drawer |

### Acceptance Criteria

- [ ] Forecast numbers are stable across month boundaries
- [ ] Unpaid inclusion toggle changes KPIs and timeline consistently
- [ ] Clicking attention actions always routes through canonical drawers
- [ ] Day drawer deep-link works from both Home and Insights
- [ ] Help tooltips explain what each forecast includes
- [ ] Mobile layout is usable (no horizontal overflow)

---

## 9. What We Are NOT Doing

To prevent scope creep, explicitly out of scope:

1. **Mini-timeline on Home** - Deferred. Home stays focused on snapshot + attention.
2. **Real-time updates** - Guidance/KPIs refresh on page load, not automatically.
3. **Custom forecast periods** - Only current month. Custom ranges are for Insights.
4. **Opening balance configuration** - Assume 0 for MVP. User-configurable later.
5. **Notifications/alerts** - No push notifications for overdue items. Just passive display.
6. **Receivables as a separate data model** - Per ADR-010, it stays as transaction status.

---

## 10. Component Strategy (Not Migration)

**Do not "move" Money Answers components.** Instead:

### Extract Primitives
- `formatForecastAmount()` - formatting with currency
- `calculateRunningBalance()` - balance calculation
- `groupByDay()` / `groupByMonth()` - aggregation helpers
- `TimelineBar` - single bar visualization primitive

### Create New Compositions
- `PredictiveKpiStrip` - new component for Home (not a copy of UnifiedKpiStrip)
- `AttentionFeed` - new component for Home (not a renamed GuidanceFeed)
- `CashFlowTimeline` - new component for Insights (uses primitives, not forked)
- `YearTrendChart` - new component for Insights year mode

### Delete After Migration
Once Phase 4 is complete:
- `src/pages/money-answers/` - entire directory
- Route `/money-answers` - remove from router
- Unused Money Answers query hooks - if any remain

---

## 11. Open Decisions

| Question | Options | Recommendation |
|----------|---------|----------------|
| Collapsible actuals row default state | Expanded / Collapsed | Expanded on desktop, collapsed on mobile |
| Year mode navigation on month click | Stay in Insights / Go to Income filtered | Stay in Insights (switch to month mode) |
| Forecast includes partial payments? | Yes / No | Yes - show remaining unpaid amount |
| Attention feed refresh trigger | Page load only / Also on drawer close | On drawer close (to reflect "Mark Paid" immediately) |

---

## 12. Success Metrics

After implementation, measure:

1. **Home usefulness**: Does the user see their financial health in <10 seconds?
2. **Attention actionability**: Do users click through and resolve attention items?
3. **Insights depth**: Do users switch between month/year modes?
4. **No regression**: Existing Insights tabs (Clients, Projects, etc.) work unchanged.

---

## Appendix A: Visual Reference (Home)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Home                                              [+ Add ▼]                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────┐ ┌─────────────────────┐ ┌─────────────────────┐   │
│  │   Will I Make It?   │ │    Cash on Hand     │ │   Coming / Leaving  │   │
│  │      +$4,250 ⓘ     │ │       $2,800        │ │  ↑$3,200 / ↓$1,750  │   │
│  │   End-of-month      │ │   Current balance   │ │   Net: +$1,450      │   │
│  └─────────────────────┘ └─────────────────────┘ └─────────────────────┘   │
│                                                                             │
│  ▼ This Month's Actuals                                                     │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐              │
│  │  Received  │ │   Unpaid   │ │  Expenses  │ │    Net     │              │
│  │   $2,100   │ │   $3,200   │ │    $850    │ │  +$1,250   │              │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘              │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  Needs Attention                                              [View all →] │
│  ┌────────────────────────────────────────────────────────────────────────┐│
│  │ ● CRITICAL  2 payments overdue 30+ days        $1,500 USD  [Mark Paid]││
│  │ ○ WARNING   Client ABC has unpaid balance      $2,200 USD  [View]     ││
│  │ ○ INFO      3 invoices missing due dates       $800 USD    [View]     ││
│  └────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  Recent Activity                                              [View all →] │
│  ┌────────────────────────────────────────────────────────────────────────┐│
│  │ Today      Acme Corp - Project Alpha      +$1,200 USD    Received     ││
│  │ Yesterday  Office Supplies                -$45 ILS       Expense      ││
│  │ Mar 11     Widget Inc - Consulting        +$800 USD      Unpaid       ││
│  └────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Appendix B: Forecast Calculation Pseudocode

```typescript
interface ForecastKPIs {
  willMakeIt: AmountByCurrency;
  cashOnHand: AmountByCurrency;
  coming: AmountByCurrency;
  leaving: AmountByCurrency;
}

function calculateForecastKPIs(
  month: string,
  options: {
    includeUnpaidIncome: boolean;
    includeProjectedRetainer: boolean;
    openingBalance: AmountByCurrency;
  }
): ForecastKPIs {
  const today = getTodayISO();
  const { start, end } = getMonthRange(month);

  // Cash on Hand: opening + actuals to date
  const cashOnHand = {
    USD: options.openingBalance.USD,
    ILS: options.openingBalance.ILS,
  };

  for (const tx of getTransactionsInRange(start, today)) {
    if (tx.kind === 'income' && tx.status === 'paid') {
      cashOnHand[tx.currency] += tx.amountMinor;
    }
    if (tx.kind === 'expense') {
      cashOnHand[tx.currency] -= tx.amountMinor;
    }
  }

  // Coming: unpaid income + projected retainer
  const coming = { USD: 0, ILS: 0 };

  if (options.includeUnpaidIncome) {
    for (const tx of getUnpaidIncomeDueInRange(start, end)) {
      coming[tx.currency] += tx.amountMinor;
    }
  }

  if (options.includeProjectedRetainer) {
    for (const pi of getProjectedRetainerInRange(start, end)) {
      if (pi.state !== 'received') {
        coming[pi.currency] += pi.expectedAmountMinor - pi.receivedAmountMinor;
      }
    }
  }

  // Leaving: known future expenses this month
  const leaving = { USD: 0, ILS: 0 };
  for (const tx of getExpensesInRange(today, end)) {
    leaving[tx.currency] += tx.amountMinor;
  }

  // Will I Make It?
  const willMakeIt = {
    USD: cashOnHand.USD + coming.USD - leaving.USD,
    ILS: cashOnHand.ILS + coming.ILS - leaving.ILS,
  };

  return { willMakeIt, cashOnHand, coming, leaving };
}
```

---

## Appendix C: Deprecation Checklist (Phase 4)

After all features are integrated:

- [ ] Remove `/money-answers` route from `src/router.tsx`
- [ ] Remove redirect from `/money-answers` → `/insights`
- [ ] Delete `src/pages/money-answers/` directory
- [ ] Remove `useMoneyAnswersQueries.ts` if fully replaced
- [ ] Remove `moneyEventRepo` functions that are no longer called
- [ ] Remove i18n keys under `moneyAnswers.*` namespace (after migrating needed ones)
- [ ] Update SYSTEM_OVERVIEW.md to remove Money Answers references
- [ ] Verify no broken imports or references
