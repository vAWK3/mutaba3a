/**
 * Aggregation Functions for Financial Intelligence
 *
 * Pure functions for calculating forecast KPIs, grouping transactions,
 * and computing running balances. These functions are storage-agnostic
 * and work with raw transaction data.
 *
 * Terminology (per ADR-010):
 * - "Unpaid income" = transaction with kind='income' and status='unpaid'
 * - "Projected retainer" = expected payment from ProjectedIncome
 * - Currencies are NEVER silently summed
 */

import type {
  Currency,
  Transaction,
  Expense,
  ProjectedIncome,
  AmountByCurrency,
  ForecastKPIs,
  ForecastOptions,
  MonthActuals,
} from '../types';

// ============================================================================
// Date Utilities
// ============================================================================

/**
 * Get today's date in ISO format (YYYY-MM-DD)
 */
export function getTodayISO(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Get the start and end dates for a month key (YYYY-MM)
 */
export function getMonthRange(monthKey: string): { start: string; end: string } {
  const [year, month] = monthKey.split('-').map(Number);
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

/**
 * Get all days in a month as ISO date strings
 */
export function getDaysInMonth(monthKey: string): string[] {
  const { start, end } = getMonthRange(monthKey);
  const days: string[] = [];
  const current = new Date(start);
  const endDate = new Date(end);
  while (current <= endDate) {
    days.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }
  return days;
}

/**
 * Calculate days between two dates (positive if date2 > date1)
 */
export function daysBetween(date1: string, date2: string): number {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const diffTime = d2.getTime() - d1.getTime();
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Check if a date string is in the future (after today)
 */
export function isFutureDate(dateStr: string): boolean {
  return dateStr > getTodayISO();
}

/**
 * Check if a date is within a range (inclusive)
 */
export function isDateInRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

// ============================================================================
// Amount Utilities
// ============================================================================

/**
 * Create a zeroed AmountByCurrency object
 */
export function zeroAmounts(): AmountByCurrency {
  return { USD: 0, ILS: 0, EUR: 0 };
}

/**
 * Add to a specific currency in AmountByCurrency
 */
export function addAmount(
  amounts: AmountByCurrency,
  currency: Currency,
  value: number
): AmountByCurrency {
  return {
    ...amounts,
    [currency]: amounts[currency] + value,
  };
}

/**
 * Subtract from a specific currency in AmountByCurrency
 */
export function subtractAmount(
  amounts: AmountByCurrency,
  currency: Currency,
  value: number
): AmountByCurrency {
  return {
    ...amounts,
    [currency]: amounts[currency] - value,
  };
}

// ============================================================================
// Transaction Grouping
// ============================================================================

/**
 * Get the effective date for a transaction (for filtering/grouping)
 *
 * Logic:
 * - Paid income: use paidAt date
 * - Unpaid income: use dueDate if available, otherwise occurredAt
 * - Expense: use occurredAt
 */
export function getTransactionEffectiveDate(tx: Transaction): string {
  if (tx.kind === 'income' && tx.status === 'paid' && tx.paidAt) {
    return tx.paidAt.split('T')[0];
  }
  if (tx.kind === 'income' && tx.status === 'unpaid' && tx.dueDate) {
    return tx.dueDate;
  }
  return tx.occurredAt.split('T')[0];
}

/**
 * Group transactions by day
 */
export function groupTransactionsByDay(
  transactions: Transaction[]
): Map<string, Transaction[]> {
  const grouped = new Map<string, Transaction[]>();

  for (const tx of transactions) {
    const date = getTransactionEffectiveDate(tx);
    const existing = grouped.get(date) || [];
    existing.push(tx);
    grouped.set(date, existing);
  }

  return grouped;
}

/**
 * Group transactions by month (YYYY-MM)
 */
export function groupTransactionsByMonth(
  transactions: Transaction[]
): Map<string, Transaction[]> {
  const grouped = new Map<string, Transaction[]>();

  for (const tx of transactions) {
    const date = getTransactionEffectiveDate(tx);
    const monthKey = date.substring(0, 7);
    const existing = grouped.get(monthKey) || [];
    existing.push(tx);
    grouped.set(monthKey, existing);
  }

  return grouped;
}

// ============================================================================
// Forecast KPI Calculations
// ============================================================================

/**
 * Filter transactions for a specific month and currency
 */
export function filterTransactionsForMonth(
  transactions: Transaction[],
  monthKey: string,
  currency: Currency,
  options: {
    includeUnpaidIncome: boolean;
  }
): Transaction[] {
  const { start, end } = getMonthRange(monthKey);

  return transactions.filter(tx => {
    // Must match currency
    if (tx.currency !== currency) return false;
    // Must not be deleted
    if (tx.deletedAt) return false;

    // Get effective date
    const effectiveDate = getTransactionEffectiveDate(tx);

    // Must be in range
    if (!isDateInRange(effectiveDate, start, end)) return false;

    // Filter out unpaid income if not included
    if (!options.includeUnpaidIncome && tx.kind === 'income' && tx.status === 'unpaid') {
      return false;
    }

    return true;
  });
}

/**
 * Filter projected income for a specific month and currency
 */
export function filterProjectedIncomeForMonth(
  projectedIncome: ProjectedIncome[],
  monthKey: string,
  currency: Currency
): ProjectedIncome[] {
  const { start, end } = getMonthRange(monthKey);

  return projectedIncome.filter(pi => {
    if (pi.currency !== currency) return false;
    if (pi.state === 'canceled') return false;
    // Skip fully received - they show as actual income
    if (pi.state === 'received' && pi.receivedAmountMinor >= pi.expectedAmountMinor) {
      return false;
    }
    return isDateInRange(pi.expectedDate, start, end);
  });
}

/**
 * Calculate Forecast KPIs for a month.
 *
 * This is the main forecast calculation function used by the Home page.
 *
 * @param monthKey - Month in YYYY-MM format
 * @param transactions - All transactions (will be filtered)
 * @param expenses - Profile expenses (will be filtered)
 * @param projectedIncome - Projected retainer income (will be filtered)
 * @param options - Forecast options (what to include)
 */
export function calculateForecastKPIs(
  monthKey: string,
  transactions: Transaction[],
  expenses: Expense[],
  projectedIncome: ProjectedIncome[],
  options: ForecastOptions
): ForecastKPIs {
  const today = getTodayISO();
  const { start, end } = getMonthRange(monthKey);
  const openingBalance = options.openingBalance || zeroAmounts();

  // Initialize amounts
  const cashOnHand = { ...openingBalance };
  const coming = zeroAmounts();
  const leaving = zeroAmounts();

  // Process transactions
  for (const tx of transactions) {
    if (tx.deletedAt) continue;

    const effectiveDate = getTransactionEffectiveDate(tx);
    if (!isDateInRange(effectiveDate, start, end)) continue;

    const isPast = effectiveDate <= today;

    if (tx.kind === 'income') {
      if (tx.status === 'paid' && isPast) {
        // Paid income: add to cash on hand
        cashOnHand[tx.currency] += tx.amountMinor;
      } else if (tx.status === 'unpaid' && options.includeUnpaidIncome) {
        // Unpaid income: add to coming
        coming[tx.currency] += tx.amountMinor;
      }
    } else {
      // Expense transaction
      if (isPast) {
        cashOnHand[tx.currency] -= tx.amountMinor;
      } else {
        leaving[tx.currency] += tx.amountMinor;
      }
    }
  }

  // Process profile expenses
  for (const exp of expenses) {
    if (exp.deletedAt) continue;

    const expDate = exp.occurredAt.split('T')[0];
    if (!isDateInRange(expDate, start, end)) continue;

    const isPast = expDate <= today;

    if (isPast) {
      cashOnHand[exp.currency] -= exp.amountMinor;
    } else {
      leaving[exp.currency] += exp.amountMinor;
    }
  }

  // Process projected retainer income
  if (options.includeProjectedRetainer) {
    for (const pi of projectedIncome) {
      if (pi.state === 'canceled') continue;
      if (pi.state === 'received' && pi.receivedAmountMinor >= pi.expectedAmountMinor) {
        continue;
      }
      if (!isDateInRange(pi.expectedDate, start, end)) continue;

      // Add remaining amount to coming
      const remainingAmount = pi.expectedAmountMinor - pi.receivedAmountMinor;
      if (remainingAmount > 0) {
        coming[pi.currency] += remainingAmount;
      }
    }
  }

  // Calculate derived values
  const willMakeIt: AmountByCurrency = {
    USD: cashOnHand.USD + coming.USD - leaving.USD,
    ILS: cashOnHand.ILS + coming.ILS - leaving.ILS,
    EUR: cashOnHand.EUR + coming.EUR - leaving.EUR,
  };

  const netForecast: AmountByCurrency = {
    USD: coming.USD - leaving.USD,
    ILS: coming.ILS - leaving.ILS,
    EUR: coming.EUR - leaving.EUR,
  };

  return {
    willMakeIt,
    cashOnHand,
    coming,
    leaving,
    netForecast,
    includedSources: {
      unpaidIncome: options.includeUnpaidIncome,
      projectedRetainer: options.includeProjectedRetainer,
    },
  };
}

// ============================================================================
// Month Actuals Calculations
// ============================================================================

/**
 * Calculate month actuals (received, unpaid, expenses, net).
 *
 * This is for the collapsible "This Month's Actuals" row on Home.
 * Only includes realized transactions, no projections.
 */
export function calculateMonthActuals(
  monthKey: string,
  transactions: Transaction[],
  expenses: Expense[]
): MonthActuals {
  const { start, end } = getMonthRange(monthKey);

  const received = zeroAmounts();
  const unpaid = zeroAmounts();
  const expenseTotal = zeroAmounts();

  // Process transactions
  for (const tx of transactions) {
    if (tx.deletedAt) continue;

    const effectiveDate = getTransactionEffectiveDate(tx);
    if (!isDateInRange(effectiveDate, start, end)) continue;

    if (tx.kind === 'income') {
      if (tx.status === 'paid') {
        received[tx.currency] += tx.amountMinor;
      } else {
        unpaid[tx.currency] += tx.amountMinor;
      }
    } else {
      // Transaction expense (kind='expense')
      expenseTotal[tx.currency] += tx.amountMinor;
    }
  }

  // Process profile expenses
  for (const exp of expenses) {
    if (exp.deletedAt) continue;

    const expDate = exp.occurredAt.split('T')[0];
    if (!isDateInRange(expDate, start, end)) continue;

    expenseTotal[exp.currency] += exp.amountMinor;
  }

  // Calculate net (received - expenses)
  const net: AmountByCurrency = {
    USD: received.USD - expenseTotal.USD,
    ILS: received.ILS - expenseTotal.ILS,
    EUR: received.EUR - expenseTotal.EUR,
  };

  return {
    month: monthKey,
    received,
    unpaid,
    expenses: expenseTotal,
    net,
  };
}

// ============================================================================
// Running Balance Calculations
// ============================================================================

/**
 * Daily aggregate for running balance calculation
 */
export interface DailyBalanceAggregate {
  date: string;
  inflowMinor: number;
  outflowMinor: number;
  netMinor: number;
  runningBalanceMinor: number;
  transactionCount: number;
}

/**
 * Calculate running balance for a series of days.
 *
 * @param days - Array of ISO date strings (sorted)
 * @param transactionsByDay - Map of date -> transactions
 * @param expensesByDay - Map of date -> expenses
 * @param currency - Currency to calculate for
 * @param openingBalance - Starting balance
 */
export function calculateRunningBalance(
  days: string[],
  transactionsByDay: Map<string, Transaction[]>,
  expensesByDay: Map<string, Expense[]>,
  currency: Currency,
  openingBalance: number = 0
): DailyBalanceAggregate[] {
  let runningBalance = openingBalance;
  const aggregates: DailyBalanceAggregate[] = [];

  for (const date of days) {
    let inflowMinor = 0;
    let outflowMinor = 0;
    let transactionCount = 0;

    // Process transactions for this day
    const dayTransactions = transactionsByDay.get(date) || [];
    for (const tx of dayTransactions) {
      if (tx.currency !== currency) continue;
      if (tx.deletedAt) continue;

      transactionCount++;

      if (tx.kind === 'income' && tx.status === 'paid') {
        inflowMinor += tx.amountMinor;
      } else if (tx.kind === 'expense') {
        outflowMinor += tx.amountMinor;
      }
    }

    // Process expenses for this day
    const dayExpenses = expensesByDay.get(date) || [];
    for (const exp of dayExpenses) {
      if (exp.currency !== currency) continue;
      if (exp.deletedAt) continue;

      transactionCount++;
      outflowMinor += exp.amountMinor;
    }

    const netMinor = inflowMinor - outflowMinor;
    runningBalance += netMinor;

    aggregates.push({
      date,
      inflowMinor,
      outflowMinor,
      netMinor,
      runningBalanceMinor: runningBalance,
      transactionCount,
    });
  }

  return aggregates;
}

// ============================================================================
// Attention Item Helpers
// ============================================================================

/**
 * Find unpaid income that is overdue
 */
export function findOverdueUnpaidIncome(
  transactions: Transaction[],
  daysThreshold: number = 0
): Transaction[] {
  const today = getTodayISO();

  return transactions.filter(tx => {
    if (tx.deletedAt) return false;
    if (tx.kind !== 'income') return false;
    if (tx.status !== 'unpaid') return false;
    if (!tx.dueDate) return false;

    const daysOverdue = daysBetween(tx.dueDate, today);
    return daysOverdue > daysThreshold;
  });
}

/**
 * Find unpaid income due within a certain number of days
 */
export function findUnpaidIncomeDueSoon(
  transactions: Transaction[],
  daysWindow: number = 7
): Transaction[] {
  const today = getTodayISO();

  return transactions.filter(tx => {
    if (tx.deletedAt) return false;
    if (tx.kind !== 'income') return false;
    if (tx.status !== 'unpaid') return false;
    if (!tx.dueDate) return false;

    const daysUntilDue = daysBetween(today, tx.dueDate);
    return daysUntilDue >= 0 && daysUntilDue <= daysWindow;
  });
}

/**
 * Find unpaid income missing due dates
 */
export function findUnpaidIncomeMissingDueDate(
  transactions: Transaction[]
): Transaction[] {
  return transactions.filter(tx => {
    if (tx.deletedAt) return false;
    if (tx.kind !== 'income') return false;
    if (tx.status !== 'unpaid') return false;
    return !tx.dueDate;
  });
}
