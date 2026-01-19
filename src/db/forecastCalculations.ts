import type {
  RecurringRule,
  Expense,
  Currency,
  ExpenseForecast,
  ForecastMonth,
} from '../types';

/**
 * Check if a recurring rule should generate an occurrence in a given month
 */
function shouldRuleOccurInMonth(rule: RecurringRule, year: number, month: number): boolean {
  const startDate = new Date(rule.startDate);
  const checkDate = new Date(year, month - 1, 1);

  // Rule hasn't started yet
  if (checkDate < startDate) return false;

  // Check end conditions
  if (rule.endMode === 'endOfYear') {
    const ruleEndYear = startDate.getFullYear();
    if (year > ruleEndYear) return false;
  } else if (rule.endMode === 'untilDate' && rule.endDate) {
    const endDate = new Date(rule.endDate);
    if (checkDate > endDate) return false;
  }
  // 'noEnd' has no end date check

  // Check frequency
  if (rule.frequency === 'monthly') {
    return true;
  } else if (rule.frequency === 'yearly') {
    // Only occurs in the same month as the start date
    return month === startDate.getMonth() + 1;
  }

  return false;
}

/**
 * Calculate projected expense for a specific month from recurring rules
 */
function calculateMonthlyProjection(
  rules: RecurringRule[],
  year: number,
  month: number,
  currency: Currency
): number {
  return rules
    .filter((r) => r.currency === currency && !r.isPaused)
    .reduce((sum, rule) => {
      if (shouldRuleOccurInMonth(rule, year, month)) {
        return sum + rule.amountMinor;
      }
      return sum;
    }, 0);
}

/**
 * Calculate actual expenses for a specific month
 */
function calculateMonthlyActual(
  expenses: Expense[],
  year: number,
  month: number,
  currency: Currency
): number {
  return expenses
    .filter((e) => {
      if (e.deletedAt) return false;
      if (e.currency !== currency) return false;
      const expenseDate = new Date(e.occurredAt);
      return expenseDate.getFullYear() === year && expenseDate.getMonth() + 1 === month;
    })
    .reduce((sum, e) => sum + e.amountMinor, 0);
}

/**
 * Calculate expense forecast for a year
 *
 * - Past months: use actual expenses
 * - Future months: project from active recurring rules
 */
export function calculateExpenseForecast(input: {
  recurringRules: RecurringRule[];
  actualExpenses: Expense[];
  year: number;
  currency: Currency;
  profileId: string;
  profileName: string;
}): ExpenseForecast {
  const { recurringRules, actualExpenses, year, currency, profileId, profileName } = input;

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const breakdown: ForecastMonth[] = [];
  let projectedTotal = 0;

  for (let month = 1; month <= 12; month++) {
    // Determine if this month is in the past
    const isPast =
      year < currentYear || (year === currentYear && month <= currentMonth);

    if (isPast) {
      // Use actual expenses for past months
      const actualMinor = calculateMonthlyActual(actualExpenses, year, month, currency);

      breakdown.push({
        month,
        year,
        projectedMinor: actualMinor,
        actualMinor,
        isPast: true,
      });
      projectedTotal += actualMinor;
    } else {
      // Project from recurring rules for future months
      const projectedMinor = calculateMonthlyProjection(recurringRules, year, month, currency);

      breakdown.push({
        month,
        year,
        projectedMinor,
        isPast: false,
      });
      projectedTotal += projectedMinor;
    }
  }

  // Calculate months remaining
  let monthsRemaining = 0;
  if (year === currentYear) {
    monthsRemaining = 12 - currentMonth;
  } else if (year > currentYear) {
    monthsRemaining = 12;
  }

  return {
    profileId,
    profileName,
    year,
    monthsRemaining,
    projectedTotalMinor: projectedTotal,
    currency,
    breakdown,
  };
}

/**
 * Calculate "minimum needed funds" from today until end of year
 * This is the sum of projected recurring expenses for remaining months
 */
export function calculateMinimumNeededFunds(input: {
  recurringRules: RecurringRule[];
  year: number;
  currency: Currency;
}): number {
  const { recurringRules, year, currency } = input;

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  // If we're past this year, nothing is needed
  if (year < currentYear) return 0;

  let total = 0;
  const startMonth = year === currentYear ? currentMonth + 1 : 1;

  for (let month = startMonth; month <= 12; month++) {
    total += calculateMonthlyProjection(recurringRules, year, month, currency);
  }

  return total;
}

/**
 * Generate virtual expense occurrences from recurring rules for a date range
 * Useful for displaying projected expenses in lists
 */
export interface VirtualExpense {
  ruleId: string;
  title: string;
  vendor?: string;
  categoryId?: string;
  amountMinor: number;
  currency: Currency;
  occurredAt: string; // The virtual occurrence date
  isProjected: true;
}

export function generateVirtualExpenses(
  rules: RecurringRule[],
  dateFrom: string,
  dateTo: string
): VirtualExpense[] {
  const startDate = new Date(dateFrom);
  const endDate = new Date(dateTo);
  const virtualExpenses: VirtualExpense[] = [];

  for (const rule of rules) {
    if (rule.isPaused) continue;

    const ruleStart = new Date(rule.startDate);

    // Iterate through each month in the range
    const current = new Date(startDate.getFullYear(), startDate.getMonth(), 1);

    while (current <= endDate) {
      const year = current.getFullYear();
      const month = current.getMonth() + 1;

      if (shouldRuleOccurInMonth(rule, year, month)) {
        // Determine the day for this occurrence
        const ruleDay = ruleStart.getDate();
        const lastDayOfMonth = new Date(year, month, 0).getDate();
        const day = Math.min(ruleDay, lastDayOfMonth);

        const occurrenceDate = new Date(year, month - 1, day);

        // Only include if within the date range
        if (occurrenceDate >= startDate && occurrenceDate <= endDate) {
          virtualExpenses.push({
            ruleId: rule.id,
            title: rule.title,
            vendor: rule.vendor,
            categoryId: rule.categoryId,
            amountMinor: rule.amountMinor,
            currency: rule.currency,
            occurredAt: occurrenceDate.toISOString(),
            isProjected: true,
          });
        }
      }

      // Move to next month
      current.setMonth(current.getMonth() + 1);
    }
  }

  // Sort by date
  virtualExpenses.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  return virtualExpenses;
}

/**
 * Get all months in a year as YYYY-MM format array
 */
export function getMonthKeys(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => {
    const month = (i + 1).toString().padStart(2, '0');
    return `${year}-${month}`;
  });
}

/**
 * Get current month key in YYYY-MM format
 */
export function getCurrentMonthKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  return `${year}-${month}`;
}
