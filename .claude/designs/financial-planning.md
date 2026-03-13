# Design Brief: Financial Planning Workspace

> **Feature**: Financial Planning Workspace (Runway & Ask Calculator)
> **Date**: 2026-03-13
> **Status**: Draft v1
> **Source**: `docs/ideas/financial-planning.md`

---

## 1. Problem Statement

Entrepreneurs and freelancers need to answer fundamental financial questions:

1. **How much do I need to ask for?** (funding, loan, investment)
2. **How long will this money last?** (runway)
3. **What happens if revenue is late?** (scenario planning)
4. **What happens if costs go up?** (risk assessment)
5. **When do I run out of cash?** (break-even/danger point)
6. **What is fixed versus still uncertain?** (confidence tracking)

The current product provides excellent **retrospective truth** (what happened) and **near-term forecasting** (this month's cash flow), but lacks **forward planning** over 12-24 month horizons.

### Why This Matters

Most planning tools fall into two traps:
1. **Too dumb**: Raw spreadsheets with no structure
2. **Too formal**: Enterprise-grade accounting complexity for fragile startup data

The opportunity is the middle path: **structured enough to be useful, light enough to be maintainable, honest enough to reflect uncertainty**.

### Core Principle: Plan vs. Reality

> **Plan = forward-looking assumptions** (not actual money)
> **Ledger = historical truth** (actual income/expenses)
> **Comparison = power feature** (plan vs actual variance)

This mirrors ADR-010 (Receivable as Transaction Status) and the recurring expenses design (rule vs reality).

---

## 2. Product Vision

A dedicated page that helps users:
- Model expected revenue, expenses, funding needs, and runway over 12-24 months
- Compare scenarios (base case, conservative, optimistic)
- Understand their funding "ask" without turning the product into accounting software
- Compare planned vs actual performance as real data accumulates

### Mental Model

```
Assumptions → Plan → Scenarios → Answers → Monthly Maintenance
```

Not:
```
cells, formulas, and spreadsheet goblin energy
```

### UX Principle

**Do not make the user "build a model."**
Make them answer guided blocks, and generate the model for them.

The page should feel like: **part form, part simulator, part explainer.**

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Financial Planning Workspace                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────┐      ┌─────────────────────────┐                   │
│  │      Plan       │──────│   PlanAssumption[]      │                   │
│  │                 │ 1:N  │                         │                   │
│  │ - name          │      │ - category (revenue,    │                   │
│  │ - profileId     │      │   expense, funding)     │                   │
│  │ - horizonMonths │      │ - type (one-time,       │                   │
│  │ - currency      │      │   recurring, milestone) │                   │
│  │ - status        │      │ - confidence            │                   │
│  └─────────────────┘      └─────────────────────────┘                   │
│           │                                                              │
│           │ 1:N                                                          │
│           ▼                                                              │
│  ┌─────────────────┐                                                    │
│  │  PlanScenario   │   ┌─────────────────────────┐                      │
│  │                 │──>│ Computed Monthly        │                      │
│  │ - name (Base,   │   │ Projections             │                      │
│  │   Conservative) │   │                         │                      │
│  │ - overrides[]   │   │ - openingCash           │                      │
│  └─────────────────┘   │ - cashIn                │                      │
│           │            │ - cashOut               │                      │
│           │            │ - closingCash           │                      │
│           ▼            │ - confidenceScore       │                      │
│  ┌─────────────────┐   └─────────────────────────┘                      │
│  │  PlanSnapshot   │                                                    │
│  │ (cached KPIs)   │                                                    │
│  └─────────────────┘                                                    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **Separate from Ledger**: Planning data lives in its own tables, never pollutes actual financial records
2. **Profile-Scoped**: Plans belong to a BusinessProfile (ADR-015)
3. **Scenario-Based**: Multiple scenarios per plan, not single-track assumptions
4. **Confidence-Labeled**: Every assumption tagged with certainty level

---

## 4. Data Model

### 4.1 Plan Entity (New)

```typescript
interface Plan {
  id: string;
  profileId: string;              // FK to BusinessProfile
  name: string;                   // e.g., "2026 Startup Plan"
  description?: string;
  currency: Currency;             // Primary currency for plan
  startMonth: string;             // YYYY-MM format
  horizonMonths: number;          // 12, 18, or 24
  status: PlanStatus;

  // Ask calculation mode
  askMode: 'manual' | 'calculated';
  manualAskMinor?: number;        // If askMode='manual'

  // Calculated summary (cached on each save)
  cachedSummary?: PlanSummaryCache;

  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

type PlanStatus = 'draft' | 'active' | 'archived';

interface PlanSummaryCache {
  calculatedAt: string;
  askMinor: number;
  monthlyBurnMinor: number;
  runwayMonths: number;
  breakEvenMonth?: string;        // YYYY-MM or undefined if never
  worstCashDipMinor: number;
  bufferNeededMinor: number;
}
```

### 4.2 PlanAssumption Entity (New)

```typescript
interface PlanAssumption {
  id: string;
  planId: string;                 // FK to Plan
  profileId: string;              // Denormalized for query efficiency

  // Classification
  category: AssumptionCategory;
  type: AssumptionType;

  // Details
  label: string;                  // e.g., "Adobe subscription", "Seed funding"
  amountMinor: number;
  currency: Currency;

  // Timing
  startMonth: string;             // YYYY-MM
  endMonth?: string;              // YYYY-MM (optional for recurring)
  frequency?: AssumptionFrequency;
  dayOfMonth?: number;            // 1-28 for recurring

  // Confidence
  confidence: AssumptionConfidence;

  // Scenario scoping (null = applies to all scenarios)
  scenarioId?: string;            // FK to PlanScenario (if scenario-specific)

  // Notes
  notes?: string;

  createdAt: string;
  updatedAt: string;
}

type AssumptionCategory =
  | 'revenue'           // Expected income
  | 'expense'           // Expected costs
  | 'funding'           // Investment, grants, loans
  | 'hiring'            // Team costs (special expense)
  | 'fx'                // FX assumptions
  | 'other';

type AssumptionType =
  | 'one_time'          // Single occurrence
  | 'recurring'         // Monthly/yearly
  | 'milestone'         // Tied to specific month
  | 'percentage';       // Growth rate, inflation rate

type AssumptionFrequency = 'monthly' | 'quarterly' | 'yearly';

type AssumptionConfidence = 'confirmed' | 'likely' | 'rough_guess';
```

### 4.3 PlanScenario Entity (New)

```typescript
interface PlanScenario {
  id: string;
  planId: string;                 // FK to Plan
  profileId: string;              // Denormalized
  name: string;                   // e.g., "Base", "Conservative", "Optimistic"
  description?: string;
  isDefault: boolean;             // One scenario per plan is default (Base)

  // Scenario-level overrides (percentage modifiers)
  revenueMultiplier?: number;     // e.g., 0.8 for 20% lower revenue
  expenseMultiplier?: number;     // e.g., 1.2 for 20% higher costs
  revenueDelayMonths?: number;    // Shift revenue forward N months
  fundingDelayMonths?: number;    // Shift funding arrival N months

  createdAt: string;
  updatedAt: string;
}
```

### 4.4 PlanSnapshot Entity (New, Optional Phase 2)

```typescript
interface PlanSnapshot {
  id: string;
  planId: string;
  scenarioId: string;
  generatedAt: string;

  // Summary metrics at time of snapshot
  askMinor: number;
  monthlyBurnMinor: number;
  runwayMonths: number;
  breakEvenMonth?: string;

  // Full monthly projection (JSON blob)
  monthlyProjections: MonthProjection[];
}

interface MonthProjection {
  month: string;                  // YYYY-MM
  openingCashMinor: number;
  cashInMinor: number;
  cashOutMinor: number;
  netFlowMinor: number;
  closingCashMinor: number;
  confidenceScore: number;        // 0-100 based on assumptions
  events: ProjectionEvent[];      // Significant events this month
}

interface ProjectionEvent {
  type: 'funding' | 'hire' | 'big_cost' | 'milestone' | 'break_even' | 'negative_cash';
  label: string;
  amountMinor?: number;
}
```

### 4.5 Database Schema

```typescript
// Version N: Add Financial Planning tables
this.version(N).stores({
  // ... existing tables ...

  plans: 'id, profileId, status, startMonth, createdAt',
  planAssumptions: 'id, planId, profileId, category, type, confidence, startMonth, scenarioId, [planId+category]',
  planScenarios: 'id, planId, profileId, isDefault, [planId+isDefault]',
  planSnapshots: 'id, planId, scenarioId, generatedAt', // Phase 2
});
```

---

## 5. Service Layer

### 5.1 PlanCalculationService

```typescript
// src/services/planCalculationService.ts

interface CalculatePlanInput {
  planId: string;
  scenarioId?: string;            // Default scenario if not specified
}

interface PlanCalculationResult {
  summary: PlanSummary;
  monthlyProjections: MonthProjection[];
  insights: PlanInsight[];
}

interface PlanSummary {
  askMinor: number;
  askRange: {
    minimumSurvivableMinor: number;
    comfortableMinor: number;
    growthMinor: number;
  };
  monthlyBurnMinor: number;
  expectedMonthlyRevenueMinor: number;
  runwayMonths: number;
  breakEvenMonth?: string;
  worstCashDipMinor: number;
  bufferNeededMinor: number;
}

interface PlanInsight {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  // e.g., "Your current plan runs out of cash in Month 7."
  // e.g., "If revenue is delayed by 2 months, you need an extra $14,000."
  // e.g., "Your biggest cost driver is salaries, accounting for 62% of burn."
}

export const planCalculationService = {
  /**
   * Calculate plan projections for a scenario.
   * Pure computation, does not persist.
   */
  async calculate(input: CalculatePlanInput): Promise<PlanCalculationResult> {
    const plan = await planRepo.get(input.planId);
    const scenarios = await planScenarioRepo.listByPlan(input.planId);
    const scenario = input.scenarioId
      ? scenarios.find(s => s.id === input.scenarioId)
      : scenarios.find(s => s.isDefault);

    const assumptions = await planAssumptionRepo.listByPlan(input.planId);

    // Apply scenario overrides
    const adjustedAssumptions = applyScenarioOverrides(assumptions, scenario);

    // Generate monthly projections
    const monthlyProjections = generateMonthlyProjections(
      plan,
      adjustedAssumptions,
      scenario
    );

    // Calculate summary KPIs
    const summary = calculateSummary(monthlyProjections, plan);

    // Generate insights
    const insights = generateInsights(summary, monthlyProjections, assumptions);

    return { summary, monthlyProjections, insights };
  },

  /**
   * Calculate the suggested "ask" amount.
   */
  calculateAsk(
    desiredRunwayMonths: number,
    monthlyBurnMinor: number,
    worstCaseGapMinor: number,
    contingencyPercent: number,   // e.g., 0.2 for 20%
    confirmedIncomingMinor: number,
    founderContributionMinor: number
  ): AskCalculation {
    const baseNeed = desiredRunwayMonths * monthlyBurnMinor;
    const buffer = baseNeed * contingencyPercent;
    const totalNeed = baseNeed + worstCaseGapMinor + buffer;
    const netAsk = totalNeed - confirmedIncomingMinor - founderContributionMinor;

    return {
      minimumSurvivableMinor: Math.max(0, netAsk * 0.7),
      comfortableMinor: Math.max(0, netAsk),
      growthMinor: Math.max(0, netAsk * 1.3),
    };
  },

  /**
   * Compare plan to actuals for a given month range.
   */
  async comparePlanVsActual(
    planId: string,
    profileId: string,
    fromMonth: string,
    toMonth: string
  ): Promise<PlanVsActualComparison> {
    const { monthlyProjections } = await this.calculate({ planId });

    // Get actuals from ledger (transactions + expenses)
    const actuals = await moneyEventRepo.getMonthlyTotals(profileId, fromMonth, toMonth);

    return generateComparison(monthlyProjections, actuals, fromMonth, toMonth);
  },
};

interface PlanVsActualComparison {
  months: PlanVsActualMonth[];
  varianceSummary: {
    revenueVarianceMinor: number;
    expenseVarianceMinor: number;
    netVarianceMinor: number;
    revisedRunwayMonths: number;
    revisedBreakEvenMonth?: string;
  };
}

interface PlanVsActualMonth {
  month: string;
  plannedRevenueMinor: number;
  actualRevenueMinor: number;
  plannedExpenseMinor: number;
  actualExpenseMinor: number;
  plannedNetMinor: number;
  actualNetMinor: number;
}
```

---

## 6. Repository API

### 6.1 IPlanRepository (New)

```typescript
interface IPlanRepository extends BaseRepository<Plan, CreatePlanData> {
  list(filters: { profileId: string; status?: PlanStatus }): Promise<Plan[]>;
  getActive(profileId: string): Promise<Plan | undefined>;
  setActive(id: string): Promise<void>;
  archive(id: string): Promise<void>;
  duplicate(id: string, newName: string): Promise<Plan>;
}
```

### 6.2 IPlanAssumptionRepository (New)

```typescript
interface IPlanAssumptionRepository extends BaseRepository<PlanAssumption, CreateAssumptionData> {
  listByPlan(planId: string): Promise<PlanAssumption[]>;
  listByCategory(planId: string, category: AssumptionCategory): Promise<PlanAssumption[]>;
  listByScenario(planId: string, scenarioId?: string): Promise<PlanAssumption[]>;
  bulkCreate(planId: string, assumptions: CreateAssumptionData[]): Promise<PlanAssumption[]>;
  bulkUpdate(updates: { id: string; data: Partial<PlanAssumption> }[]): Promise<void>;
}
```

### 6.3 IPlanScenarioRepository (New)

```typescript
interface IPlanScenarioRepository extends BaseRepository<PlanScenario, CreateScenarioData> {
  listByPlan(planId: string): Promise<PlanScenario[]>;
  getDefault(planId: string): Promise<PlanScenario | undefined>;
  setDefault(id: string): Promise<void>;
  duplicate(id: string, newName: string): Promise<PlanScenario>;
}
```

---

## 7. UI Components

### 7.1 Component Overview

| Component | Purpose | Location |
|-----------|---------|----------|
| `PlanningPage` | Main page container | `/planning` route |
| `PlanSummaryStrip` | Top KPI cards (ask, burn, runway, etc.) | Page header |
| `AssumptionPanel` | Grouped assumption inputs | Left/main column |
| `AssumptionDrawer` | Create/edit single assumption | Drawer |
| `MonthlyTimeline` | Visual 12-24 month projection | Center |
| `ScenarioTabs` | Switch between Base/Conservative/Optimistic | Above timeline |
| `InsightPanel` | AI-generated plain-language insights | Right sidebar |
| `AskCalculator` | Dedicated ask calculation UI | Section or modal |
| `PlanVsActualView` | Comparison mode when actuals exist | Toggle view |

### 7.2 Page Structure

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Page Header                                                              │
│ ┌───────────────────────────────────────────────────────────────────┐   │
│ │ Financial Planning                                                 │   │
│ │ Model your next 12-24 months and understand your runway, ask,     │   │
│ │ and risks.                                                         │   │
│ └───────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│ [+ New Assumption]  [Duplicate Scenario]  [Export Plan]  [Compare →]    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │                     Summary KPI Strip                                │ │
│ │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │ │
│ │  │ Ask      │ │ Monthly  │ │ Expected │ │ Runway   │ │ Break-   │  │ │
│ │  │ $50,000  │ │ Burn     │ │ Revenue  │ │ 14 mo    │ │ even     │  │ │
│ │  │          │ │ $3,500   │ │ $2,000   │ │          │ │ Month 11 │  │ │
│ │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘  │ │
│ │  ┌──────────┐ ┌──────────┐                                          │ │
│ │  │ Worst    │ │ Buffer   │                                          │ │
│ │  │ Cash Dip │ │ Needed   │                                          │ │
│ │  │ -$8,000  │ │ $10,000  │                                          │ │
│ │  └──────────┘ └──────────┘                                          │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│ ┌────────────────────────────────┐ ┌──────────────────────────────────┐ │
│ │   Scenario Tabs                │ │    Insights Panel                │ │
│ │   [Base] [Conservative] [Fast] │ │                                  │ │
│ ├────────────────────────────────┤ │  ⚠️ Your current plan runs out   │ │
│ │                                │ │    of cash in Month 7.           │ │
│ │   Monthly Timeline             │ │                                  │ │
│ │                                │ │  ℹ️ If revenue is delayed by 2   │ │
│ │   ┌─────────────────────────┐  │ │    months, you need an extra     │ │
│ │   │ [Chart: 12-24 months]   │  │ │    $14,000.                      │ │
│ │   │                         │  │ │                                  │ │
│ │   │ Cash In (green bars)    │  │ │  ℹ️ Your biggest cost driver is  │ │
│ │   │ Cash Out (orange bars)  │  │ │    salaries (62% of burn).       │ │
│ │   │ Cash Balance (line)     │  │ │                                  │ │
│ │   │                         │  │ │  ✓ You break even in Month 11    │ │
│ │   │ Event markers:          │  │ │    under the base case, but not  │ │
│ │   │ 🎯 Grant arrives        │  │ │    in the conservative case.     │ │
│ │   │ 👤 Hire starts          │  │ │                                  │ │
│ │   │ ⚠️ Negative cash        │  │ │  ⚠️ Your current ask seems 18%  │ │
│ │   │ ✓ Break-even            │  │ │    lower than what your runway   │ │
│ │   └─────────────────────────┘  │ │    target requires.              │ │
│ │                                │ │                                  │ │
│ └────────────────────────────────┘ └──────────────────────────────────┘ │
│                                                                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │                     Assumptions Panel (Accordion)                    │ │
│ │                                                                      │ │
│ │ ▼ Revenue Assumptions                                                │ │
│ │   ┌────────────────────────────────────────────────────────────────┐ │ │
│ │   │ Expected one-time revenue         $10,000  ● Confirmed         │ │ │
│ │   │ Expected recurring revenue        $2,000/mo ○ Likely           │ │ │
│ │   │ Project-based revenue             $5,000   ○ Rough guess       │ │ │
│ │   │ Revenue start month               May 2026                     │ │ │
│ │   │ Payment delay assumption          30 days                      │ │ │
│ │   └────────────────────────────────────────────────────────────────┘ │ │
│ │                                                                      │ │
│ │ ▶ Cost Assumptions                                                   │ │
│ │ ▶ Funding Assumptions                                                │ │
│ │ ▶ Planning Assumptions                                               │ │
│ │                                                                      │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │                     Detailed Monthly Table                           │ │
│ │                                                                      │ │
│ │ Month    Opening   Cash In   Cash Out   Net Flow   Closing   Conf.  │ │
│ │ ──────────────────────────────────────────────────────────────────  │ │
│ │ Mar 26   $5,000    $2,000    $3,500     -$1,500    $3,500    85%    │ │
│ │ Apr 26   $3,500    $7,000    $3,500     +$3,500    $7,000    80%    │ │
│ │ May 26   $7,000    $2,000    $4,000     -$2,000    $5,000    72%    │ │
│ │ ...                                                                  │ │
│ │                                                                      │ │
│ │                              [Export CSV] [Export PDF Summary]       │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 7.3 AssumptionDrawer

```tsx
// URL pattern
?newAssumption=true&planId=X&category=revenue
?assumption=<assumptionId>  // edit mode
```

**Fields:**
- Label (required)
- Category (Revenue / Expense / Funding / Hiring / Other)
- Type (One-time / Recurring / Milestone)
- Amount (required)
- Currency (from plan default, overridable)
- Start Month (required)
- End Month (optional, for recurring)
- Frequency (if recurring: Monthly / Quarterly / Yearly)
- Day of Month (if recurring: 1-28)
- Confidence (Confirmed / Likely / Rough Guess) - **Radio with visual indicators**
- Scenario (All scenarios / Specific scenario)
- Notes (optional)

**Confidence visual:**
- 🟢 Confirmed - "This is locked in, contract signed"
- 🟡 Likely - "High probability, in negotiation"
- 🔴 Rough Guess - "Estimate, could change significantly"

### 7.4 AskCalculator (Section or Modal)

Two modes:

**A. "I know my ask"**
- User enters target ask amount
- System shows if it's sufficient for desired runway
- Traffic light indicator: 🟢 Comfortable / 🟡 Tight / 🔴 Insufficient

**B. "Help me calculate my ask"**
Inputs:
- Desired runway (months) - slider: 12/18/24
- Contingency buffer (%) - slider: 10%/20%/30%
- Founder contribution (if any)
- Already secured funding/revenue

Outputs:
```
┌────────────────────────────────────────────────────────┐
│  Your Calculated Ask Range                             │
│                                                        │
│  Minimum Survivable    $35,000   (12 months, tight)   │
│  Comfortable           $50,000   (18 months, buffer)  │
│  Growth                $65,000   (24 months, room)    │
│                                                        │
│  Based on:                                             │
│  • Monthly burn: $3,500                                │
│  • Worst-case gap: $8,000                              │
│  • 20% contingency: $10,000                            │
│  • Less: $5,000 already secured                        │
└────────────────────────────────────────────────────────┘
```

### 7.5 Confidence Heatmap (Phase 2)

Each month cell shows confidence score based on:
- % of assumptions that are "confirmed" vs "rough guess"
- Months further out = lower confidence (time decay)

Color scale: 🟢 Green (>80%) → 🟡 Yellow (50-80%) → 🟠 Orange (30-50%) → 🔴 Red (<30%)

---

## 8. First Launch Experience

### Empty State

```
┌────────────────────────────────────────────────────────┐
│                                                        │
│     📊                                                 │
│                                                        │
│  Plan your startup year                                │
│  before you spend a shekel.                            │
│                                                        │
│  Estimate your revenue, expenses, and funding needs,   │
│  then see your runway and ask.                         │
│                                                        │
│  [Create First Plan]                                   │
│                                                        │
└────────────────────────────────────────────────────────┘
```

### Onboarding Flow (Drawer-based)

**Step 1: Basic Info**
- Plan name
- Start month
- Horizon (12 / 18 / 24 months)
- Primary currency

**Step 2: Expected Revenue** (Guided blocks)
- Do you have any confirmed income? → Add one-time revenue
- Do you expect recurring revenue? → Add monthly estimate
- Do you have project-based work expected? → Add milestone

**Step 3: Expected Costs** (Grouped)
- Monthly fixed costs (rent, tools, subscriptions)
- Team costs (salaries, contractors)
- One-time setup costs
- Variable costs

**Step 4: Funding & Ask**
- How much do you already have? (Founder contribution)
- Have you secured any funding? (Grants, loans)
- Choose: "I know my ask" or "Calculate it for me"

**Step 5: Review & Generate**
- Show summary of inputs
- Generate first projection
- Land on full Planning page

---

## 9. Plan vs Actual Mode

When user has been using the ledger, the page gains a powerful comparison mode.

### Toggle

```
[Planning Mode] [Plan vs Actual Mode]
```

### Comparison View

```
┌────────────────────────────────────────────────────────────────────────┐
│                                                                        │
│  Planned Revenue vs Actual Revenue                                     │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │   Month    Planned    Actual    Variance                          │ │
│  │   ─────────────────────────────────────────────                   │ │
│  │   Mar 26   $2,000     $2,400    +$400 (+20%)  🟢                  │ │
│  │   Apr 26   $2,000     $1,800    -$200 (-10%)  🟡                  │ │
│  │   May 26   $2,500     —         (pending)                          │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  Planned Expenses vs Actual Expenses                                   │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │   Month    Planned    Actual    Variance                          │ │
│  │   ─────────────────────────────────────────────                   │ │
│  │   Mar 26   $3,500     $3,200    -$300 (-9%)   🟢                  │ │
│  │   Apr 26   $3,500     $4,100    +$600 (+17%)  🟠                  │ │
│  │   May 26   $3,800     —         (pending)                          │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  Revised Projections                                                   │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │   Original runway:     14 months                                  │ │
│  │   Revised runway:      12 months  ⚠️ -2 months                   │ │
│  │   Original break-even: Month 11                                   │ │
│  │   Revised break-even:  Month 13  ⚠️ +2 months delay              │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 10. What NOT To Do

### Avoid These Traps

1. **Do not turn this into accounting**
   - No taxes, no balance sheet, no profit & loss statements
   - This is planning, not bookkeeping

2. **Do not force spreadsheet editing**
   - Tables exist for viewing/export
   - Primary interaction is through guided inputs and drawers

3. **Do not hide assumptions**
   - Every result must be traceable to visible assumptions
   - Show the math, not just the answer

4. **Do not mix currencies silently**
   - Per ADR-004: per-currency by default
   - Converted totals only when explicit

5. **Do not over-automate certainty**
   - At startup stage, most numbers are assumptions
   - Confidence labels keep this honest

---

## 11. Integration with Existing Features

### 11.1 Route

```
/planning or /runway
```

Fits between Money (Home/Income/Expenses) and Context (Clients/Projects) in nav hierarchy.

### 11.2 Drawer-First

Following ADR-003, all assumption creation/editing happens in drawers.

### 11.3 URL-Driven State

```typescript
// URL patterns
/planning?plan=<planId>&scenario=<scenarioId>
/planning?plan=<planId>&mode=actual  // Plan vs Actual mode
/planning?newPlan=true               // Create flow
/planning?assumption=<id>            // Edit assumption
/planning?newAssumption=true&category=revenue
```

### 11.4 Profile Scoping

Plans belong to a BusinessProfile (ADR-015). UI respects active profile context.

### 11.5 Recurring Expenses Integration

If RecurringRule entities exist, optionally import them as expense assumptions:
- "Import from recurring expenses" button
- Creates plan assumptions from active recurring rules
- Marks as "Confirmed" confidence

### 11.6 Retainer Integration

If RetainerAgreement entities exist with active status:
- "Import from retainers" button
- Creates revenue assumptions from active retainers
- Marks as "Confirmed" or "Likely" based on status

---

## 12. Implementation Plan

### Phase 1: Core System (MVP)

1. **Data Model**
   - Plan, PlanAssumption, PlanScenario entities
   - Database schema migration
   - Repository implementations

2. **Service Layer**
   - `planCalculationService` - monthly projection calculation
   - Ask calculation logic
   - Basic insights generation

3. **UI: Planning Page**
   - Page route and shell
   - Summary KPI strip
   - Empty state and onboarding flow

4. **UI: Assumption Management**
   - AssumptionDrawer (create/edit)
   - AssumptionPanel (grouped list with accordion)
   - Confidence indicators

5. **UI: Timeline Visualization**
   - Monthly timeline chart (basic bar chart)
   - Cash balance line
   - Event markers

6. **UI: Scenario Tabs**
   - Scenario switcher
   - Scenario creation
   - Multiplier overrides

7. **Export**
   - CSV export of monthly table
   - Basic summary export

### Phase 2: Enhancement

- Plan vs Actual comparison mode
- Confidence heatmap per month
- "What changed" log when assumptions update
- Funding milestone markers
- Import from recurring expenses/retainers
- Snapshot history
- PDF export for decks/grants
- Plan templates (Freelancer, Agency, SaaS, etc.)

### Phase 3: Polish

- Uncertainty visualization improvements
- Mobile-responsive timeline
- Keyboard navigation
- Guided tour / onboarding hints
- Localization (AR support)

---

## 13. i18n Keys

```json
{
  "planning": {
    "title": "Financial Planning",
    "subtitle": "Model your next 12-24 months",

    "plan": {
      "create": "Create Plan",
      "edit": "Edit Plan",
      "duplicate": "Duplicate Plan",
      "archive": "Archive Plan",
      "name": "Plan Name",
      "startMonth": "Start Month",
      "horizon": "Planning Horizon",
      "horizonMonths": "{{count}} months"
    },

    "summary": {
      "ask": "Ask Amount",
      "monthlyBurn": "Monthly Burn",
      "expectedRevenue": "Expected Revenue",
      "runway": "Runway",
      "runwayMonths": "{{count}} months",
      "breakEven": "Break-even",
      "worstCashDip": "Worst Cash Dip",
      "bufferNeeded": "Buffer Needed"
    },

    "assumptions": {
      "title": "Assumptions",
      "add": "Add Assumption",
      "edit": "Edit Assumption",

      "category": {
        "revenue": "Revenue",
        "expense": "Expense",
        "funding": "Funding",
        "hiring": "Hiring",
        "other": "Other"
      },

      "type": {
        "one_time": "One-time",
        "recurring": "Recurring",
        "milestone": "Milestone"
      },

      "confidence": {
        "confirmed": "Confirmed",
        "confirmedDesc": "Locked in, contract signed",
        "likely": "Likely",
        "likelyDesc": "High probability, in negotiation",
        "rough_guess": "Rough Guess",
        "rough_guessDesc": "Estimate, could change"
      }
    },

    "scenarios": {
      "title": "Scenarios",
      "base": "Base Case",
      "conservative": "Conservative",
      "optimistic": "Optimistic",
      "create": "Create Scenario",
      "duplicate": "Duplicate Scenario"
    },

    "ask": {
      "title": "Calculate Your Ask",
      "iKnowMyAsk": "I know my ask",
      "calculateForMe": "Calculate it for me",
      "desiredRunway": "Desired Runway",
      "contingencyBuffer": "Contingency Buffer",
      "founderContribution": "Founder Contribution",
      "alreadySecured": "Already Secured",
      "minimumSurvivable": "Minimum Survivable",
      "comfortable": "Comfortable",
      "growth": "Growth"
    },

    "insights": {
      "title": "Insights",
      "runOutOfCash": "Your current plan runs out of cash in {{month}}.",
      "revenueDelayed": "If revenue is delayed by {{months}} months, you need an extra {{amount}}.",
      "biggestCostDriver": "Your biggest cost driver is {{category}}, accounting for {{percent}}% of burn.",
      "breakEvenDifference": "You break even in {{baseMonth}} under the base case, but not until {{conservativeMonth}} in the conservative case.",
      "askTooLow": "Your current ask seems {{percent}}% lower than what your runway target requires."
    },

    "comparison": {
      "title": "Plan vs Actual",
      "planned": "Planned",
      "actual": "Actual",
      "variance": "Variance",
      "revisedRunway": "Revised Runway",
      "revisedBreakEven": "Revised Break-even"
    },

    "export": {
      "csv": "Export CSV",
      "pdf": "Export PDF Summary",
      "forGrants": "Export for Grants"
    },

    "emptyState": {
      "title": "Plan your startup year",
      "description": "Estimate your revenue, expenses, and funding needs, then see your runway and ask.",
      "cta": "Create First Plan"
    }
  }
}
```

---

## 14. Test Plan

### 14.1 Unit Tests (Service Layer)

- `planCalculationService.calculate()` - correct monthly projections
- `planCalculationService.calculateAsk()` - ask range calculation
- `applyScenarioOverrides()` - multipliers and delays applied correctly
- `generateMonthlyProjections()` - handles all assumption types
- `generateInsights()` - produces relevant insights

### 14.2 Repository Tests

- `planRepo.create()` - validates required fields
- `planRepo.duplicate()` - creates copy with all assumptions
- `planAssumptionRepo.listByPlan()` - returns all plan assumptions
- `planScenarioRepo.setDefault()` - only one default per plan

### 14.3 Component Tests

- `PlanSummaryStrip` - renders all KPI cards correctly
- `AssumptionDrawer` - form validation, confidence radio
- `MonthlyTimeline` - chart renders with correct data
- `ScenarioTabs` - switching scenarios updates projections
- `AskCalculator` - both modes work correctly

### 14.4 Integration Tests

- Create plan → add assumptions → see projections
- Change scenario → KPIs update
- Edit assumption → timeline updates
- Plan vs Actual mode shows comparison
- Export produces valid CSV

---

## 15. Acceptance Criteria

### Must Have (Phase 1)

- [ ] User can create a financial plan with 12/18/24 month horizon
- [ ] User can add assumptions (revenue, expense, funding) with confidence levels
- [ ] System calculates monthly projections (opening/closing cash, net flow)
- [ ] Summary KPIs display: ask, burn, runway, break-even
- [ ] User can switch between at least 2 scenarios (Base, Conservative)
- [ ] Insights panel shows plain-language guidance
- [ ] Ask calculator provides range (minimum/comfortable/growth)
- [ ] CSV export of monthly projection table
- [ ] Plans are profile-scoped (ADR-015)
- [ ] Drawer-first UX (ADR-003)
- [ ] URL-driven state (ADR-008)
- [ ] Ledger data is never affected by planning data

### Nice to Have (Phase 2)

- [ ] Plan vs Actual comparison mode
- [ ] Confidence heatmap per month
- [ ] Import assumptions from recurring expenses
- [ ] Import assumptions from retainers
- [ ] Plan templates
- [ ] PDF export for grants/investors
- [ ] "What changed" log

---

## 16. Reuse Analysis

| Existing Component | Reuse Strategy |
|-------------------|----------------|
| `DateRangeControl` | Adapt for month picker |
| `CurrencyInput` | Reuse for amount input |
| `StepperInput` | Use for day-of-month, runway slider |
| `Select` | Use for category, frequency dropdowns |
| `KPICard` | Reuse for summary strip |
| `EmptyState` | Use for no plans state |
| `Modal` | Use for ask calculator modal |
| `CurrencyTabs` | Adapt for scenario tabs pattern |
| `DataTable` | Use for monthly projection table |
| `toast` | Use for save/export feedback |

**New Components Needed:**
- `AssumptionDrawer` (new drawer type)
- `MonthlyTimeline` (chart component)
- `ScenarioTabs` (scenario switcher)
- `InsightPanel` (insights display)
- `AskCalculator` (calculation UI)
- `ConfidenceIndicator` (visual confidence display)

---

## 17. References

- ADR-002: Repository Pattern for Storage Abstraction
- ADR-003: Drawer-First UX Pattern
- ADR-004: Multi-Currency as First-Class Citizen
- ADR-008: URL-Driven Drawer State
- ADR-009: Amounts in Minor Units (Cents)
- ADR-015: Profile-Scoped Expenses
- `docs/ideas/financial-planning.md` - Original idea document
- Recurring Expenses Design - Similar rule vs reality pattern
- `src/types/index.ts` - Existing type definitions
- `src/lib/aggregations.ts` - Aggregation patterns
