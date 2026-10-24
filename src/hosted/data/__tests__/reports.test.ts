import { describe, expect, it } from 'vitest';
import type { ActivitySummary, FxRatesResponse } from '../../api/client';
import {
  chartBars,
  chooseUnit,
  combine,
  monthPoints,
  shareRows,
  type Combined,
  completeMonths,
  hasNext,
  hasPrevious,
  inUnit,
  periodRange,
  stageOf,
  stepPeriod,
  unlockMonth,
  type ProfileBlock,
} from '../reports';

/** MUT-175: periods, stages and the All-profiles combine behind Reports (plan §4.3, D1, A4, DR14, DR30). */

describe('periodRange', () => {
  it('starts a week on Monday in English and Saturday in Arabic (the expense groups’ convention)', () => {
    // 2026-10-22 is a Thursday
    expect(periodRange('week', '2026-10-22', 'en')).toEqual({ from: '2026-10-19', to: '2026-10-25' });
    expect(periodRange('week', '2026-10-22', 'ar')).toEqual({ from: '2026-10-17', to: '2026-10-23' });
  });

  it('covers the calendar month and the calendar year', () => {
    expect(periodRange('month', '2026-02-14', 'en')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(periodRange('month', '2028-02-14', 'en')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(periodRange('year', '2026-10-22', 'ar')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });
});

describe('stepping', () => {
  it('steps across a year end in every period', () => {
    expect(stepPeriod('week', '2026-12-30', 1, 'en')).toBe('2027-01-04');
    expect(stepPeriod('month', '2026-12-15', 1, 'en')).toBe('2027-01-01');
    expect(stepPeriod('month', '2027-01-31', -1, 'en')).toBe('2026-12-01');
    expect(stepPeriod('year', '2026-06-01', -1, 'en')).toBe('2025-01-01');
  });

  it('offers Next only up to the current period, and Previous only back to the first record', () => {
    expect(hasNext('month', '2026-10-01', '2026-10-24', 'en')).toBe(false);
    expect(hasNext('month', '2026-09-01', '2026-10-24', 'en')).toBe(true);
    expect(hasPrevious('month', '2026-10-01', '2026-09-30', false, 'en')).toBe(true);
    expect(hasPrevious('month', '2026-10-01', '2026-10-01', false, 'en')).toBe(false);
    expect(hasPrevious('month', '2026-10-01', null, false, 'en')).toBe(false);
    // older records than the history reads: always allowed back
    expect(hasPrevious('month', '2026-10-01', '2026-10-01', true, 'en')).toBe(true);
  });
});

describe('stages (B3, DR14: a month counts only if records start by its 7th day)', () => {
  it('counts complete months before this one, from the first month that started by its 7th day', () => {
    expect(completeMonths('2026-09-07', false, '2026-10-24')).toEqual(['2026-09']);
    expect(completeMonths('2026-09-08', false, '2026-10-24')).toEqual([]);
    expect(completeMonths('2026-08-01', false, '2026-10-24')).toEqual(['2026-08', '2026-09']);
    expect(completeMonths(null, false, '2026-10-24')).toEqual([]);
  });

  it('treats records older than the history as every month complete', () => {
    expect(completeMonths('2026-10-03', true, '2026-10-24')).toHaveLength(11);
  });

  it('maps 0, 1 and 2+ complete months to stages 1, 2 and 3', () => {
    expect(stageOf(0)).toBe(1);
    expect(stageOf(1)).toBe(2);
    expect(stageOf(2)).toBe(3);
    expect(stageOf(9)).toBe(3);
  });

  it('names the month the next stage unlocks', () => {
    expect(unlockMonth('2026-10-03', 1)).toBe('2026-11');
    expect(unlockMonth('2026-10-08', 1)).toBe('2026-12');
    expect(unlockMonth('2026-10-03', 2)).toBe('2026-12');
    expect(unlockMonth('2026-10-03', 3)).toBeNull();
    expect(unlockMonth(null, 1)).toBeNull();
  });
});

const flow = (currency: 'ILS' | 'USD' | 'JOD', received: string, spent: string) => ({ currency, received, spent });
const act = (currency: 'ILS' | 'USD' | 'JOD', received: string, spent: string, extra: Partial<ActivitySummary['currencies'][number]> = {}) => ({ ...flow(currency, received, spent), byCategory: [], byCustomer: [], ...extra });

function activity(extra: Partial<ActivitySummary>): ActivitySummary {
  return {
    from: '2026-10-01',
    to: '2026-10-02',
    bucket: 'day',
    asOf: '2026-10-24',
    dataSince: null,
    earlierData: false,
    buckets: [],
    currencies: [],
    history: [],
    daysToPaid: { overall: null, byCustomer: [], samples: [] },
    ...extra,
  };
}

const CAT_A = '00000000-0000-4000-8000-00000000000a';
const CAT_B = '00000000-0000-4000-8000-00000000000b';
const CLIENT = '00000000-0000-4000-8000-0000000000c1';

function block(profileId: string, profileName: string, a: ActivitySummary, categories: Record<string, string> = {}): ProfileBlock {
  return { profileId, profileName, activity: a, categoryName: (id) => (id ? (categories[id] ?? '?') : 'Uncategorized'), clientName: (id) => (id ? 'Haddad' : 'No client') };
}

describe('combine', () => {
  const personal = block(
    'p1',
    'Personal',
    activity({
      dataSince: '2026-09-02',
      buckets: [
        { start: '2026-10-01', currencies: [flow('ILS', '100.00', '10.00')] },
        { start: '2026-10-02', currencies: [flow('ILS', '0.00', '5.00')] },
      ],
      currencies: [act('ILS', '100.00', '15.00', { byCategory: [{ categoryId: CAT_A, total: '15.00', count: 2 }], byCustomer: [{ customerId: CLIENT, total: '100.00', count: 1 }] })],
      history: [{ month: '2026-10', currencies: [act('ILS', '100.00', '15.00')] }],
      daysToPaid: { overall: { median: 10, n: 3 }, byCustomer: [{ customerId: CLIENT, median: 10, n: 3 }], samples: [0, 0, 100] },
    }),
    { [CAT_A]: 'Food' },
  );
  const studio = block(
    'p2',
    'Studio',
    activity({
      dataSince: '2026-06-20',
      buckets: [
        { start: '2026-10-01', currencies: [flow('USD', '40.00', '0.00')] },
        { start: '2026-10-02', currencies: [flow('USD', '0.00', '0.00')] },
      ],
      currencies: [act('USD', '40.00', '0.00', { byCustomer: [{ customerId: CLIENT, total: '40.00', count: 1 }] }), act('ILS', '0.00', '7.00', { byCategory: [{ categoryId: CAT_B, total: '7.00', count: 1 }] })],
      history: [{ month: '2026-10', currencies: [act('USD', '40.00', '0.00')] }],
      daysToPaid: { overall: { median: 50, n: 3 }, byCustomer: [], samples: [50, 50, 50] },
    }),
    { [CAT_B]: 'food ' },
  );

  it('one profile passes through, with no profile names on its clients', () => {
    const one = combine([personal]);
    expect(one.received).toEqual(new Map([['ILS', 10000]]));
    expect(one.clients).toEqual([{ key: `p1:${CLIENT}`, name: 'Haddad', profileName: null, amounts: new Map([['ILS', 10000]]), daysToPaid: 10, none: false }]);
    expect(one.daysToPaid).toBe(0);
    expect(one.since).toBe('2026-09-02');
  });

  it('adds profiles per currency, aligns buckets and months by date, and takes the earliest start', () => {
    const both = combine([personal, studio]);
    expect(both.received).toEqual(new Map([['ILS', 10000], ['USD', 4000]]));
    expect(both.spent).toEqual(new Map([['ILS', 2200], ['USD', 0]]));
    expect(both.buckets.map((b) => [b.start, Object.fromEntries(b.received)])).toEqual([
      ['2026-10-01', { ILS: 10000, USD: 4000 }],
      ['2026-10-02', { ILS: 0, USD: 0 }],
    ]);
    expect(both.history.find((h) => h.month === '2026-10')!.received).toEqual(new Map([['ILS', 10000], ['USD', 4000]]));
    expect(both.since).toBe('2026-06-20');
  });

  it('merges categories by name across profiles, but keeps one client row per profile (DR30)', () => {
    const both = combine([personal, studio]);
    expect(both.categories.map((c) => [c.name, Object.fromEntries(c.amounts)])).toEqual([['Food', { ILS: 2200 }]]);
    expect(both.clients.map((c) => [c.key, c.profileName])).toEqual([
      [`p1:${CLIENT}`, 'Personal'],
      [`p2:${CLIENT}`, 'Studio'],
    ]);
  });

  it('combines days to get paid as one true median over every profile’s samples, n ≥ 3 combined (D2)', () => {
    // [0, 0, 100] + [50, 50, 50]: the median of medians said 25; the true median is 50 (review)
    expect(combine([personal, studio]).daysToPaid).toBe(50);
    const two = (samples: number[]) => ({ ...studio, activity: { ...studio.activity, daysToPaid: { overall: null, byCustomer: [], samples } } });
    expect(combine([two([4, 6]), { ...two([5, 9]), profileId: 'p3' }]).daysToPaid).toBe(6);
    expect(combine([two([4, 6])]).daysToPaid).toBeNull();
  });

  it('never merges categories whose names are not known, and keys names apart from Uncategorized (review)', () => {
    const unknown = { ...personal, categoryName: () => null };
    const both = combine([unknown, { ...studio, categoryName: () => null }]);
    expect(both.categories.map((c) => [c.key, c.name])).toEqual([
      [`id:p1:${CAT_A}`, '—'],
      [`id:p2:${CAT_B}`, '—'],
    ]);
    const named = combine([{ ...personal, categoryName: (id: string | null) => (id ? 'None' : 'Uncategorized') }]);
    expect(named.categories.map((c) => c.key)).toEqual(['name:none']);
  });
});

const rates: FxRatesResponse = {
  base: 'ILS',
  rateDate: '2026-10-23',
  fetchedAt: '2026-10-24T06:00:00Z',
  source: 'live',
  rates: [
    { currency: 'ILS', rate: 1, derived: false },
    { currency: 'USD', rate: 0.25, derived: false },
  ],
} as FxRatesResponse;

describe('shaping for the page (rows arrive already shaped)', () => {
  const ils = { currency: 'ILS' as const, rates: null, singleCurrency: false };
  const c = {
    since: '2026-10-02',
    earlier: false,
    received: new Map([['ILS', 30000]]),
    spent: new Map([['ILS', 10000]]),
    buckets: [
      { start: '2026-10-01', received: new Map(), spent: new Map() },
      { start: '2026-10-02', received: new Map([['ILS', 30000]]), spent: new Map([['ILS', 6000]]) },
      { start: '2026-10-03', received: new Map([['USD', 500]]), spent: new Map([['ILS', 4000]]) },
    ],
    categories: [
      { key: 'no-category', name: 'Uncategorized', uncategorized: true, amounts: new Map([['ILS', 7000]]) },
      { key: 'name:food', name: 'Food', uncategorized: false, amounts: new Map([['ILS', 3000]]) },
    ],
    clients: [
      { key: 'p1:no-client', name: 'No client', profileName: null, amounts: new Map([['ILS', 10000]]), daysToPaid: null, none: true },
      { key: 'p1:c1', name: 'Haddad', profileName: null, amounts: new Map([['ILS', 20000]]), daysToPaid: 6, none: false },
    ],
    history: [{ month: '2026-09', received: new Map([['ILS', 9000]]), spent: new Map(), categories: [], clients: [{ key: 'p1:no-client', name: 'No client', profileName: null, amounts: new Map([['ILS', 9000]]), daysToPaid: null, none: true }] }],
    daysToPaid: null,
  } as unknown as Combined;

  it('draws month buckets to each month’s last day, marking only the months before the first record as “before”', () => {
    const year = { ...c, since: '2026-02-14', buckets: [{ start: '2026-01-01', received: new Map(), spent: new Map() }, { start: '2026-02-01', received: new Map([['ILS', 100]]), spent: new Map() }] } as unknown as Combined;
    const { bars } = chartBars(year, ils, 'month');
    expect(bars.map((b) => [b.key, b.to, b.position])).toEqual([
      ['2026-01-01', '2026-01-31', 'before'],
      ['2026-02-01', '2026-02-28', 'in'],
    ]);
  });

  it('draws one bar per bucket in the unit, days before the first record as “before”, with the tallest of both series as max', () => {
    const { bars, spent, other } = chartBars(c, ils);
    expect(bars.map((b) => [b.key, b.position, b.minor, b.max])).toEqual([
      ['2026-10-01', 'before', 0, 30000],
      ['2026-10-02', 'in', 30000, 30000],
      ['2026-10-03', 'in', 0, 30000],
    ]);
    expect(spent.get('2026-10-03')).toBe(4000);
    // money only in a currency left out of the unit gets the dot
    expect([...other]).toEqual(['2026-10-03']);
  });

  it('turns rows into shares of the total, largest first, Uncategorized and no client last', () => {
    expect(shareRows(c.categories, ils).map((r) => [r.key, r.total, r.share])).toEqual([
      ['name:food', '30.00', 30],
      ['none', '70.00', 70],
    ]);
    expect(shareRows(c.clients, ils).map((r) => [r.key, r.share])).toEqual([
      ['p1:c1', 67],
      ['p1:no-client', 33],
    ]);
  });

  it('makes month points for insights, marking money with no client', () => {
    const [sept] = monthPoints(c, ['2026-09'], ils);
    expect(sept).toEqual({ month: '2026-09', received: 9000, spent: 0, categories: [], clients: [{ key: 'p1:no-client', name: 'No client', amount: 9000, none: true }] });
    expect(monthPoints(c, ['2026-08'], ils)).toEqual([{ month: '2026-08', received: 0, spent: 0, categories: [], clients: [] }]);
  });
});

describe('units for insights (D3)', () => {
  it('uses one currency with no rates when only one is in view', () => {
    expect(chooseUnit(['USD'], 'ILS', undefined, () => 0)).toEqual({ currency: 'USD', rates: null, singleCurrency: false });
    expect(chooseUnit([], 'ILS', undefined, () => 0)).toEqual({ currency: 'ILS', rates: null, singleCurrency: false });
  });

  it('converts to the base when every currency has a rate', () => {
    const unit = chooseUnit(['ILS', 'USD'], 'ILS', rates, () => 0);
    expect(unit).toEqual({ currency: 'ILS', rates, singleCurrency: false });
    expect(inUnit(new Map([['ILS', 10000], ['USD', 4000]]), unit)).toBe(26000);
  });

  it('falls back to the largest currency in view, labelled, when a rate is missing', () => {
    const unit = chooseUnit(['ILS', 'USD', 'JOD'], 'ILS', rates, (c) => (c === 'USD' ? 9 : 2));
    expect(unit).toEqual({ currency: 'USD', rates: null, singleCurrency: true });
    expect(inUnit(new Map([['ILS', 10000], ['USD', 4000]]), unit)).toBe(4000);
    expect(chooseUnit(['ILS', 'USD'], 'ILS', undefined, (c) => (c === 'ILS' ? 5 : 1))).toEqual({ currency: 'ILS', rates: null, singleCurrency: true });
  });
});
