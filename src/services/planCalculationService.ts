/**
 * Plan Calculation Service
 *
 * Pure functions for calculating financial projections, summaries,
 * ask ranges, and insights for a financial plan.
 */

import type {
  Plan,
  PlanAssumption,
  PlanScenario,
  MonthProjection,
  PlanSummary,
  PlanInsight,
  ProjectionEvent,
  AssumptionCategory,
  Currency,
  CurrencyBreakdown,
} from '../types';
import { convertAmount } from '../lib/fx';

// ============================================================================
// FX Rate Types
// ============================================================================

export interface FxRates {
  /** USD to ILS rate (how many ILS per 1 USD) */
  usdToIls: number | null;
}

// ============================================================================
// Constants
// ============================================================================

const CONFIDENCE_WEIGHTS: Record<string, number> = {
  confirmed: 100,
  likely: 75,
  rough_guess: 50,
};

/**
 * Create an empty currency breakdown
 */
function emptyCurrencyBreakdown(): CurrencyBreakdown {
  return { usdMinor: 0, ilsMinor: 0, eurMinor: 0 };
}

/**
 * Add amount to the appropriate currency bucket
 */
function addToCurrencyBreakdown(
  breakdown: CurrencyBreakdown,
  amount: number,
  currency: Currency
): void {
  switch (currency) {
    case 'USD':
      breakdown.usdMinor += amount;
      break;
    case 'ILS':
      breakdown.ilsMinor += amount;
      break;
    case 'EUR':
      breakdown.eurMinor += amount;
      break;
  }
}

const BUFFER_MONTHS_COMFORTABLE = 3;
const BUFFER_MONTHS_GROWTH = 6;
const LOW_RUNWAY_THRESHOLD = 6;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Add months to a YYYY-MM string
 */
function addMonths(monthStr: string, months: number): string {
  const [year, month] = monthStr.split('-').map(Number);
  const date = new Date(year, month - 1 + months, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Compare two YYYY-MM strings
 * Returns -1 if a < b, 0 if a === b, 1 if a > b
 */
function compareMonths(a: string, b: string): number {
  return a.localeCompare(b);
}

/**
 * Check if a month is within a range (inclusive)
 */
function isMonthInRange(month: string, start: string, end?: string): boolean {
  if (compareMonths(month, start) < 0) return false;
  if (end && compareMonths(month, end) > 0) return false;
  return true;
}

/**
 * Generate array of month strings from start for N months
 */
function generateMonthRange(startMonth: string, count: number): string[] {
  const months: string[] = [];
  for (let i = 0; i < count; i++) {
    months.push(addMonths(startMonth, i));
  }
  return months;
}

/**
 * Check if an assumption applies to a given month
 */
function assumptionAppliesInMonth(
  assumption: PlanAssumption,
  month: string
): boolean {
  // Check if month is within assumption's range
  const inRange = isMonthInRange(month, assumption.startMonth, assumption.endMonth);
  if (!inRange) {
    return false;
  }

  // For one-time, only applies in the start month
  if (assumption.type === 'one_time') {
    return month === assumption.startMonth;
  }

  // For recurring, check frequency
  if (assumption.type === 'recurring' && assumption.frequency) {
    const startParts = assumption.startMonth.split('-').map(Number);
    const monthParts = month.split('-').map(Number);

    const startMonthNum = startParts[0] * 12 + startParts[1];
    const currentMonthNum = monthParts[0] * 12 + monthParts[1];
    const monthsDiff = currentMonthNum - startMonthNum;

    if (monthsDiff < 0) {
      return false;
    }

    switch (assumption.frequency) {
      case 'monthly':
        return true;
      case 'quarterly':
        return monthsDiff % 3 === 0;
      case 'yearly':
        return monthsDiff % 12 === 0;
      default:
        return true;
    }
  }

  return true;
}

/**
 * Determine if a category contributes to cash in or cash out
 */
function getCategoryFlowDirection(
  category: AssumptionCategory
): 'in' | 'out' {
  switch (category) {
    case 'revenue':
    case 'funding':
      return 'in';
    case 'expense':
    case 'hiring':
    case 'other':
      return 'out';
  }
}

/**
 * Convert an amount from one currency to the plan's currency
 */
function convertToBaseCurrency(
  amountMinor: number,
  fromCurrency: Currency,
  toCurrency: Currency,
  fxRates: FxRates
): number {
  // Same currency, no conversion needed
  if (fromCurrency === toCurrency) {
    return amountMinor;
  }

  // Get the appropriate rate
  const rate = fxRates.usdToIls;

  // If no rate available, skip this assumption
  if (rate === null || rate <= 0) {
    return 0;
  }

  // Convert based on direction
  if (fromCurrency === 'USD' && toCurrency === 'ILS') {
    return convertAmount(amountMinor, fromCurrency, toCurrency, rate);
  } else if (fromCurrency === 'ILS' && toCurrency === 'USD') {
    return convertAmount(amountMinor, fromCurrency, toCurrency, 1 / rate);
  }

  // Unsupported conversion
  return 0;
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Apply scenario overrides to a list of assumptions
 * Returns a new array with adjusted assumptions (does not modify originals)
 */
export function applyScenarioOverrides(
  assumptions: PlanAssumption[],
  scenario: PlanScenario
): PlanAssumption[] {
  return assumptions.map((assumption) => {
    const adjusted = { ...assumption };

    // Apply multipliers based on category
    if (assumption.category === 'revenue' && scenario.revenueMultiplier != null) {
      adjusted.amountMinor = Math.round(assumption.amountMinor * scenario.revenueMultiplier);
    }

    if (
      (assumption.category === 'expense' || assumption.category === 'hiring') &&
      scenario.expenseMultiplier != null
    ) {
      adjusted.amountMinor = Math.round(assumption.amountMinor * scenario.expenseMultiplier);
    }

    // Apply delays
    if (assumption.category === 'revenue' && scenario.revenueDelayMonths) {
      adjusted.startMonth = addMonths(assumption.startMonth, scenario.revenueDelayMonths);
      if (assumption.endMonth) {
        adjusted.endMonth = addMonths(assumption.endMonth, scenario.revenueDelayMonths);
      }
    }

    if (assumption.category === 'funding' && scenario.fundingDelayMonths) {
      adjusted.startMonth = addMonths(assumption.startMonth, scenario.fundingDelayMonths);
    }

    return adjusted;
  });
}

/**
 * Generate monthly projections for a plan
 * All amounts are converted to the plan's base currency using FX rates
 */
export function generateMonthlyProjections(
  plan: Plan,
  assumptions: PlanAssumption[],
  fxRates: FxRates = { usdToIls: null }
): MonthProjection[] {
  const months = generateMonthRange(plan.startMonth, plan.horizonMonths);
  const projections: MonthProjection[] = [];
  let runningCash = 0;

  for (const month of months) {
    let cashInMinor = 0;
    let cashOutMinor = 0;
    const events: ProjectionEvent[] = [];
    let totalConfidenceWeight = 0;
    let activeAssumptionCount = 0;

    // Process each assumption
    for (const assumption of assumptions) {
      const applies = assumptionAppliesInMonth(assumption, month);
      if (!applies) continue;

      // Convert amount to plan's base currency
      const convertedAmount = convertToBaseCurrency(
        assumption.amountMinor,
        assumption.currency,
        plan.currency,
        fxRates
      );

      // Skip if conversion failed (no FX rate available)
      if (convertedAmount === 0 && assumption.amountMinor !== 0) {
        continue;
      }

      const direction = getCategoryFlowDirection(assumption.category);
      if (direction === 'in') {
        cashInMinor += convertedAmount;
      } else {
        cashOutMinor += convertedAmount;
      }

      // Track confidence
      totalConfidenceWeight += CONFIDENCE_WEIGHTS[assumption.confidence] || 50;
      activeAssumptionCount++;

      // Generate events for significant items
      if (assumption.category === 'funding' && assumption.type === 'one_time') {
        events.push({
          type: 'funding',
          label: assumption.label,
          amountMinor: convertedAmount,
        });
      }

      if (assumption.category === 'hiring' && assumption.startMonth === month) {
        events.push({
          type: 'hire',
          label: assumption.label,
          amountMinor: convertedAmount,
        });
      }
    }

    const openingCashMinor = runningCash;
    const netFlowMinor = cashInMinor - cashOutMinor;
    const closingCashMinor = openingCashMinor + netFlowMinor;
    runningCash = closingCashMinor;

    // Calculate confidence score
    const confidenceScore =
      activeAssumptionCount > 0
        ? Math.round(totalConfidenceWeight / activeAssumptionCount)
        : 100; // If no assumptions, full confidence

    // Add negative cash event
    if (closingCashMinor < 0 && openingCashMinor >= 0) {
      events.push({
        type: 'negative_cash',
        label: 'Cash goes negative',
        amountMinor: closingCashMinor,
      });
    }

    // Add break-even event
    if (netFlowMinor >= 0 && projections.length > 0) {
      const prevMonth = projections[projections.length - 1];
      if (prevMonth.netFlowMinor < 0) {
        events.push({
          type: 'break_even',
          label: 'Break-even reached',
        });
      }
    }

    projections.push({
      month,
      openingCashMinor,
      cashInMinor,
      cashOutMinor,
      netFlowMinor,
      closingCashMinor,
      confidenceScore,
      events,
    });
  }

  return projections;
}

/**
 * Calculate summary metrics from projections
 */
export function calculateSummary(
  projections: MonthProjection[],
  plan: Plan,
  assumptions: PlanAssumption[] = []
): PlanSummary {
  const emptyBreakdown = emptyCurrencyBreakdown;

  if (projections.length === 0) {
    return {
      askMinor: 0,
      askRange: {
        minimumSurvivableMinor: 0,
        comfortableMinor: 0,
        growthMinor: 0,
      },
      monthlyBurnMinor: 0,
      expectedMonthlyRevenueMinor: 0,
      runwayMonths: plan.horizonMonths,
      breakEvenMonth: undefined,
      worstCashDipMinor: 0,
      bufferNeededMinor: 0,
      askByCurrency: emptyBreakdown(),
      burnByCurrency: emptyBreakdown(),
      revenueByCurrency: emptyBreakdown(),
      worstDipByCurrency: emptyBreakdown(),
      bufferByCurrency: emptyBreakdown(),
    };
  }

  // Calculate currency breakdowns from assumptions
  const burnByCurrency = emptyBreakdown();
  const revenueByCurrency = emptyBreakdown();

  // Process assumptions to calculate monthly totals by currency
  for (const assumption of assumptions) {
    const direction = getCategoryFlowDirection(assumption.category);

    // Calculate monthly amount based on type/frequency
    let monthlyAmount = assumption.amountMinor;
    if (assumption.type === 'recurring') {
      // For recurring, amount is already per occurrence
      // Convert to monthly average based on frequency
      switch (assumption.frequency) {
        case 'quarterly':
          monthlyAmount = Math.round(assumption.amountMinor / 3);
          break;
        case 'yearly':
          monthlyAmount = Math.round(assumption.amountMinor / 12);
          break;
        // monthly stays as-is
      }
    } else if (assumption.type === 'one_time') {
      // One-time: spread across the plan horizon
      monthlyAmount = Math.round(assumption.amountMinor / plan.horizonMonths);
    }

    if (direction === 'out') {
      addToCurrencyBreakdown(burnByCurrency, monthlyAmount, assumption.currency);
    } else {
      addToCurrencyBreakdown(revenueByCurrency, monthlyAmount, assumption.currency);
    }
  }

  // Calculate monthly burn (average negative net flow, 0 if positive)
  const negativePeriods = projections.filter((p) => p.netFlowMinor < 0);
  const monthlyBurnMinor =
    negativePeriods.length > 0
      ? Math.round(
          negativePeriods.reduce((sum, p) => sum + Math.abs(p.netFlowMinor), 0) /
            negativePeriods.length
        )
      : 0;

  // Calculate expected monthly revenue
  const totalRevenue = projections.reduce((sum, p) => sum + p.cashInMinor, 0);
  const expectedMonthlyRevenueMinor = Math.round(totalRevenue / projections.length);

  // Find runway (months until cash goes negative)
  let runwayMonths = projections.length;
  for (let i = 0; i < projections.length; i++) {
    if (projections[i].closingCashMinor < 0) {
      runwayMonths = i;
      break;
    }
  }

  // Find break-even month (first month with strictly positive net flow)
  let breakEvenMonth: string | undefined;
  for (const p of projections) {
    if (p.netFlowMinor > 0) {
      breakEvenMonth = p.month;
      break;
    }
  }

  // Find worst cash dip
  const worstCashDipMinor = Math.min(
    ...projections.map((p) => p.closingCashMinor)
  );

  // Calculate ask range
  const askRange = calculateAsk({
    worstCashDipMinor,
    monthlyBurnMinor,
    runwayMonths,
  });

  // Calculate buffer needed
  const bufferNeededMinor = monthlyBurnMinor * BUFFER_MONTHS_COMFORTABLE;

  // Calculate buffer by currency (scale each currency's burn by buffer months)
  const bufferByCurrency = emptyCurrencyBreakdown();
  bufferByCurrency.usdMinor = burnByCurrency.usdMinor * BUFFER_MONTHS_COMFORTABLE;
  bufferByCurrency.ilsMinor = burnByCurrency.ilsMinor * BUFFER_MONTHS_COMFORTABLE;
  bufferByCurrency.eurMinor = burnByCurrency.eurMinor * BUFFER_MONTHS_COMFORTABLE;

  // Ask by currency is same as worst dip coverage + buffer
  // For simplicity, we show buffer as the ask since it represents comfortable funding
  const askByCurrency = { ...bufferByCurrency };

  // Worst dip by currency: for now we don't have per-currency cash tracking,
  // so we'll approximate based on burn ratios
  const worstDipByCurrency = emptyCurrencyBreakdown();
  const totalBurn = burnByCurrency.usdMinor + burnByCurrency.ilsMinor + burnByCurrency.eurMinor;
  if (totalBurn > 0 && worstCashDipMinor < 0) {
    const absWorstDip = Math.abs(worstCashDipMinor);
    worstDipByCurrency.usdMinor = Math.round(absWorstDip * (burnByCurrency.usdMinor / totalBurn));
    worstDipByCurrency.ilsMinor = Math.round(absWorstDip * (burnByCurrency.ilsMinor / totalBurn));
    worstDipByCurrency.eurMinor = Math.round(absWorstDip * (burnByCurrency.eurMinor / totalBurn));
  }

  return {
    askMinor: plan.askMode === 'manual' && plan.manualAskMinor != null
      ? plan.manualAskMinor
      : askRange.comfortableMinor,
    askRange,
    monthlyBurnMinor,
    expectedMonthlyRevenueMinor,
    runwayMonths,
    breakEvenMonth,
    worstCashDipMinor,
    bufferNeededMinor,
    askByCurrency,
    burnByCurrency,
    revenueByCurrency,
    worstDipByCurrency,
    bufferByCurrency,
  };
}

/**
 * Calculate ask range
 */
export function calculateAsk(params: {
  worstCashDipMinor: number;
  monthlyBurnMinor: number;
  runwayMonths: number;
}): {
  minimumSurvivableMinor: number;
  comfortableMinor: number;
  growthMinor: number;
} {
  const { worstCashDipMinor, monthlyBurnMinor } = params;

  // Minimum = cover the worst dip
  const minimumSurvivableMinor = worstCashDipMinor < 0
    ? Math.abs(worstCashDipMinor)
    : 0;

  // Comfortable = minimum + buffer
  const comfortableMinor =
    minimumSurvivableMinor + monthlyBurnMinor * BUFFER_MONTHS_COMFORTABLE;

  // Growth = comfortable + additional runway
  const growthMinor =
    comfortableMinor + monthlyBurnMinor * BUFFER_MONTHS_GROWTH;

  return {
    minimumSurvivableMinor,
    comfortableMinor,
    growthMinor,
  };
}

/**
 * Generate insights from the plan analysis
 */
export function generateInsights(
  summary: PlanSummary,
  projections: MonthProjection[],
  assumptions: PlanAssumption[]
): PlanInsight[] {
  const insights: PlanInsight[] = [];
  let insightId = 0;

  // Critical: Negative cash flow
  const hasNegativeCash = projections.some((p) => p.closingCashMinor < 0);
  if (hasNegativeCash) {
    const firstNegativeMonth = projections.find((p) => p.closingCashMinor < 0);
    insights.push({
      id: `insight-${++insightId}`,
      severity: 'critical',
      messageKey: 'planning.insights.negativeCash',
      variables: {
        month: firstNegativeMonth?.month || '',
        amount: Math.abs(firstNegativeMonth?.closingCashMinor || 0),
      },
    });
  }

  // Warning: Low runway
  if (summary.runwayMonths < LOW_RUNWAY_THRESHOLD && summary.runwayMonths > 0) {
    insights.push({
      id: `insight-${++insightId}`,
      severity: 'warning',
      messageKey: 'planning.insights.lowRunway',
      variables: {
        months: summary.runwayMonths,
      },
    });
  }

  // Warning: Low confidence assumptions
  const lowConfidenceAssumptions = assumptions.filter(
    (a) => a.confidence === 'rough_guess' && a.amountMinor >= 500000
  );
  if (lowConfidenceAssumptions.length > 0) {
    insights.push({
      id: `insight-${++insightId}`,
      severity: 'warning',
      messageKey: 'planning.insights.lowConfidenceAssumptions',
      variables: {
        count: lowConfidenceAssumptions.length,
      },
    });
  }

  // Info: Break-even reached
  if (summary.breakEvenMonth) {
    insights.push({
      id: `insight-${++insightId}`,
      severity: 'info',
      messageKey: 'planning.insights.breakEvenReached',
      variables: {
        month: summary.breakEvenMonth,
      },
    });
  }

  // Info: No funding needed
  if (summary.askRange.minimumSurvivableMinor === 0 && summary.monthlyBurnMinor === 0) {
    insights.push({
      id: `insight-${++insightId}`,
      severity: 'info',
      messageKey: 'planning.insights.selfSustaining',
    });
  }

  // Warning: High burn rate
  if (
    summary.monthlyBurnMinor > 0 &&
    summary.monthlyBurnMinor > summary.expectedMonthlyRevenueMinor
  ) {
    insights.push({
      id: `insight-${++insightId}`,
      severity: 'warning',
      messageKey: 'planning.insights.highBurnRate',
      variables: {
        burn: summary.monthlyBurnMinor,
        revenue: summary.expectedMonthlyRevenueMinor,
      },
    });
  }

  return insights;
}

/**
 * Main entry point: Calculate complete plan analysis
 */
export function calculatePlan(
  plan: Plan,
  assumptions: PlanAssumption[],
  scenario: PlanScenario,
  fxRates: FxRates = { usdToIls: null }
): {
  summary: PlanSummary;
  monthlyProjections: MonthProjection[];
  insights: PlanInsight[];
} {
  // Filter assumptions for this scenario
  const relevantAssumptions = assumptions.filter(
    (a) => !a.scenarioId || a.scenarioId === scenario.id
  );

  // Apply scenario overrides
  const adjustedAssumptions = applyScenarioOverrides(
    relevantAssumptions,
    scenario
  );

  // Generate projections with FX conversion
  const monthlyProjections = generateMonthlyProjections(plan, adjustedAssumptions, fxRates);

  // Calculate summary (pass assumptions for currency breakdowns)
  const summary = calculateSummary(monthlyProjections, plan, adjustedAssumptions);

  // Generate insights
  const insights = generateInsights(summary, monthlyProjections, adjustedAssumptions);

  return {
    summary,
    monthlyProjections,
    insights,
  };
}
