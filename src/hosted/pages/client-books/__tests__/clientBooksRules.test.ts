import { describe, expect, it } from 'vitest';
import type { Entry } from '../../../api/client';
import {
  MAX_PERIOD_MONTHS,
  addMonths,
  feedBounds,
  feedKinds,
  lastDay,
  matchesClient,
  monthsBetween,
  parseClientBookSearch,
  periodLabel,
  periodOf,
  periodSearch,
  presetPeriod,
  showsClientBooks,
  totalsOf,
  visibleRows,
} from '../clientBooksRules';

const NOW = '2026-11';

describe('months', () => {
  it('adds across years and counts both ends', () => {
    expect(addMonths('2026-11', 2)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(monthsBetween('2026-07', '2026-09')).toBe(3);
    expect(monthsBetween('2026-09', '2026-07')).toBe(0);
    expect(lastDay('2028-02')).toBe('2028-02-29');
  });
});

describe('presets (whole months, never a future one)', () => {
  it('this month, this quarter so far, this year so far', () => {
    expect(presetPeriod('month', NOW)).toEqual({ preset: 'month', from: '2026-11', to: '2026-11' });
    expect(presetPeriod('quarter', NOW)).toEqual({ preset: 'quarter', from: '2026-10', to: '2026-11' });
    expect(presetPeriod('quarter', '2026-09')).toEqual({ preset: 'quarter', from: '2026-07', to: '2026-09' });
    expect(presetPeriod('year', NOW)).toEqual({ preset: 'year', from: '2026-01', to: '2026-11' });
  });

  it('defaults to this month', () => {
    expect(periodOf({}, NOW)).toEqual({ preset: 'month', from: NOW, to: NOW });
  });

  it('a custom range: Q3 as picked', () => {
    expect(periodOf({ preset: 'custom', from: '2026-07', to: '2026-09' }, NOW)).toEqual({ preset: 'custom', from: '2026-07', to: '2026-09' });
  });

  it('orders a reversed range, stops at this month and keeps at most a year', () => {
    expect(periodOf({ preset: 'custom', from: '2026-09', to: '2026-07' }, NOW)).toMatchObject({ from: '2026-07', to: '2026-09' });
    expect(periodOf({ preset: 'custom', from: '2026-10', to: '2027-03' }, NOW)).toMatchObject({ from: '2026-10', to: NOW });
    expect(periodOf({ preset: 'custom', from: '2027-01', to: '2027-03' }, NOW)).toMatchObject({ from: NOW, to: NOW });
    const long = periodOf({ preset: 'custom', from: '2024-01', to: '2026-10' }, NOW);
    expect(monthsBetween(long.from, long.to)).toBe(MAX_PERIOD_MONTHS);
    expect(long.to).toBe('2026-10');
  });

  it('round-trips through the search', () => {
    const period = periodOf({ preset: 'custom', from: '2026-07', to: '2026-09' }, NOW);
    expect(periodOf(parseClientBookSearch(periodSearch(period)), NOW)).toEqual(period);
    expect(periodSearch(presetPeriod('year', NOW))).toEqual({ preset: 'year' });
  });

  it('bounds the feed by whole months', () => {
    expect(feedBounds({ preset: 'custom', from: '2026-07', to: '2026-09' })).toEqual({ occurredFrom: '2026-07-01', occurredBefore: '2026-10-01' });
    expect(feedBounds({ preset: 'month', from: '2026-12', to: '2026-12' })).toEqual({ occurredFrom: '2026-12-01', occurredBefore: '2027-01-01' });
  });
});

describe('the search', () => {
  it('keeps only the keys it knows, each checked (no drawer key reaches the desk)', () => {
    expect(parseClientBookSearch({ preset: 'quarter', kind: 'income', receipts: 'only', newExpense: '1', newIncome: 'true', from: '2026-13', entry: 'x' })).toEqual({
      preset: 'quarter',
      kind: 'income',
      receipts: 'only',
    });
    expect(parseClientBookSearch({ entry: '11111111-1111-4111-8111-111111111111' })).toEqual({ entry: '11111111-1111-4111-8111-111111111111' });
  });

  it('maps the type filter to the feed kinds', () => {
    expect(feedKinds(undefined)).toEqual(['expense', 'received']);
    expect(feedKinds('expense')).toEqual(['expense']);
    expect(feedKinds('income')).toEqual(['received']);
  });
});

describe('rows and totals', () => {
  const expense = (receiptCount: number) => ({ kind: 'expense', expense: { receiptCount } }) as unknown as Entry;
  const received = { kind: 'received' } as unknown as Entry;
  const owed = { kind: 'owed' } as unknown as Entry;

  it('shows expenses and received payments; only-with-a-receipt keeps expenses with one', () => {
    expect(visibleRows([expense(0), received, owed], false)).toHaveLength(2);
    expect(visibleRows([expense(0), expense(2), received], true)).toEqual([expense(2)]);
  });

  it('one block per currency, never summed', () => {
    expect(totalsOf({ currencies: [{ currency: 'ILS', spent: '1612.40', received: '3200.00', byCategory: [], byCustomer: [] }, { currency: 'USD', spent: '20.00', received: '0.00', byCategory: [], byCustomer: [] }] })).toEqual([
      { currency: 'ILS', spent: '1612.40', received: '3200.00' },
      { currency: 'USD', spent: '20.00', received: '0.00' },
    ]);
  });
});

describe('the list', () => {
  it('searches the owner and the profile, ignoring case', () => {
    const client = { name: 'Studio', ownerName: 'Rana Haddad' };
    expect(matchesClient(client, 'rana')).toBe(true);
    expect(matchesClient(client, 'STU')).toBe(true);
    expect(matchesClient(client, 'omar')).toBe(false);
    expect(matchesClient({ name: 'المخبز', ownerName: null }, 'مخبز')).toBe(true);
  });

  it('shows the corner while any client is listed', () => {
    expect(showsClientBooks(undefined)).toBe(false);
    expect(showsClientBooks([])).toBe(false);
    expect(showsClientBooks([{}])).toBe(true);
  });

  it('names a period in either language with Western digits', () => {
    expect(periodLabel('2026-08', '2026-10', 'en')).toBe('Aug – Oct 2026');
    expect(periodLabel('2026-10', '2026-10', 'en')).toBe('Oct 2026');
    expect(periodLabel('2025-12', '2026-01', 'en')).toBe('Dec 2025 – Jan 2026');
    expect(periodLabel('2026-10', '2026-10', 'ar')).toMatch(/2026/);
  });
});
