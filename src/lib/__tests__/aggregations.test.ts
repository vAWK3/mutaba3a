import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getTodayISO,
  getMonthRange,
  getDaysInMonth,
  daysBetween,
  isDateInRange,
  zeroAmounts,
  addAmount,
  subtractAmount,
  getTransactionEffectiveDate,
  groupTransactionsByDay,
  groupTransactionsByMonth,
  calculateForecastKPIs,
  calculateMonthActuals,
  calculateRunningBalance,
  findOverdueUnpaidIncome,
  findUnpaidIncomeDueSoon,
  findUnpaidIncomeMissingDueDate,
} from '../aggregations';
import type { Transaction, Expense, ProjectedIncome, ForecastOptions } from '../../types';

// ============================================================================
// Test Fixtures
// ============================================================================

function createTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-1',
    kind: 'income',
    status: 'paid',
    amountMinor: 10000, // $100.00
    currency: 'USD',
    occurredAt: '2026-03-10T00:00:00Z',
    createdAt: '2026-03-10T00:00:00Z',
    updatedAt: '2026-03-10T00:00:00Z',
    ...overrides,
  };
}

function createExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 'exp-1',
    profileId: 'profile-1',
    amountMinor: 5000, // $50.00
    currency: 'USD',
    occurredAt: '2026-03-10T00:00:00Z',
    createdAt: '2026-03-10T00:00:00Z',
    updatedAt: '2026-03-10T00:00:00Z',
    ...overrides,
  };
}

function createProjectedIncome(overrides: Partial<ProjectedIncome> = {}): ProjectedIncome {
  return {
    id: 'pi-1',
    profileId: 'profile-1',
    sourceType: 'retainer',
    sourceId: 'retainer-1',
    clientId: 'client-1',
    currency: 'USD',
    expectedAmountMinor: 20000, // $200.00
    expectedDate: '2026-03-15',
    periodStart: '2026-03-01',
    periodEnd: '2026-03-31',
    state: 'due',
    receivedAmountMinor: 0,
    matchedTransactionIds: [],
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-01T00:00:00Z',
    ...overrides,
  };
}

// ============================================================================
// Date Utilities Tests
// ============================================================================

describe('Date Utilities', () => {
  describe('getTodayISO', () => {
    it('should return date in YYYY-MM-DD format', () => {
      const result = getTodayISO();
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('getMonthRange', () => {
    it('should return correct range for January', () => {
      const { start, end } = getMonthRange('2026-01');
      expect(start).toBe('2026-01-01');
      expect(end).toBe('2026-01-31');
    });

    it('should handle February in leap year', () => {
      const { start, end } = getMonthRange('2024-02');
      expect(start).toBe('2024-02-01');
      expect(end).toBe('2024-02-29');
    });

    it('should handle February in non-leap year', () => {
      const { start, end } = getMonthRange('2026-02');
      expect(start).toBe('2026-02-01');
      expect(end).toBe('2026-02-28');
    });

    it('should handle December', () => {
      const { start, end } = getMonthRange('2026-12');
      expect(start).toBe('2026-12-01');
      expect(end).toBe('2026-12-31');
    });
  });

  describe('getDaysInMonth', () => {
    it('should return all days in March', () => {
      const days = getDaysInMonth('2026-03');
      expect(days).toHaveLength(31);
      expect(days[0]).toBe('2026-03-01');
      expect(days[30]).toBe('2026-03-31');
    });

    it('should return correct days for February', () => {
      const days = getDaysInMonth('2026-02');
      expect(days).toHaveLength(28);
    });
  });

  describe('daysBetween', () => {
    it('should return positive for future date', () => {
      expect(daysBetween('2026-03-01', '2026-03-10')).toBe(9);
    });

    it('should return negative for past date', () => {
      expect(daysBetween('2026-03-10', '2026-03-01')).toBe(-9);
    });

    it('should return 0 for same date', () => {
      expect(daysBetween('2026-03-10', '2026-03-10')).toBe(0);
    });
  });

  describe('isDateInRange', () => {
    it('should return true for date within range', () => {
      expect(isDateInRange('2026-03-15', '2026-03-01', '2026-03-31')).toBe(true);
    });

    it('should return true for date on start boundary', () => {
      expect(isDateInRange('2026-03-01', '2026-03-01', '2026-03-31')).toBe(true);
    });

    it('should return true for date on end boundary', () => {
      expect(isDateInRange('2026-03-31', '2026-03-01', '2026-03-31')).toBe(true);
    });

    it('should return false for date before range', () => {
      expect(isDateInRange('2026-02-28', '2026-03-01', '2026-03-31')).toBe(false);
    });

    it('should return false for date after range', () => {
      expect(isDateInRange('2026-04-01', '2026-03-01', '2026-03-31')).toBe(false);
    });
  });
});

// ============================================================================
// Amount Utilities Tests
// ============================================================================

describe('Amount Utilities', () => {
  describe('zeroAmounts', () => {
    it('should create zeroed amounts for all currencies', () => {
      const amounts = zeroAmounts();
      expect(amounts.USD).toBe(0);
      expect(amounts.ILS).toBe(0);
      expect(amounts.EUR).toBe(0);
    });
  });

  describe('addAmount', () => {
    it('should add to specific currency', () => {
      const amounts = zeroAmounts();
      const result = addAmount(amounts, 'USD', 10000);
      expect(result.USD).toBe(10000);
      expect(result.ILS).toBe(0);
      expect(result.EUR).toBe(0);
    });

    it('should not mutate original', () => {
      const original = zeroAmounts();
      addAmount(original, 'USD', 10000);
      expect(original.USD).toBe(0);
    });
  });

  describe('subtractAmount', () => {
    it('should subtract from specific currency', () => {
      const amounts = { USD: 10000, ILS: 0, EUR: 0 };
      const result = subtractAmount(amounts, 'USD', 3000);
      expect(result.USD).toBe(7000);
    });

    it('should allow negative result', () => {
      const amounts = zeroAmounts();
      const result = subtractAmount(amounts, 'USD', 5000);
      expect(result.USD).toBe(-5000);
    });
  });
});

// ============================================================================
// Transaction Grouping Tests
// ============================================================================

describe('Transaction Grouping', () => {
  describe('getTransactionEffectiveDate', () => {
    it('should use paidAt for paid income', () => {
      const tx = createTransaction({
        kind: 'income',
        status: 'paid',
        occurredAt: '2026-03-01T00:00:00Z',
        paidAt: '2026-03-10T00:00:00Z',
      });
      expect(getTransactionEffectiveDate(tx)).toBe('2026-03-10');
    });

    it('should use dueDate for unpaid income with due date', () => {
      const tx = createTransaction({
        kind: 'income',
        status: 'unpaid',
        occurredAt: '2026-03-01T00:00:00Z',
        dueDate: '2026-03-15',
      });
      expect(getTransactionEffectiveDate(tx)).toBe('2026-03-15');
    });

    it('should use occurredAt for unpaid income without due date', () => {
      const tx = createTransaction({
        kind: 'income',
        status: 'unpaid',
        occurredAt: '2026-03-01T00:00:00Z',
      });
      expect(getTransactionEffectiveDate(tx)).toBe('2026-03-01');
    });

    it('should use occurredAt for expense', () => {
      const tx = createTransaction({
        kind: 'expense',
        status: 'paid',
        occurredAt: '2026-03-05T00:00:00Z',
      });
      expect(getTransactionEffectiveDate(tx)).toBe('2026-03-05');
    });
  });

  describe('groupTransactionsByDay', () => {
    it('should group transactions by effective date', () => {
      const transactions = [
        createTransaction({ id: '1', occurredAt: '2026-03-01T00:00:00Z', status: 'paid', paidAt: '2026-03-01T00:00:00Z' }),
        createTransaction({ id: '2', occurredAt: '2026-03-01T00:00:00Z', status: 'paid', paidAt: '2026-03-01T00:00:00Z' }),
        createTransaction({ id: '3', occurredAt: '2026-03-02T00:00:00Z', status: 'paid', paidAt: '2026-03-02T00:00:00Z' }),
      ];
      const grouped = groupTransactionsByDay(transactions);
      expect(grouped.get('2026-03-01')?.length).toBe(2);
      expect(grouped.get('2026-03-02')?.length).toBe(1);
    });
  });

  describe('groupTransactionsByMonth', () => {
    it('should group transactions by month', () => {
      const transactions = [
        createTransaction({ id: '1', occurredAt: '2026-03-01T00:00:00Z', status: 'paid', paidAt: '2026-03-01T00:00:00Z' }),
        createTransaction({ id: '2', occurredAt: '2026-03-15T00:00:00Z', status: 'paid', paidAt: '2026-03-15T00:00:00Z' }),
        createTransaction({ id: '3', occurredAt: '2026-04-01T00:00:00Z', status: 'paid', paidAt: '2026-04-01T00:00:00Z' }),
      ];
      const grouped = groupTransactionsByMonth(transactions);
      expect(grouped.get('2026-03')?.length).toBe(2);
      expect(grouped.get('2026-04')?.length).toBe(1);
    });
  });
});

// ============================================================================
// Forecast KPI Tests
// ============================================================================

describe('calculateForecastKPIs', () => {
  // Mock today to be 2026-03-13 for consistent testing
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-13T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const defaultOptions: ForecastOptions = {
    includeUnpaidIncome: true,
    includeProjectedRetainer: true,
  };

  it('should calculate cash on hand from paid income (actuals only)', () => {
    const transactions = [
      createTransaction({
        kind: 'income',
        status: 'paid',
        amountMinor: 10000,
        currency: 'USD',
        paidAt: '2026-03-10T00:00:00Z',
      }),
    ];

    const result = calculateForecastKPIs('2026-03', transactions, [], [], defaultOptions);

    expect(result.cashOnHand.USD).toBe(10000);
  });

  it('should NOT include unpaid income in cash on hand', () => {
    const transactions = [
      createTransaction({
        kind: 'income',
        status: 'unpaid',
        amountMinor: 10000,
        currency: 'USD',
        dueDate: '2026-03-20',
      }),
    ];

    const result = calculateForecastKPIs('2026-03', transactions, [], [], defaultOptions);

    expect(result.cashOnHand.USD).toBe(0);
    expect(result.coming.USD).toBe(10000);
  });

  it('should include unpaid income in "coming" when includeUnpaidIncome is true', () => {
    const transactions = [
      createTransaction({
        kind: 'income',
        status: 'unpaid',
        amountMinor: 15000,
        currency: 'USD',
        dueDate: '2026-03-25',
      }),
    ];

    const result = calculateForecastKPIs('2026-03', transactions, [], [], {
      ...defaultOptions,
      includeUnpaidIncome: true,
    });

    expect(result.coming.USD).toBe(15000);
  });

  it('should NOT include unpaid income when includeUnpaidIncome is false', () => {
    const transactions = [
      createTransaction({
        kind: 'income',
        status: 'unpaid',
        amountMinor: 15000,
        currency: 'USD',
        dueDate: '2026-03-25',
      }),
    ];

    const result = calculateForecastKPIs('2026-03', transactions, [], [], {
      ...defaultOptions,
      includeUnpaidIncome: false,
    });

    expect(result.coming.USD).toBe(0);
  });

  it('should include projected retainer in "coming" when includeProjectedRetainer is true', () => {
    const projectedIncome = [
      createProjectedIncome({
        expectedAmountMinor: 20000,
        currency: 'USD',
        expectedDate: '2026-03-15',
        state: 'due',
        receivedAmountMinor: 0,
      }),
    ];

    const result = calculateForecastKPIs('2026-03', [], [], projectedIncome, {
      ...defaultOptions,
      includeProjectedRetainer: true,
    });

    expect(result.coming.USD).toBe(20000);
  });

  it('should NOT include projected retainer when includeProjectedRetainer is false', () => {
    const projectedIncome = [
      createProjectedIncome({
        expectedAmountMinor: 20000,
        currency: 'USD',
        expectedDate: '2026-03-15',
      }),
    ];

    const result = calculateForecastKPIs('2026-03', [], [], projectedIncome, {
      ...defaultOptions,
      includeProjectedRetainer: false,
    });

    expect(result.coming.USD).toBe(0);
  });

  it('should calculate "leaving" from future expenses', () => {
    const transactions = [
      createTransaction({
        kind: 'expense',
        status: 'paid',
        amountMinor: 5000,
        currency: 'USD',
        occurredAt: '2026-03-20T00:00:00Z', // Future expense
      }),
    ];

    const result = calculateForecastKPIs('2026-03', transactions, [], [], defaultOptions);

    expect(result.leaving.USD).toBe(5000);
  });

  it('should subtract past expenses from cash on hand', () => {
    const transactions = [
      createTransaction({
        kind: 'income',
        status: 'paid',
        amountMinor: 20000,
        currency: 'USD',
        paidAt: '2026-03-05T00:00:00Z',
      }),
      createTransaction({
        kind: 'expense',
        status: 'paid',
        amountMinor: 5000,
        currency: 'USD',
        occurredAt: '2026-03-10T00:00:00Z', // Past expense
      }),
    ];

    const result = calculateForecastKPIs('2026-03', transactions, [], [], defaultOptions);

    expect(result.cashOnHand.USD).toBe(15000); // 20000 - 5000
  });

  it('should calculate willMakeIt correctly', () => {
    const transactions = [
      // Past paid income
      createTransaction({
        kind: 'income',
        status: 'paid',
        amountMinor: 10000,
        currency: 'USD',
        paidAt: '2026-03-10T00:00:00Z',
      }),
      // Unpaid income due later
      createTransaction({
        id: 'tx-2',
        kind: 'income',
        status: 'unpaid',
        amountMinor: 5000,
        currency: 'USD',
        dueDate: '2026-03-25',
        occurredAt: '2026-03-01T00:00:00Z',
      }),
      // Future expense
      createTransaction({
        id: 'tx-3',
        kind: 'expense',
        status: 'paid',
        amountMinor: 3000,
        currency: 'USD',
        occurredAt: '2026-03-20T00:00:00Z',
      }),
    ];

    const result = calculateForecastKPIs('2026-03', transactions, [], [], defaultOptions);

    // willMakeIt = cashOnHand (10000) + coming (5000) - leaving (3000) = 12000
    expect(result.willMakeIt.USD).toBe(12000);
    expect(result.cashOnHand.USD).toBe(10000);
    expect(result.coming.USD).toBe(5000);
    expect(result.leaving.USD).toBe(3000);
  });

  it('should never sum currencies', () => {
    const transactions = [
      createTransaction({
        id: 'tx-1',
        kind: 'income',
        status: 'paid',
        amountMinor: 10000,
        currency: 'USD',
        paidAt: '2026-03-10T00:00:00Z',
      }),
      createTransaction({
        id: 'tx-2',
        kind: 'income',
        status: 'paid',
        amountMinor: 5000,
        currency: 'ILS',
        paidAt: '2026-03-10T00:00:00Z',
      }),
    ];

    const result = calculateForecastKPIs('2026-03', transactions, [], [], defaultOptions);

    expect(result.cashOnHand.USD).toBe(10000);
    expect(result.cashOnHand.ILS).toBe(5000);
    // They should never be summed together
    expect(result.cashOnHand.USD).not.toBe(15000);
  });

  it('should exclude transactions outside the month range', () => {
    const transactions = [
      createTransaction({
        kind: 'income',
        status: 'paid',
        amountMinor: 10000,
        currency: 'USD',
        paidAt: '2026-02-28T00:00:00Z', // Previous month - should be excluded
      }),
      createTransaction({
        id: 'tx-2',
        kind: 'income',
        status: 'paid',
        amountMinor: 5000,
        currency: 'USD',
        paidAt: '2026-03-10T00:00:00Z', // Current month, past date (before March 13)
      }),
    ];

    const result = calculateForecastKPIs('2026-03', transactions, [], [], defaultOptions);

    // Only the March 10 transaction should be in cashOnHand (Feb 28 is excluded)
    expect(result.cashOnHand.USD).toBe(5000);
  });

  it('should handle month boundary correctly (last day of month)', () => {
    const transactions = [
      createTransaction({
        kind: 'income',
        status: 'paid',
        amountMinor: 10000,
        currency: 'USD',
        paidAt: '2026-03-31T00:00:00Z', // Last day of month (future)
      }),
    ];

    // Since today is March 13, March 31 is in the future
    // But since it's paid income, it shouldn't go to coming
    // Actually, the test should check if the date is in range and past/future logic
    const result = calculateForecastKPIs('2026-03', transactions, [], [], defaultOptions);

    // March 31 is in the future, but paid income with paidAt should still be treated
    // as paid income. The logic should check if the paid date is <= today
    // Looking at the code, isPast = effectiveDate <= today
    // effectiveDate for paid income is paidAt = '2026-03-31'
    // today is '2026-03-13', so isPast = false
    // So this should NOT be in cashOnHand
    expect(result.cashOnHand.USD).toBe(0);
  });

  it('should exclude deleted transactions', () => {
    const transactions = [
      createTransaction({
        kind: 'income',
        status: 'paid',
        amountMinor: 10000,
        currency: 'USD',
        paidAt: '2026-03-10T00:00:00Z',
        deletedAt: '2026-03-11T00:00:00Z', // Deleted
      }),
    ];

    const result = calculateForecastKPIs('2026-03', transactions, [], [], defaultOptions);

    expect(result.cashOnHand.USD).toBe(0);
  });

  it('should handle partial payments in projected income', () => {
    const projectedIncome = [
      createProjectedIncome({
        expectedAmountMinor: 20000,
        receivedAmountMinor: 5000, // Partially received
        currency: 'USD',
        expectedDate: '2026-03-15',
        state: 'partial',
      }),
    ];

    const result = calculateForecastKPIs('2026-03', [], [], projectedIncome, defaultOptions);

    // Only remaining amount should be in coming
    expect(result.coming.USD).toBe(15000); // 20000 - 5000
  });

  it('should respect opening balance', () => {
    const result = calculateForecastKPIs('2026-03', [], [], [], {
      ...defaultOptions,
      openingBalance: { USD: 50000, ILS: 10000, EUR: 0 },
    });

    expect(result.cashOnHand.USD).toBe(50000);
    expect(result.cashOnHand.ILS).toBe(10000);
    expect(result.willMakeIt.USD).toBe(50000);
  });

  it('should record which sources were included', () => {
    const result = calculateForecastKPIs('2026-03', [], [], [], {
      includeUnpaidIncome: true,
      includeProjectedRetainer: false,
    });

    expect(result.includedSources.unpaidIncome).toBe(true);
    expect(result.includedSources.projectedRetainer).toBe(false);
  });
});

// ============================================================================
// Month Actuals Tests
// ============================================================================

describe('calculateMonthActuals', () => {
  it('should calculate received income', () => {
    const transactions = [
      createTransaction({
        kind: 'income',
        status: 'paid',
        amountMinor: 10000,
        currency: 'USD',
        paidAt: '2026-03-10T00:00:00Z',
      }),
    ];

    const result = calculateMonthActuals('2026-03', transactions, []);

    expect(result.received.USD).toBe(10000);
  });

  it('should calculate unpaid income', () => {
    const transactions = [
      createTransaction({
        kind: 'income',
        status: 'unpaid',
        amountMinor: 15000,
        currency: 'USD',
        dueDate: '2026-03-20',
      }),
    ];

    const result = calculateMonthActuals('2026-03', transactions, []);

    expect(result.unpaid.USD).toBe(15000);
  });

  it('should calculate expenses from transactions and profile expenses', () => {
    const transactions = [
      createTransaction({
        kind: 'expense',
        status: 'paid',
        amountMinor: 5000,
        currency: 'USD',
        occurredAt: '2026-03-10T00:00:00Z',
      }),
    ];
    const expenses = [
      createExpense({
        amountMinor: 3000,
        currency: 'USD',
        occurredAt: '2026-03-15T00:00:00Z',
      }),
    ];

    const result = calculateMonthActuals('2026-03', transactions, expenses);

    expect(result.expenses.USD).toBe(8000); // 5000 + 3000
  });

  it('should calculate net correctly', () => {
    const transactions = [
      createTransaction({
        kind: 'income',
        status: 'paid',
        amountMinor: 20000,
        currency: 'USD',
        paidAt: '2026-03-10T00:00:00Z',
      }),
    ];
    const expenses = [
      createExpense({
        amountMinor: 8000,
        currency: 'USD',
        occurredAt: '2026-03-15T00:00:00Z',
      }),
    ];

    const result = calculateMonthActuals('2026-03', transactions, expenses);

    expect(result.net.USD).toBe(12000); // 20000 - 8000
  });

  it('should keep currencies separate', () => {
    const transactions = [
      createTransaction({
        id: 'tx-1',
        kind: 'income',
        status: 'paid',
        amountMinor: 10000,
        currency: 'USD',
        paidAt: '2026-03-10T00:00:00Z',
      }),
      createTransaction({
        id: 'tx-2',
        kind: 'income',
        status: 'paid',
        amountMinor: 5000,
        currency: 'ILS',
        paidAt: '2026-03-10T00:00:00Z',
      }),
    ];

    const result = calculateMonthActuals('2026-03', transactions, []);

    expect(result.received.USD).toBe(10000);
    expect(result.received.ILS).toBe(5000);
  });
});

// ============================================================================
// Running Balance Tests
// ============================================================================

describe('calculateRunningBalance', () => {
  it('should calculate running balance across days', () => {
    const days = ['2026-03-01', '2026-03-02', '2026-03-03'];
    const transactionsByDay = new Map([
      ['2026-03-01', [
        createTransaction({ amountMinor: 10000, kind: 'income', status: 'paid', currency: 'USD' }),
      ]],
      ['2026-03-02', [
        createTransaction({ id: 'tx-2', amountMinor: 3000, kind: 'expense', status: 'paid', currency: 'USD' }),
      ]],
    ]);
    const expensesByDay = new Map<string, Expense[]>();

    const result = calculateRunningBalance(days, transactionsByDay, expensesByDay, 'USD', 0);

    expect(result[0].runningBalanceMinor).toBe(10000);
    expect(result[1].runningBalanceMinor).toBe(7000); // 10000 - 3000
    expect(result[2].runningBalanceMinor).toBe(7000); // No change
  });

  it('should respect opening balance', () => {
    const days = ['2026-03-01'];
    const transactionsByDay = new Map([
      ['2026-03-01', [
        createTransaction({ amountMinor: 5000, kind: 'income', status: 'paid', currency: 'USD' }),
      ]],
    ]);
    const expensesByDay = new Map<string, Expense[]>();

    const result = calculateRunningBalance(days, transactionsByDay, expensesByDay, 'USD', 10000);

    expect(result[0].runningBalanceMinor).toBe(15000); // 10000 + 5000
  });

  it('should filter by currency', () => {
    const days = ['2026-03-01'];
    const transactionsByDay = new Map([
      ['2026-03-01', [
        createTransaction({ id: 'tx-1', amountMinor: 10000, kind: 'income', status: 'paid', currency: 'USD' }),
        createTransaction({ id: 'tx-2', amountMinor: 5000, kind: 'income', status: 'paid', currency: 'ILS' }),
      ]],
    ]);
    const expensesByDay = new Map<string, Expense[]>();

    const result = calculateRunningBalance(days, transactionsByDay, expensesByDay, 'USD', 0);

    expect(result[0].runningBalanceMinor).toBe(10000); // Only USD
    expect(result[0].inflowMinor).toBe(10000);
  });
});

// ============================================================================
// Attention Item Helper Tests
// ============================================================================

describe('Attention Item Helpers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-13T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('findOverdueUnpaidIncome', () => {
    it('should find unpaid income overdue by default threshold (0 days)', () => {
      const transactions = [
        createTransaction({
          kind: 'income',
          status: 'unpaid',
          dueDate: '2026-03-10', // 3 days overdue
        }),
      ];

      const result = findOverdueUnpaidIncome(transactions);

      expect(result).toHaveLength(1);
    });

    it('should respect daysThreshold parameter', () => {
      const transactions = [
        createTransaction({
          id: 'tx-1',
          kind: 'income',
          status: 'unpaid',
          dueDate: '2026-03-10', // 3 days overdue
        }),
        createTransaction({
          id: 'tx-2',
          kind: 'income',
          status: 'unpaid',
          dueDate: '2026-02-01', // 40 days overdue
        }),
      ];

      const result = findOverdueUnpaidIncome(transactions, 30);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('tx-2');
    });

    it('should exclude paid income', () => {
      const transactions = [
        createTransaction({
          kind: 'income',
          status: 'paid',
          dueDate: '2026-03-01',
        }),
      ];

      const result = findOverdueUnpaidIncome(transactions);

      expect(result).toHaveLength(0);
    });

    it('should exclude deleted transactions', () => {
      const transactions = [
        createTransaction({
          kind: 'income',
          status: 'unpaid',
          dueDate: '2026-03-01',
          deletedAt: '2026-03-10T00:00:00Z',
        }),
      ];

      const result = findOverdueUnpaidIncome(transactions);

      expect(result).toHaveLength(0);
    });
  });

  describe('findUnpaidIncomeDueSoon', () => {
    it('should find unpaid income due within 7 days', () => {
      const transactions = [
        createTransaction({
          kind: 'income',
          status: 'unpaid',
          dueDate: '2026-03-18', // 5 days from now
        }),
      ];

      const result = findUnpaidIncomeDueSoon(transactions, 7);

      expect(result).toHaveLength(1);
    });

    it('should exclude already overdue', () => {
      const transactions = [
        createTransaction({
          kind: 'income',
          status: 'unpaid',
          dueDate: '2026-03-10', // Already past
        }),
      ];

      const result = findUnpaidIncomeDueSoon(transactions, 7);

      expect(result).toHaveLength(0);
    });

    it('should exclude due after window', () => {
      const transactions = [
        createTransaction({
          kind: 'income',
          status: 'unpaid',
          dueDate: '2026-03-25', // 12 days from now
        }),
      ];

      const result = findUnpaidIncomeDueSoon(transactions, 7);

      expect(result).toHaveLength(0);
    });
  });

  describe('findUnpaidIncomeMissingDueDate', () => {
    it('should find unpaid income without due date', () => {
      const transactions = [
        createTransaction({
          kind: 'income',
          status: 'unpaid',
          // No dueDate
        }),
      ];

      const result = findUnpaidIncomeMissingDueDate(transactions);

      expect(result).toHaveLength(1);
    });

    it('should exclude unpaid with due date', () => {
      const transactions = [
        createTransaction({
          kind: 'income',
          status: 'unpaid',
          dueDate: '2026-03-20',
        }),
      ];

      const result = findUnpaidIncomeMissingDueDate(transactions);

      expect(result).toHaveLength(0);
    });

    it('should exclude paid income', () => {
      const transactions = [
        createTransaction({
          kind: 'income',
          status: 'paid',
        }),
      ];

      const result = findUnpaidIncomeMissingDueDate(transactions);

      expect(result).toHaveLength(0);
    });
  });
});
