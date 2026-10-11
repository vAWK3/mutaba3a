import { describe, it, expect } from 'vitest';
import {
  accumulateIncomeAmount,
  aggregateTransactionTotals,
  aggregateTransactionTotalsByCurrency,
  aggregateTransactionTotalsWithActivity,
  filterTransactionsByDateAndCurrency,
  filterTransactionsByEntity,
  filterTransactionsByEntityAndDate,
  createEntityMaps,
  createNameMap,
  getLastActivityDate,
  sortByLastActivity,
  summarizeOwedByCurrency,
  paymentRowsForIncome,
  latestPayment,
  combineOwed,
} from '../aggregations';
import type { Transaction, Client, Project, Category, PaymentRecord, PaymentByClientRow } from '../../types';

// Helper to create test transactions
const createTransaction = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: `tx-${Math.random().toString(36).substr(2, 9)}`,
  kind: 'income',
  status: 'paid',
  amountMinor: 10000,
  currency: 'USD',
  occurredAt: '2024-01-15',
  createdAt: '2024-01-15T10:00:00.000Z',
  updatedAt: '2024-01-15T10:00:00.000Z',
  ...overrides,
});

describe('aggregateTransactionTotals', () => {
  it('should return zeros for empty array', () => {
    const result = aggregateTransactionTotals([]);

    expect(result.paidIncomeMinor).toBe(0);
    expect(result.unpaidIncomeMinor).toBe(0);
    expect(result.expensesMinor).toBe(0);
  });

  it('should aggregate paid income', () => {
    const transactions = [
      createTransaction({ kind: 'income', status: 'paid', amountMinor: 10000 }),
      createTransaction({ kind: 'income', status: 'paid', amountMinor: 5000 }),
    ];

    const result = aggregateTransactionTotals(transactions);

    expect(result.paidIncomeMinor).toBe(15000);
    expect(result.unpaidIncomeMinor).toBe(0);
    expect(result.expensesMinor).toBe(0);
  });

  it('should aggregate unpaid income', () => {
    const transactions = [
      createTransaction({ kind: 'income', status: 'unpaid', amountMinor: 10000 }),
      createTransaction({ kind: 'income', status: 'unpaid', amountMinor: 5000 }),
    ];

    const result = aggregateTransactionTotals(transactions);

    expect(result.paidIncomeMinor).toBe(0);
    expect(result.unpaidIncomeMinor).toBe(15000);
    expect(result.expensesMinor).toBe(0);
  });

  it('should aggregate expenses', () => {
    const transactions = [
      createTransaction({ kind: 'expense', status: 'paid', amountMinor: 3000 }),
      createTransaction({ kind: 'expense', status: 'paid', amountMinor: 2000 }),
    ];

    const result = aggregateTransactionTotals(transactions);

    expect(result.paidIncomeMinor).toBe(0);
    expect(result.unpaidIncomeMinor).toBe(0);
    expect(result.expensesMinor).toBe(5000);
  });

  it('should aggregate mixed transactions', () => {
    const transactions = [
      createTransaction({ kind: 'income', status: 'paid', amountMinor: 10000 }),
      createTransaction({ kind: 'income', status: 'unpaid', amountMinor: 5000 }),
      createTransaction({ kind: 'expense', status: 'paid', amountMinor: 3000 }),
    ];

    const result = aggregateTransactionTotals(transactions);

    expect(result.paidIncomeMinor).toBe(10000);
    expect(result.unpaidIncomeMinor).toBe(5000);
    expect(result.expensesMinor).toBe(3000);
  });
});

describe('accumulateIncomeAmount', () => {
  it('should return full amount as paid for paid transactions', () => {
    const tx = createTransaction({ kind: 'income', status: 'paid', amountMinor: 10000 });
    const result = accumulateIncomeAmount(tx);
    expect(result.paid).toBe(10000);
    expect(result.unpaid).toBe(0);
  });

  it('should return full amount as unpaid when no partial payment', () => {
    const tx = createTransaction({ kind: 'income', status: 'unpaid', amountMinor: 10000 });
    const result = accumulateIncomeAmount(tx);
    expect(result.paid).toBe(0);
    expect(result.unpaid).toBe(10000);
  });

  it('should split amount correctly for partial payments', () => {
    const tx = createTransaction({
      kind: 'income', status: 'unpaid', amountMinor: 10000, receivedAmountMinor: 3000,
    });
    const result = accumulateIncomeAmount(tx);
    expect(result.paid).toBe(3000);
    expect(result.unpaid).toBe(7000);
  });

  it('should handle receivedAmountMinor equal to amountMinor on unpaid tx', () => {
    const tx = createTransaction({
      kind: 'income', status: 'unpaid', amountMinor: 10000, receivedAmountMinor: 10000,
    });
    const result = accumulateIncomeAmount(tx);
    expect(result.paid).toBe(10000);
    expect(result.unpaid).toBe(0);
  });
});

describe('aggregateTransactionTotals — partial payments', () => {
  it('should split partial payment into paid and unpaid portions', () => {
    const transactions = [
      createTransaction({
        kind: 'income', status: 'unpaid', amountMinor: 10000, receivedAmountMinor: 5000,
      }),
    ];
    const result = aggregateTransactionTotals(transactions);
    expect(result.paidIncomeMinor).toBe(5000);
    expect(result.unpaidIncomeMinor).toBe(5000);
  });

  it('should handle mix of paid, unpaid, and partial transactions', () => {
    const transactions = [
      createTransaction({ kind: 'income', status: 'paid', amountMinor: 20000 }),
      createTransaction({ kind: 'income', status: 'unpaid', amountMinor: 10000, receivedAmountMinor: 3000 }),
      createTransaction({ kind: 'income', status: 'unpaid', amountMinor: 5000 }),
      createTransaction({ kind: 'expense', status: 'paid', amountMinor: 8000 }),
    ];
    const result = aggregateTransactionTotals(transactions);
    expect(result.paidIncomeMinor).toBe(23000); // 20000 + 3000
    expect(result.unpaidIncomeMinor).toBe(12000); // 7000 + 5000
    expect(result.expensesMinor).toBe(8000);
  });
});

describe('aggregateTransactionTotalsByCurrency', () => {
  it('should return zeros for all currencies with empty array', () => {
    const result = aggregateTransactionTotalsByCurrency([]);

    expect(result.USD.paidIncomeMinor).toBe(0);
    expect(result.ILS.paidIncomeMinor).toBe(0);
    expect(result.EUR.paidIncomeMinor).toBe(0);
  });

  it('should separate totals by currency', () => {
    const transactions = [
      createTransaction({ kind: 'income', status: 'paid', amountMinor: 10000, currency: 'USD' }),
      createTransaction({ kind: 'income', status: 'paid', amountMinor: 20000, currency: 'ILS' }),
      createTransaction({ kind: 'expense', status: 'paid', amountMinor: 5000, currency: 'EUR' }),
    ];

    const result = aggregateTransactionTotalsByCurrency(transactions);

    expect(result.USD.paidIncomeMinor).toBe(10000);
    expect(result.ILS.paidIncomeMinor).toBe(20000);
    expect(result.EUR.expensesMinor).toBe(5000);
  });

  it('should aggregate same currency transactions', () => {
    const transactions = [
      createTransaction({ kind: 'income', status: 'paid', amountMinor: 10000, currency: 'USD' }),
      createTransaction({ kind: 'income', status: 'paid', amountMinor: 5000, currency: 'USD' }),
      createTransaction({ kind: 'income', status: 'unpaid', amountMinor: 3000, currency: 'USD' }),
    ];

    const result = aggregateTransactionTotalsByCurrency(transactions);

    expect(result.USD.paidIncomeMinor).toBe(15000);
    expect(result.USD.unpaidIncomeMinor).toBe(3000);
  });
});

describe('aggregateTransactionTotalsByCurrency — partial payments', () => {
  it('should split partial payment per currency correctly', () => {
    const transactions = [
      createTransaction({
        kind: 'income', status: 'unpaid', amountMinor: 10000, receivedAmountMinor: 4000, currency: 'USD',
      }),
      createTransaction({
        kind: 'income', status: 'unpaid', amountMinor: 20000, receivedAmountMinor: 5000, currency: 'ILS',
      }),
    ];
    const result = aggregateTransactionTotalsByCurrency(transactions);
    expect(result.USD.paidIncomeMinor).toBe(4000);
    expect(result.USD.unpaidIncomeMinor).toBe(6000);
    expect(result.ILS.paidIncomeMinor).toBe(5000);
    expect(result.ILS.unpaidIncomeMinor).toBe(15000);
  });
});

describe('aggregateTransactionTotalsWithActivity', () => {
  it('should track last activity date', () => {
    const transactions = [
      createTransaction({ occurredAt: '2024-01-01' }),
      createTransaction({ occurredAt: '2024-01-15' }),
      createTransaction({ occurredAt: '2024-01-10' }),
    ];

    const result = aggregateTransactionTotalsWithActivity(transactions);

    expect(result.lastActivityAt).toBe('2024-01-15');
  });

  it('should track last payment date when trackPayments is true', () => {
    const transactions = [
      createTransaction({ kind: 'income', status: 'paid', paidAt: '2024-01-01T10:00:00.000Z' }),
      createTransaction({ kind: 'income', status: 'paid', paidAt: '2024-01-20T10:00:00.000Z' }),
      createTransaction({ kind: 'income', status: 'paid', paidAt: '2024-01-10T10:00:00.000Z' }),
    ];

    const result = aggregateTransactionTotalsWithActivity(transactions, { trackPayments: true });

    expect(result.lastPaymentAt).toBe('2024-01-20T10:00:00.000Z');
  });

  it('should not track payments when trackPayments is false', () => {
    const transactions = [
      createTransaction({ kind: 'income', status: 'paid', paidAt: '2024-01-01T10:00:00.000Z' }),
    ];

    const result = aggregateTransactionTotalsWithActivity(transactions, { trackPayments: false });

    expect(result.lastPaymentAt).toBeUndefined();
  });
});

describe('filterTransactionsByDateAndCurrency', () => {
  const transactions = [
    createTransaction({ id: '1', currency: 'USD', occurredAt: '2024-01-15' }),
    createTransaction({ id: '2', currency: 'ILS', occurredAt: '2024-01-20' }),
    createTransaction({ id: '3', currency: 'USD', occurredAt: '2024-02-15' }),
    createTransaction({ id: '4', currency: 'USD', occurredAt: '2024-01-10', deletedAt: '2024-01-11' }),
  ];

  it('should exclude deleted transactions', () => {
    const result = filterTransactionsByDateAndCurrency(transactions, {});
    expect(result).toHaveLength(3);
    expect(result.every((t) => !t.deletedAt)).toBe(true);
  });

  it('should filter by date range', () => {
    const result = filterTransactionsByDateAndCurrency(transactions, {
      dateFrom: '2024-01-01',
      dateTo: '2024-01-31',
    });

    expect(result).toHaveLength(2);
    expect(result.every((t) => t.occurredAt >= '2024-01-01' && t.occurredAt <= '2024-01-31')).toBe(true);
  });

  it('should filter by currency', () => {
    const result = filterTransactionsByDateAndCurrency(transactions, { currency: 'USD' });

    expect(result).toHaveLength(2);
    expect(result.every((t) => t.currency === 'USD')).toBe(true);
  });

  it('should apply multiple filters', () => {
    const result = filterTransactionsByDateAndCurrency(transactions, {
      dateFrom: '2024-01-01',
      dateTo: '2024-01-31',
      currency: 'USD',
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });
});

describe('filterTransactionsByEntity', () => {
  const transactions = [
    createTransaction({ id: '1', projectId: 'proj-1', clientId: 'client-1' }),
    createTransaction({ id: '2', projectId: 'proj-2', clientId: 'client-1' }),
    createTransaction({ id: '3', projectId: 'proj-1', clientId: 'client-2' }),
    createTransaction({ id: '4', projectId: 'proj-1', deletedAt: '2024-01-01' }),
  ];

  it('should filter by project ID', () => {
    const result = filterTransactionsByEntity(transactions, 'project', 'proj-1');

    expect(result).toHaveLength(2);
    expect(result.every((t) => t.projectId === 'proj-1')).toBe(true);
  });

  it('should filter by client ID', () => {
    const result = filterTransactionsByEntity(transactions, 'client', 'client-1');

    expect(result).toHaveLength(2);
    expect(result.every((t) => t.clientId === 'client-1')).toBe(true);
  });

  it('should exclude deleted transactions', () => {
    const result = filterTransactionsByEntity(transactions, 'project', 'proj-1');
    expect(result.every((t) => !t.deletedAt)).toBe(true);
  });

  it('should optionally filter by currency', () => {
    const txsWithCurrency = [
      createTransaction({ id: '1', projectId: 'proj-1', currency: 'USD' }),
      createTransaction({ id: '2', projectId: 'proj-1', currency: 'ILS' }),
    ];

    const result = filterTransactionsByEntity(txsWithCurrency, 'project', 'proj-1', 'USD');

    expect(result).toHaveLength(1);
    expect(result[0].currency).toBe('USD');
  });
});

describe('filterTransactionsByEntityAndDate', () => {
  const transactions = [
    createTransaction({ id: '1', projectId: 'proj-1', occurredAt: '2024-01-15' }),
    createTransaction({ id: '2', projectId: 'proj-1', occurredAt: '2024-02-15' }),
    createTransaction({ id: '3', projectId: 'proj-2', occurredAt: '2024-01-15' }),
  ];

  it('should filter by entity and date range', () => {
    const result = filterTransactionsByEntityAndDate(transactions, 'project', 'proj-1', {
      dateFrom: '2024-01-01',
      dateTo: '2024-01-31',
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });
});

describe('createEntityMaps', () => {
  it('should create lookup maps for all entity types', () => {
    const clients: Client[] = [
      { id: 'c1', name: 'Client 1', createdAt: '', updatedAt: '' },
      { id: 'c2', name: 'Client 2', createdAt: '', updatedAt: '' },
    ];
    const projects: Project[] = [
      { id: 'p1', name: 'Project 1', createdAt: '', updatedAt: '' },
    ];
    const categories: Category[] = [
      { id: 'cat1', name: 'Category 1', kind: 'expense' },
    ];

    const maps = createEntityMaps(clients, projects, categories);

    expect(maps.clientMap.get('c1')).toBe('Client 1');
    expect(maps.clientMap.get('c2')).toBe('Client 2');
    expect(maps.projectMap.get('p1')).toBe('Project 1');
    expect(maps.categoryMap.get('cat1')).toBe('Category 1');
  });
});

describe('createNameMap', () => {
  it('should create a name lookup map', () => {
    const entities = [
      { id: '1', name: 'First' },
      { id: '2', name: 'Second' },
    ];

    const map = createNameMap(entities);

    expect(map.get('1')).toBe('First');
    expect(map.get('2')).toBe('Second');
    expect(map.get('3')).toBeUndefined();
  });
});

describe('getLastActivityDate', () => {
  it('should return undefined for empty array', () => {
    const result = getLastActivityDate([]);
    expect(result).toBeUndefined();
  });

  it('should return the most recent occurredAt date', () => {
    const transactions = [
      createTransaction({ occurredAt: '2024-01-01' }),
      createTransaction({ occurredAt: '2024-01-20' }),
      createTransaction({ occurredAt: '2024-01-10' }),
    ];

    const result = getLastActivityDate(transactions);

    expect(result).toBe('2024-01-20');
  });
});

describe('sortByLastActivity', () => {
  it('should sort by lastActivityAt descending (most recent first)', () => {
    const items = [
      { id: '1', lastActivityAt: '2024-01-01' },
      { id: '2', lastActivityAt: '2024-01-20' },
      { id: '3', lastActivityAt: '2024-01-10' },
    ];

    const result = sortByLastActivity(items);

    expect(result[0].id).toBe('2');
    expect(result[1].id).toBe('3');
    expect(result[2].id).toBe('1');
  });

  it('should put items without lastActivityAt at the end', () => {
    const items = [
      { id: '1', lastActivityAt: undefined },
      { id: '2', lastActivityAt: '2024-01-20' },
      { id: '3', lastActivityAt: undefined },
    ];

    const result = sortByLastActivity(items);

    expect(result[0].id).toBe('2');
    // Items without activity should be at the end
    expect(result[1].lastActivityAt).toBeUndefined();
    expect(result[2].lastActivityAt).toBeUndefined();
  });

  it('should handle all items without activity date', () => {
    const items = [
      { id: '1', lastActivityAt: undefined },
      { id: '2', lastActivityAt: undefined },
    ];

    const result = sortByLastActivity(items);

    expect(result).toHaveLength(2);
  });
});

/**
 * MUT-3: Owed Now on the client profile, and later the clients index and home
 * (MUT-7, MUT-8). One definition so the three screens cannot disagree the way
 * the overdue counts did before MUT-17.
 */
describe('summarizeOwedByCurrency', () => {
  const today = '2026-10-11';
  const receivable = (overrides: Partial<Transaction> = {}) =>
    createTransaction({ kind: 'income', status: 'unpaid', ...overrides });

  it('returns an empty list when nothing is owed', () => {
    expect(summarizeOwedByCurrency([], today)).toEqual([]);
  });

  it('counts an unpaid entry in full and nothing overdue without a due date', () => {
    const result = summarizeOwedByCurrency([receivable({ amountMinor: 50000 })], today);

    expect(result).toEqual([{ currency: 'USD', owedMinor: 50000, overdueMinor: 0 }]);
  });

  it('counts only the remaining balance of a partially paid entry', () => {
    const result = summarizeOwedByCurrency(
      [receivable({ amountMinor: 50000, receivedAmountMinor: 20000 })],
      today
    );

    expect(result[0].owedMinor).toBe(30000);
  });

  it('ignores paid income, expenses, soft-deleted and archived entries', () => {
    const result = summarizeOwedByCurrency(
      [
        createTransaction({ status: 'paid', amountMinor: 10000 }),
        createTransaction({ kind: 'expense', status: 'unpaid', amountMinor: 10000 }),
        receivable({ amountMinor: 10000, deletedAt: '2026-10-01T00:00:00.000Z' }),
        receivable({ amountMinor: 10000, archivedAt: '2026-10-01T00:00:00.000Z' }),
      ],
      today
    );

    expect(result).toEqual([]);
  });

  it('splits out the overdue portion: due before today only (ADR-010)', () => {
    const result = summarizeOwedByCurrency(
      [
        receivable({ amountMinor: 10000, dueDate: '2026-10-10' }), // overdue
        receivable({ amountMinor: 20000, receivedAmountMinor: 5000, dueDate: '2026-09-01' }), // overdue, partial
        receivable({ amountMinor: 40000, dueDate: today }), // due today: not overdue
        receivable({ amountMinor: 80000, dueDate: '2026-10-20' }), // future
      ],
      today
    );

    expect(result).toEqual([{ currency: 'USD', owedMinor: 145000, overdueMinor: 25000 }]);
  });

  it('keeps currencies apart and orders them USD, ILS, EUR whatever the input order', () => {
    const result = summarizeOwedByCurrency(
      [
        receivable({ currency: 'EUR', amountMinor: 3000 }),
        receivable({ currency: 'ILS', amountMinor: 2000, dueDate: '2026-10-01' }),
        receivable({ currency: 'USD', amountMinor: 1000 }),
        receivable({ currency: 'ILS', amountMinor: 500 }),
      ],
      today
    );

    expect(result).toEqual([
      { currency: 'USD', owedMinor: 1000, overdueMinor: 0 },
      { currency: 'ILS', owedMinor: 2500, overdueMinor: 2000 },
      { currency: 'EUR', owedMinor: 3000, overdueMinor: 0 },
    ]);
  });

  it('omits a currency whose entries are fully covered', () => {
    const result = summarizeOwedByCurrency(
      [
        receivable({ currency: 'ILS', amountMinor: 2000, receivedAmountMinor: 2000 }),
        receivable({ currency: 'USD', amountMinor: 1000 }),
      ],
      today
    );

    expect(result.map((r) => r.currency)).toEqual(['USD']);
  });

  it('never goes negative when more was received than the entry total', () => {
    const result = summarizeOwedByCurrency(
      [
        receivable({ amountMinor: 1000, receivedAmountMinor: 1500, dueDate: '2026-10-01' }),
        receivable({ amountMinor: 1000 }),
      ],
      today
    );

    expect(result).toEqual([{ currency: 'USD', owedMinor: 1000, overdueMinor: 0 }]);
  });
});

/**
 * MUT-7: the payment derivation behind listByClient (ADR-033), extracted so the
 * clients index's "last payment" and the profile's Payments section are the
 * same rows.
 */
describe('paymentRowsForIncome', () => {
  const record = (overrides: Partial<PaymentRecord> = {}): PaymentRecord => ({
    id: 'rec-1',
    transactionId: 'tx-1',
    amountMinor: 4000,
    paidAt: '2026-10-05',
    createdAt: '2026-10-05T00:00:00.000Z',
    updatedAt: '2026-10-05T00:00:00.000Z',
    ...overrides,
  });
  const income = (overrides: Partial<Transaction> = {}) =>
    createTransaction({ id: 'tx-1', title: 'Homepage', status: 'unpaid', amountMinor: 10000, ...overrides });

  it('returns one record row per payment record, labelled with the entry', () => {
    const rows = paymentRowsForIncome(income({ currency: 'ILS', receivedAmountMinor: 4000 }), [record()]);

    expect(rows).toEqual([
      {
        id: 'rec-1',
        transactionId: 'tx-1',
        transactionTitle: 'Homepage',
        amountMinor: 4000,
        currency: 'ILS',
        paidAt: '2026-10-05',
        notes: undefined,
        source: 'record',
      },
    ]);
  });

  it('adds one entry row for money received on the entry that no record covers', () => {
    const rows = paymentRowsForIncome(
      income({ status: 'paid', receivedAmountMinor: 10000, paidAt: '2026-10-09' }),
      [record()]
    );

    expect(rows.map((r) => [r.source, r.amountMinor, r.paidAt, r.id])).toEqual([
      ['record', 4000, '2026-10-05', 'rec-1'],
      ['entry', 6000, '2026-10-09', 'entry:tx-1'],
    ]);
  });

  it('dates an entry row by occurredAt when the entry has no paidAt', () => {
    const rows = paymentRowsForIncome(income({ status: 'paid', occurredAt: '2026-09-01' }), []);
    expect(rows[0]).toMatchObject({ paidAt: '2026-09-01', amountMinor: 10000, source: 'entry' });
  });

  it('returns nothing for an unpaid entry with nothing received', () => {
    expect(paymentRowsForIncome(income(), [])).toEqual([]);
  });
});

describe('latestPayment', () => {
  const row = (overrides: Partial<PaymentByClientRow>): PaymentByClientRow => ({
    id: 'p',
    transactionId: 'tx',
    amountMinor: 1000,
    currency: 'USD',
    paidAt: '2026-10-01',
    source: 'record',
    ...overrides,
  });

  it('returns undefined when there are no payments', () => {
    expect(latestPayment([])).toBeUndefined();
  });

  it('returns the newest payment with its amount and currency', () => {
    expect(
      latestPayment([
        row({ id: 'a', paidAt: '2026-09-01', amountMinor: 900 }),
        row({ id: 'b', paidAt: '2026-10-03', amountMinor: 500, currency: 'ILS' }),
        row({ id: 'c', paidAt: '2026-10-01T22:00:00.000Z', amountMinor: 700 }),
      ])
    ).toEqual({ paidAt: '2026-10-03', amountMinor: 500, currency: 'ILS' });
  });

  it('breaks a same-day tie by the larger amount, then by id, so the answer never depends on input order', () => {
    const rows = [
      row({ id: 'b', paidAt: '2026-10-03', amountMinor: 500 }),
      row({ id: 'a', paidAt: '2026-10-03', amountMinor: 500, currency: 'EUR' }),
      row({ id: 'c', paidAt: '2026-10-03', amountMinor: 200 }),
    ];
    expect(latestPayment(rows)).toEqual({ paidAt: '2026-10-03', amountMinor: 500, currency: 'EUR' });
    expect(latestPayment([...rows].reverse())).toEqual({ paidAt: '2026-10-03', amountMinor: 500, currency: 'EUR' });
  });
});

describe('combineOwed', () => {
  it('sums owed and overdue per currency across clients, never across currencies', () => {
    expect(
      combineOwed([
        [{ currency: 'ILS', owedMinor: 2000, overdueMinor: 500 }],
        [
          { currency: 'USD', owedMinor: 1000, overdueMinor: 0 },
          { currency: 'ILS', owedMinor: 300, overdueMinor: 300 },
        ],
        [],
      ])
    ).toEqual([
      { currency: 'USD', owedMinor: 1000, overdueMinor: 0 },
      { currency: 'ILS', owedMinor: 2300, overdueMinor: 800 },
    ]);
  });

  it('returns an empty list when nobody owes anything', () => {
    expect(combineOwed([[], []])).toEqual([]);
  });
});
