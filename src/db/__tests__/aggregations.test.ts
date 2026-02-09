import { describe, it, expect } from 'vitest';
import {
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
} from '../aggregations';
import type { Transaction, Client, Project, Category } from '../../types';

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
