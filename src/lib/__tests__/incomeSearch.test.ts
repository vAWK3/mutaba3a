/**
 * MUT-83: /income's filters are one model mirrored to the URL, so the clients
 * index's muted rows can link to the entries behind their figures.
 */
import { describe, it, expect } from 'vitest';
import {
  parseIncomeSearch,
  mergeIncomeSearch,
  resolveIncomeFilters,
  owedEntriesSearch,
} from '../incomeSearch';
import { getDateRangePreset } from '../utils';

describe('parseIncomeSearch', () => {
  it('reads nothing from an empty URL', () => {
    expect(parseIncomeSearch({})).toEqual({});
  });

  it('keeps every valid filter', () => {
    const search = { dateFrom: '2026-01-01', dateTo: '2026-01-31', status: 'unpaid', q: 'acme', client: 'none' };
    expect(parseIncomeSearch(search)).toEqual(search);
  });

  it('accepts each status and each client scope', () => {
    for (const status of ['unpaid', 'received', 'overdue']) {
      expect(parseIncomeSearch({ status }).status).toBe(status);
    }
    for (const client of ['none', 'archived']) {
      expect(parseIncomeSearch({ client }).client).toBe(client);
    }
  });

  it('drops values it does not know, so a hand-edited URL never breaks the page', () => {
    expect(parseIncomeSearch({ status: 'all', client: 'someone', other: 'x' })).toEqual({});
  });

  it('needs both ends of a period in YYYY-MM-DD, or takes neither', () => {
    expect(parseIncomeSearch({ dateFrom: '2026-01-01' })).toEqual({});
    expect(parseIncomeSearch({ dateFrom: '2026-01-01', dateTo: 'soon' })).toEqual({});
    expect(parseIncomeSearch({ dateFrom: '2026-1-1', dateTo: '2026-01-31' })).toEqual({});
  });

  it('reads a numeric search as text (the router parses ?q=2026 as a number) and drops an empty one', () => {
    expect(parseIncomeSearch({ q: 2026 })).toEqual({ q: '2026' });
    expect(parseIncomeSearch({ q: '' })).toEqual({});
  });
});

describe('mergeIncomeSearch', () => {
  it('applies a change and keeps the other filters', () => {
    expect(mergeIncomeSearch({ client: 'none', q: 'acme' }, { status: 'overdue' })).toEqual({
      client: 'none',
      q: 'acme',
      status: 'overdue',
    });
  });

  it('removes a filter set to undefined or to an empty search, so the URL stays clean', () => {
    expect(mergeIncomeSearch({ client: 'archived', q: 'acme', status: 'unpaid' }, { client: undefined, q: '' })).toEqual({
      status: 'unpaid',
    });
  });
});

describe('resolveIncomeFilters', () => {
  it('with no parameters gives the page its old defaults: this month, All, no search, every client', () => {
    expect(resolveIncomeFilters({})).toEqual({
      ...getDateRangePreset('this-month'),
      status: 'all',
      q: '',
      client: undefined,
    });
  });

  it('uses what the URL says', () => {
    expect(
      resolveIncomeFilters({ dateFrom: '2026-01-01', dateTo: '2026-01-31', status: 'received', q: 'x', client: 'archived' })
    ).toEqual({ dateFrom: '2026-01-01', dateTo: '2026-01-31', status: 'received', q: 'x', client: 'archived' });
  });
});

describe('owedEntriesSearch', () => {
  it('opens the unpaid entries of a client scope over all time, because Owed now has no period', () => {
    expect(owedEntriesSearch('none')).toEqual({ client: 'none', status: 'unpaid', ...getDateRangePreset('all') });
    expect(owedEntriesSearch('archived')).toEqual({ client: 'archived', status: 'unpaid', ...getDateRangePreset('all') });
  });
});
