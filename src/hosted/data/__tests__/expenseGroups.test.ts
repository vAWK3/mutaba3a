import { describe, expect, it, vi } from 'vitest';
import type { Expense, ExpenseGroup, ExpenseGroupSummary, FxRatesResponse } from '../../api/client';
import { currencyExponent } from '../../../lib/utils';
import {
  addDays,
  applyMarks,
  applyRowMarks,
  barMode,
  categoryRows,
  convertTotal,
  dayCount,
  daysBetween,
  defaultCurrency,
  filterMembers,
  groupByDay,
  groupStatus,
  inWindow,
  INVERSE_VERB,
  maxEndOn,
  needsEndDate,
  otherCurrencyDays,
  perDay,
  pickerWindow,
  positionOf,
  reachedYear,
  runSequential,
  toBars,
  VERB_MARK,
  verbFor,
  weekStart,
  type PendingMark,
} from '../expenseGroups';

const group = (over: Partial<ExpenseGroup> = {}): ExpenseGroup => ({
  id: 'g1',
  name: 'Jordan trip',
  startOn: '2026-10-03',
  endOn: '2026-10-07',
  windowEnd: '2026-10-07',
  notes: null,
  currencies: [],
  memberCount: 0,
  createdByUserId: 'u1',
  version: 1,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  ...over,
});

const open = (over: Partial<ExpenseGroup> = {}) => group({ endOn: null, windowEnd: '2027-10-03', ...over });

type Block = ExpenseGroupSummary['currencies'][number];
type Bucket = Block['byDay'][number];

const bucket = (date: string, total: string, count = 1, position: Bucket['position'] = 'in'): Bucket => ({ date, total, count, position });

function block(currency: Block['currency'], byDay: Bucket[], byCategory: Block['byCategory'] = []): Block {
  return { currency, total: '0', count: 0, byCategory, byCustomer: [], byDay, ...totals(currency, byDay) };
}

function totals(currency: Block['currency'], byDay: Bucket[]) {
  const exp = currencyExponent(currency);
  const minor = byDay.reduce((sum, b) => sum + Math.round(Number(b.total) * 10 ** exp), 0);
  return { total: (minor / 10 ** exp).toFixed(exp), count: byDay.reduce((n, b) => n + b.count, 0) };
}

const summary = (currencies: Block[], seriesFrom = '2026-10-03', seriesTo = '2026-10-07'): ExpenseGroupSummary => ({ groupId: 'g1', seriesFrom, seriesTo, currencies });

const expense = (over: Partial<Expense> & { id: string }): Expense =>
  ({ occurredOn: '2026-10-05', amount: '10.000', currency: 'JOD', categoryId: null, title: 'x', ...over }) as Expense;

describe('calendar helpers', () => {
  it('adds days across months and years, in UTC', () => {
    expect(addDays('2026-10-03', -30)).toBe('2026-09-03');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('counts days inclusively', () => {
    expect(daysBetween('2026-10-03', '2026-10-07')).toBe(5);
    expect(daysBetween('2026-10-03', '2026-10-03')).toBe(1);
  });

  it('caps the end at start + 365 days (366 including both ends)', () => {
    expect(maxEndOn('2026-10-18')).toBe('2027-10-18');
    expect(daysBetween('2026-10-18', maxEndOn('2026-10-18'))).toBe(366);
  });

  it('starts weeks on Saturday for Arabic and Monday for English', () => {
    // 2026-10-07 is a Wednesday
    expect(weekStart('2026-10-07', 'ar')).toBe('2026-10-03');
    expect(weekStart('2026-10-07', 'en')).toBe('2026-10-05');
    expect(weekStart('2026-10-05', 'en')).toBe('2026-10-05');
  });
});

describe('group status and nudges', () => {
  it('is upcoming before the start, ongoing on the first and last day, past after the end', () => {
    expect(groupStatus(group(), '2026-10-02')).toBe('upcoming');
    expect(groupStatus(group(), '2026-10-03')).toBe('ongoing');
    expect(groupStatus(group(), '2026-10-07')).toBe('ongoing');
    expect(groupStatus(group(), '2026-10-08')).toBe('past');
  });

  it('treats an open group as ongoing until its one-year window ends', () => {
    expect(groupStatus(open(), '2027-10-03')).toBe('ongoing');
    expect(groupStatus(open(), '2027-10-04')).toBe('past');
    expect(reachedYear(open(), '2027-10-03')).toBe(false);
    expect(reachedYear(open(), '2027-10-04')).toBe(true);
    expect(reachedYear(group(), '2030-01-01')).toBe(false);
  });

  it('asks an open group for an end date from 11 months on, until it reached a year', () => {
    expect(needsEndDate(open(), '2027-09-02')).toBe(false);
    expect(needsEndDate(open(), '2027-09-03')).toBe(true);
    expect(needsEndDate(open(), '2027-10-04')).toBe(false);
    expect(needsEndDate(group(), '2027-09-03')).toBe(false);
  });

  it('counts the days a group covers so far', () => {
    expect(dayCount(group(), '2026-10-20')).toBe(5);
    expect(dayCount(group(), '2026-09-01')).toBe(5);
    expect(dayCount(open(), '2026-10-18')).toBe(16);
    expect(dayCount(open(), '2026-09-01')).toBeNull();
    expect(dayCount(open(), '2028-01-01')).toBe(366);
  });
});

describe('membership window and actions', () => {
  it('is inside from start to windowEnd', () => {
    expect(inWindow('2026-10-03', group())).toBe(true);
    expect(inWindow('2026-10-07', group())).toBe(true);
    expect(inWindow('2026-10-02', group())).toBe(false);
    expect(inWindow('2026-10-08', group())).toBe(false);
  });

  it('positions a date against the window', () => {
    expect(positionOf('2026-09-12', group())).toBe('before');
    expect(positionOf('2026-10-05', group())).toBe('in');
    expect(positionOf('2026-10-23', group())).toBe('after');
  });

  it('follows the action → request table', () => {
    expect(verbFor('member', '2026-10-05', group())).toBe('leaveOut');
    expect(verbFor('member', '2026-09-12', group())).toBe('remove');
    expect(verbFor('excluded', '2026-10-05', group())).toBe('bringBack');
    expect(verbFor('pool', '2026-09-12', group())).toBe('add');
    expect(VERB_MARK).toEqual({ leaveOut: 'excluded', remove: null, bringBack: null, add: 'included' });
  });

  it('undoes each verb with its inverse', () => {
    expect(INVERSE_VERB).toEqual({ leaveOut: 'bringBack', bringBack: 'leaveOut', remove: 'add', add: 'remove' });
  });
});

describe('currency choice and per day', () => {
  const jod = block('JOD', [bucket('2026-10-03', '48.000', 2), bucket('2026-10-05', '96.000', 3)]);
  const usd = block('USD', [bucket('2026-10-05', '40.00', 6)]);

  it('opens on the currency with the most expenses, then the profile default, then alphabetical', () => {
    expect(defaultCurrency([jod, usd], 'ILS')).toBe('USD');
    const tie = block('USD', [bucket('2026-10-05', '40.00', 5)]);
    const tieJod = block('JOD', [bucket('2026-10-05', '40.000', 5)]);
    expect(defaultCurrency([tie, tieJod], 'JOD')).toBe('JOD');
    expect(defaultCurrency([tie, tieJod], 'ILS')).toBe('JOD');
    expect(defaultCurrency([], 'ILS')).toBeUndefined();
  });

  it('keeps a wanted currency the group has', () => {
    expect(defaultCurrency([jod, usd], 'ILS', 'JOD')).toBe('JOD');
    expect(defaultCurrency([jod, usd], 'ILS', 'EUR')).toBe('USD');
  });

  it('divides in-window spend by elapsed days, hidden before day 1', () => {
    const withKept = block('JOD', [bucket('2026-09-12', '120.000', 1, 'before'), ...jod.byDay]);
    expect(perDay(withKept, group(), '2026-10-02')).toBeNull();
    expect(perDay(withKept, group(), '2026-10-04')).toBe('24.000');
    expect(perDay(withKept, group(), '2026-12-01')).toBe('28.800');
  });

  it('leaves spend on days still to come out of per day (a prepaid hotel in a trip under way)', () => {
    const b = block('JOD', [bucket('2026-10-03', '10.000'), bucket('2026-10-06', '90.000')]);
    expect(perDay(b, group(), '2026-10-04')).toBe('5.000');
  });

  it('rounds half away from zero in the currency’s digits', () => {
    expect(perDay(block('USD', [bucket('2026-10-03', '10.00')]), group(), '2026-10-05')).toBe('3.33');
    expect(perDay(block('USD', [bucket('2026-10-03', '0.05')]), group(), '2026-10-04')).toBe('0.03');
  });
});

describe('bars', () => {
  it('draws a daily bar per series day and sparse before/after bars that sum to the total', () => {
    const b = block('JOD', [bucket('2026-09-12', '120.000', 1, 'before'), bucket('2026-10-03', '48.000'), bucket('2026-10-04', '0.000', 0), bucket('2026-10-23', '80.000', 1, 'after')]);
    const bars = toBars(b, 'daily', 'en');
    expect(bars.map((x) => [x.from, x.position, x.total])).toEqual([
      ['2026-09-12', 'before', '120.000'],
      ['2026-10-03', 'in', '48.000'],
      ['2026-10-04', 'in', '0.000'],
      ['2026-10-23', 'after', '80.000'],
    ]);
    const sum = bars.reduce((s, x) => s + x.minor, 0);
    expect(sum).toBe(248000);
    expect(bars[1]!.max).toBe(120000);
  });

  it('sums weekly bars by locale week start, keeping before/after apart', () => {
    const b = block('USD', [
      bucket('2026-09-30', '5.00', 1, 'before'),
      bucket('2026-10-03', '1.00'),
      bucket('2026-10-04', '2.00'),
      bucket('2026-10-05', '4.00'),
      bucket('2026-10-12', '8.00'),
    ]);
    const en = toBars(b, 'weekly', 'en');
    expect(en.map((x) => [x.from, x.to, x.position, x.total, x.count])).toEqual([
      ['2026-09-28', '2026-10-04', 'before', '5.00', 1],
      ['2026-09-28', '2026-10-04', 'in', '3.00', 2],
      ['2026-10-05', '2026-10-11', 'in', '4.00', 1],
      ['2026-10-12', '2026-10-18', 'in', '8.00', 1],
    ]);
    expect(toBars(b, 'weekly', 'ar').map((x) => x.from)).toEqual(['2026-09-26', '2026-10-03', '2026-10-10']);
  });

  it('switches to weekly past 31 days, or past 21 on a narrow screen', () => {
    expect(barMode(summary([], '2026-10-01', '2026-10-31'), false)).toBe('daily');
    expect(barMode(summary([], '2026-10-01', '2026-11-01'), false)).toBe('weekly');
    expect(barMode(summary([], '2026-10-01', '2026-10-21'), true)).toBe('daily');
    expect(barMode(summary([], '2026-10-01', '2026-10-22'), true)).toBe('weekly');
  });

  it('marks series days where only another currency was spent', () => {
    const s = summary([
      block('JOD', [bucket('2026-10-05', '0.000', 0), bucket('2026-10-06', '5.000')]),
      block('USD', [bucket('2026-10-05', '40.00'), bucket('2026-10-06', '1.00')]),
      block('ILS', [bucket('2026-10-05', '3.00')]),
    ]);
    expect(otherCurrencyDays(s, 'JOD')).toEqual(new Map([['2026-10-05', ['USD', 'ILS']]]));
  });
});

describe('category rows', () => {
  it('orders by amount, Uncategorized last, with shares of the currency total', () => {
    const b = { ...block('JOD', [bucket('2026-10-05', '100.000', 4)]), byCategory: [
      { categoryId: null, total: '45.000', count: 1 },
      { categoryId: 'rent', total: '30.000', count: 2 },
      { categoryId: 'travel', total: '25.000', count: 1 },
    ] };
    const rows = categoryRows(b, new Map([['rent', 'Rent'], ['travel', 'Travel']]), 'Uncategorized');
    expect(rows.map((r) => [r.key, r.name, r.share])).toEqual([
      ['rent', 'Rent', 30],
      ['travel', 'Travel', 25],
      ['none', 'Uncategorized', 45],
    ]);
  });
});

describe('picker window', () => {
  it('offers the 30 days before the start', () => {
    expect(pickerWindow(group(), 'before')).toEqual({ from: '2026-09-03', to: '2026-10-02' });
  });
  it('offers 30 days after the end only for a closed group', () => {
    expect(pickerWindow(group(), 'after')).toEqual({ from: '2026-10-08', to: '2026-11-06' });
    expect(pickerWindow(open(), 'after')).toBeNull();
  });
});

describe('converted total', () => {
  const rates = (over: Partial<FxRatesResponse> = {}): FxRatesResponse => ({
    base: 'ILS',
    rateDate: '2026-10-17',
    fetchedAt: '2026-10-18T08:00:00Z',
    source: 'live',
    rates: [
      { currency: 'ILS', rate: 1, derived: false },
      { currency: 'USD', rate: 0.27, derived: false },
      { currency: 'EUR', rate: 0.25, derived: false },
      { currency: 'JOD', rate: 0.191428, derived: true },
    ],
    ...over,
  });

  it('divides each currency by its rate into the base and sums', () => {
    const s = summary([block('USD', [bucket('2026-10-05', '27.00')]), block('EUR', [bucket('2026-10-05', '10.00')])]);
    const c = convertTotal(s, rates());
    expect(c).toMatchObject({ total: '140.00', currency: 'ILS', rateDate: '2026-10-17', stale: false, derived: false });
    expect(c?.used.map((u) => u.currency)).toEqual(['USD', 'EUR']);
  });

  it('rescales between exponents and flags derived JOD rates', () => {
    const s = summary([block('JOD', [bucket('2026-10-05', '1.914')])]);
    expect(convertTotal(s, rates())).toMatchObject({ total: '10.00', derived: true });
    const toUsd = convertTotal(summary([block('JOD', [bucket('2026-10-05', '0.709')])]), rates({ base: 'USD', rates: [{ currency: 'USD', rate: 1, derived: false }, { currency: 'JOD', rate: 0.709, derived: true }] }));
    expect(toUsd?.total).toBe('1.00');
  });

  it('gives nothing when a currency has no rate, and says when the rates are stale', () => {
    const s = summary([block('USD', [bucket('2026-10-05', '27.00')])]);
    expect(convertTotal(s, rates({ rates: [{ currency: 'ILS', rate: 1, derived: false }] }))).toBeNull();
    expect(convertTotal(s, rates({ source: 'stale' }))?.stale).toBe(true);
    expect(convertTotal(summary([]), rates())).toBeNull();
  });

  it('carries the derived flag per rate line, not a currency check (MUT-281, the peg-label bug)', () => {
    // A mixed group: JOD (pegged) and EUR (not pegged) into an ILS base.
    // Before this fix, `used` carried only {currency, rate} -- the component had
    // to re-derive "is this pegged?" itself, and it only ever checked === 'JOD'.
    const s = summary([block('JOD', [bucket('2026-10-05', '9.500')]), block('EUR', [bucket('2026-10-05', '10.00')])]);
    const c = convertTotal(
      s,
      rates({
        rates: [
          { currency: 'ILS', rate: 1, derived: false },
          { currency: 'EUR', rate: 0.25, derived: false },
          { currency: 'JOD', rate: 0.2, derived: true },
        ],
      })
    );
    expect(c?.used).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ currency: 'JOD', derived: true }),
        expect.objectContaining({ currency: 'EUR', derived: false }),
      ])
    );
  });

  it('still carries derived: true on a JOD line after the per-line refactor (regression)', () => {
    const s = summary([block('JOD', [bucket('2026-10-05', '1.914')])]);
    const c = convertTotal(s, rates());
    expect(c?.used).toEqual([expect.objectContaining({ currency: 'JOD', derived: true })]);
  });
});

describe('optimistic marks', () => {
  const taxi = expense({ id: 'e1', occurredOn: '2026-10-05', amount: '18.000', categoryId: 'travel' });
  const flight = expense({ id: 'e2', occurredOn: '2026-09-12', amount: '120.000', categoryId: 'travel' });
  const base = summary([
    { ...block('JOD', [bucket('2026-10-05', '18.000')]), byCategory: [{ categoryId: 'travel', total: '18.000', count: 1 }] },
  ]);
  const mark = (verb: PendingMark['verb'], row: Expense): PendingMark => ({ id: `${verb}-${row.id}`, verb, row, settled: null });

  it('takes a left-out expense off its currency, day and category', () => {
    const after = applyMarks(base, [mark('leaveOut', taxi)]);
    const jod = after.currencies.find((c) => c.currency === 'JOD');
    expect(jod).toBeUndefined();
  });

  it('adds a kept expense on its own sparse day and category', () => {
    const after = applyMarks(base, [mark('add', flight)]);
    const jod = after.currencies[0]!;
    expect(jod.total).toBe('138.000');
    expect(jod.count).toBe(2);
    expect(jod.byDay.map((d) => [d.date, d.position, d.total])).toEqual([
      ['2026-09-12', 'before', '120.000'],
      ['2026-10-05', 'in', '18.000'],
    ]);
    expect(jod.byCategory).toEqual([{ categoryId: 'travel', total: '138.000', count: 2 }]);
  });

  it('creates a currency block for a new currency', () => {
    const after = applyMarks(base, [mark('add', expense({ id: 'e3', currency: 'USD', amount: '5.00', occurredOn: '2026-10-04' }))]);
    expect(after.currencies.map((c) => c.currency)).toEqual(['JOD', 'USD']);
  });

  it('never mutates its input and nets out an action with its undo', () => {
    const copy = structuredClone(base);
    const after = applyMarks(base, [mark('leaveOut', taxi), mark('bringBack', taxi)]);
    expect(base).toEqual(copy);
    expect(after.currencies[0]!.total).toBe('18.000');
  });

  it('moves rows between members and left out', () => {
    const rows = applyRowMarks([taxi], [], [mark('leaveOut', taxi)]);
    expect(rows.members).toEqual([]);
    expect(rows.excluded).toEqual([taxi]);
    const added = applyRowMarks([taxi], [], [mark('add', flight)]);
    expect(added.members.map((r) => r.id)).toEqual(['e2', 'e1']);
    expect(applyRowMarks([flight, taxi], [], [mark('remove', flight)]).members).toEqual([taxi]);
    expect(applyRowMarks([], [taxi], [mark('bringBack', taxi)])).toEqual({ members: [taxi], excluded: [] });
  });
});

describe('member list', () => {
  const rows = [
    expense({ id: 'a', occurredOn: '2026-10-03', categoryId: 'rent', currency: 'JOD' }),
    expense({ id: 'b', occurredOn: '2026-10-03', categoryId: null, currency: 'JOD' }),
    expense({ id: 'c', occurredOn: '2026-10-05', categoryId: 'rent', currency: 'USD', amount: '1.00' }),
  ];

  it('filters by category within the selected currency; none is Uncategorized', () => {
    expect(filterMembers(rows, 'rent', 'JOD').map((r) => r.id)).toEqual(['a']);
    expect(filterMembers(rows, 'none', 'JOD').map((r) => r.id)).toEqual(['b']);
    expect(filterMembers(rows, undefined, 'JOD')).toBe(rows);
  });

  it('groups rows by day, oldest first, with each day’s subtotals from the summary', () => {
    const s = summary([
      block('JOD', [bucket('2026-10-03', '20.000', 2)]),
      block('USD', [bucket('2026-10-05', '1.00')]),
    ]);
    const days = groupByDay(rows, s);
    expect(days.map((d) => [d.date, d.rows.map((r) => r.id), d.subtotals])).toEqual([
      ['2026-10-03', ['a', 'b'], [{ currency: 'JOD', total: '20.000' }]],
      ['2026-10-05', ['c'], [{ currency: 'USD', total: '1.00' }]],
    ]);
  });
});

describe('runSequential', () => {
  it('saves one at a time in order and reports the failures', async () => {
    const order: string[] = [];
    let active = 0;
    const save = vi.fn(async (id: string) => {
      active += 1;
      expect(active).toBe(1);
      order.push(id);
      await Promise.resolve();
      active -= 1;
      if (id === 'b') throw new Error('nope');
    });
    const result = await runSequential(['a', 'b', 'c'], save);
    expect(order).toEqual(['a', 'b', 'c']);
    expect(result).toEqual({ done: ['a', 'c'], failed: ['b'] });
  });
});
