import { describe, it, expect } from 'vitest';
import {
  aggregateTransactionTotalsByCurrency,
  aggregateTransactionTotalsWithActivity,
  filterTransactionsByDateAndCurrency,
  filterTransactionsByEntityAndDate,
  filterExpensesByEntityAndDate,
  sumExpensesByCurrency,
} from '../aggregations';
import type { Transaction, Expense, Currency } from '../../types';

/**
 * MUT-24 §C: the edges of the totals and filters every money screen sums
 * through — currencies the totals don't know, expenses and conversions in the
 * activity totals, and the inclusive end date of a period (a timestamp on the
 * last day still counts, the next day does not).
 */

const tx = (id: string, extra: Partial<Transaction> = {}): Transaction =>
  ({
    id, kind: 'income', status: 'paid', amountMinor: 1000, receivedAmountMinor: 1000, currency: 'USD',
    occurredAt: '2026-09-10', paidAt: '2026-09-10', clientId: 'c1', projectId: 'p1',
    createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T00:00:00.000Z', ...extra,
  }) as Transaction;

const expense = (id: string, extra: Partial<Expense> = {}): Expense =>
  ({
    id, profileId: 'bp1', amountMinor: 300, currency: 'USD', occurredAt: '2026-09-10',
    clientId: 'c1', projectId: 'p1', createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T00:00:00.000Z', ...extra,
  }) as Expense;

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
const SEPTEMBER = { dateFrom: '2026-09-01', dateTo: '2026-09-30' };

describe('aggregateTransactionTotalsByCurrency', () => {
  it('skips a currency it has no bucket for instead of throwing or mixing it in', () => {
    const totals = aggregateTransactionTotalsByCurrency([tx('a'), tx('b', { currency: 'GBP' as Currency })]);

    expect(totals.USD.paidIncomeMinor).toBe(1000);
    expect(Object.keys(totals).sort()).toEqual(['AED', 'BHD', 'EUR', 'ILS', 'JOD', 'OMR', 'QAR', 'SAR', 'USD']);
  });
});

describe('aggregateTransactionTotalsWithActivity', () => {
  it('sums expenses, leaves conversions out of the money but counts them as activity', () => {
    const totals = aggregateTransactionTotalsWithActivity([
      tx('income', { occurredAt: '2026-09-01' }),
      tx('expense', { kind: 'expense', amountMinor: 400, occurredAt: '2026-09-05' }),
      tx('conversion', { kind: 'conversion' as Transaction['kind'], amountMinor: 9999, occurredAt: '2026-09-20' }),
    ]);

    expect(totals).toMatchObject({ paidIncomeMinor: 1000, expensesMinor: 400, lastActivityAt: '2026-09-20' });
  });

  it('tracks the latest payment date only when asked, ignoring an older one later in the list', () => {
    const rows = [tx('late', { paidAt: '2026-09-25' }), tx('early', { paidAt: '2026-09-02' }), tx('owed', { status: 'unpaid' })];

    expect(aggregateTransactionTotalsWithActivity(rows, { trackPayments: true }).lastPaymentAt).toBe('2026-09-25');
    expect(aggregateTransactionTotalsWithActivity(rows).lastPaymentAt).toBeUndefined();
  });
});

describe('period end dates are inclusive', () => {
  const rows = [
    tx('first', { occurredAt: '2026-09-01' }),
    tx('last-evening', { occurredAt: '2026-09-30T21:00:00' }),
    tx('next-day', { occurredAt: '2026-10-01' }),
    tx('before', { occurredAt: '2026-08-31' }),
  ];

  it('filterTransactionsByDateAndCurrency', () => {
    expect(ids(filterTransactionsByDateAndCurrency(rows, SEPTEMBER))).toEqual(['first', 'last-evening']);
  });

  it('filterTransactionsByEntityAndDate', () => {
    expect(ids(filterTransactionsByEntityAndDate(rows, 'client', 'c1', SEPTEMBER))).toEqual(['first', 'last-evening']);
  });

  it('filterExpensesByEntityAndDate', () => {
    const expenses = rows.map((r) => expense(r.id, { occurredAt: r.occurredAt }));
    expect(ids(filterExpensesByEntityAndDate(expenses, 'project', 'p1', SEPTEMBER))).toEqual(['first', 'last-evening']);
  });
});

describe('filterTransactionsByEntityAndDate', () => {
  const rows = [
    tx('match'),
    tx('other-project', { projectId: 'p2' }),
    tx('other-client', { clientId: 'c2' }),
    tx('shekel', { currency: 'ILS' }),
    tx('deleted', { deletedAt: '2026-09-11T00:00:00.000Z' }),
  ];

  it('keeps one project’s live entries in the chosen currency', () => {
    expect(ids(filterTransactionsByEntityAndDate(rows, 'project', 'p1', { currency: 'USD' }))).toEqual(['match', 'other-client']);
  });

  it('keeps one client’s live entries in the chosen currency', () => {
    expect(ids(filterTransactionsByEntityAndDate(rows, 'client', 'c1', { currency: 'USD' }))).toEqual(['match', 'other-project']);
  });
});

describe('filterExpensesByEntityAndDate', () => {
  const rows = [
    expense('match'),
    expense('other-project', { projectId: 'p2' }),
    expense('other-client', { clientId: 'c2' }),
    expense('shekel', { currency: 'ILS' }),
    expense('deleted', { deletedAt: '2026-09-11T00:00:00.000Z' }),
  ];

  it('keeps one client’s live expenses in the chosen currency', () => {
    expect(ids(filterExpensesByEntityAndDate(rows, 'client', 'c1', { currency: 'USD' }))).toEqual(['match', 'other-project']);
  });

  it('keeps one project’s live expenses from the start date on', () => {
    const dated = [...rows, expense('august', { occurredAt: '2026-08-31' })];
    expect(ids(filterExpensesByEntityAndDate(dated, 'project', 'p1', { dateFrom: '2026-09-01' }))).toEqual(['match', 'other-client', 'shekel']);
  });
});

describe('sumExpensesByCurrency', () => {
  it('sums each currency on its own and drops one it does not know', () => {
    const totals = sumExpensesByCurrency([
      expense('a'),
      expense('b', { amountMinor: 200 }),
      expense('c', { currency: 'ILS', amountMinor: 700 }),
      expense('d', { currency: 'GBP' as Currency, amountMinor: 5 }),
    ]);

    expect(totals).toEqual({ USD: 500, ILS: 700, EUR: 0, JOD: 0, AED: 0, SAR: 0, QAR: 0, BHD: 0, OMR: 0 });
  });
});
