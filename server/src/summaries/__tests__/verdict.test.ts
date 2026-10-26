import { describe, expect, it } from 'vitest';
import { convertToBase, type FxRate } from '../../fx-rates.js';
import type { Currency } from '../../money.js';
import type { ReceivableRecord } from '../../repositories/ports.js';
import type { ActivitySummary, CurrencyActivity } from '../activity.js';
import { baseProfileOf, composeVerdict, owedOf, type VerdictProfileInput } from '../verdict.js';

/** MUT-447: the verdict across a person's profiles (design R1–R8, eng review D2–D12). */

const ILS_PER_USD = 3.7;
const rates = (base: Currency = 'ILS'): FxRate[] =>
  base === 'ILS'
    ? [
        { currency: 'ILS', rate: 1, derived: false },
        { currency: 'USD', rate: 1 / ILS_PER_USD, derived: false },
        { currency: 'JOD', rate: 0.709 / ILS_PER_USD, derived: true },
        { currency: 'EUR', rate: 0.25, derived: false },
      ]
    : [
        { currency: 'USD', rate: 1, derived: false },
        { currency: 'ILS', rate: ILS_PER_USD, derived: false },
        { currency: 'JOD', rate: 0.709, derived: true },
        { currency: 'EUR', rate: 0.92, derived: false },
      ];

function block(currency: Currency, received: string, spent: string, rows = 1): CurrencyActivity {
  return { currency, received, spent, byCategory: [{ categoryId: null, total: spent, count: rows }], byCustomer: [{ customerId: null, total: received, count: rows }] };
}

const MONTHS = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];

function activity(period: CurrencyActivity[], history: Record<string, CurrencyActivity[]> = {}, dataSince: string | null = '2025-11-01'): Pick<ActivitySummary, 'currencies' | 'history' | 'dataSince'> {
  return { currencies: period, history: MONTHS.map((month) => ({ month, currencies: history[month] ?? [] })), dataSince };
}

let seq = 0;
function profile(over: Partial<VerdictProfileInput> & Pick<VerdictProfileInput, 'kind'>): VerdictProfileInput {
  seq += 1;
  return {
    profileId: `p${seq}`,
    name: `Profile ${seq}`,
    shared: false,
    createdAt: new Date(Date.UTC(2025, 0, seq)),
    defaultCurrency: 'ILS',
    timezone: 'Asia/Jerusalem',
    earlierData: false,
    activity: activity([]),
    owed: { currencies: [], overdueCount: 0 },
    ...over,
  };
}

const OCT = { from: '2026-10-01', to: '2026-10-31' };

describe('composeVerdict: totals', () => {
  it('kept = business net − personal spent (+ personal came in), per currency', () => {
    const v = composeVerdict({
      ...OCT,
      base: 'ILS',
      rates: rates(),
      profiles: [profile({ kind: 'BUSINESS', activity: activity([block('ILS', '9000.00', '1000.00')]) }), profile({ kind: 'PERSONAL', activity: activity([block('ILS', '500.00', '6000.00')]) })],
    });
    expect(v.total).toMatchObject({ label: 'kept', currencies: [{ currency: 'ILS', net: '2500.00' }], converted: '2500.00', inCurrencyOnly: null, sharedInFull: false });
    expect(v.profiles[1]).toMatchObject({ kind: 'PERSONAL', currencies: [{ currency: 'ILS', received: '500.00', spent: '6000.00', net: '-5500.00' }] });
  });

  it('labels the total businessNet when no personal profile is included', () => {
    const v = composeVerdict({ ...OCT, base: 'ILS', rates: rates(), profiles: [profile({ kind: 'BUSINESS', activity: activity([block('ILS', '100.00', '0.00')]) })] });
    expect(v.total.label).toBe('businessNet');
  });

  it('counts two personal profiles and FIRM lines; shared ones are flagged in full', () => {
    const v = composeVerdict({
      ...OCT,
      base: 'ILS',
      rates: rates(),
      profiles: [
        profile({ kind: 'FIRM', shared: true, activity: activity([block('ILS', '4200.00', '0.00')]) }),
        profile({ kind: 'PERSONAL', activity: activity([block('ILS', '0.00', '100.00')]) }),
        profile({ kind: 'PERSONAL', activity: activity([block('ILS', '0.00', '50.00')]) }),
      ],
    });
    expect(v.total).toMatchObject({ label: 'kept', converted: '4050.00', sharedInFull: true });
  });

  it('never sums currencies itself: per-currency nets plus one converted figure at one rate set', () => {
    const v = composeVerdict({
      ...OCT,
      base: 'ILS',
      rates: rates(),
      profiles: [profile({ kind: 'BUSINESS', activity: activity([block('USD', '1000.00', '0.00'), block('ILS', '0.00', '700.00')]) })],
    });
    expect(v.total.currencies).toEqual([
      { currency: 'ILS', net: '-700.00' },
      { currency: 'USD', net: '1000.00' },
    ]);
    expect(v.total.converted).toBe('3000.00');
    expect(v.profiles[0]!.converted).toEqual({ received: '3700.00', spent: '700.00', net: '3000.00' });
  });

  it('without rates and more than one currency: converted null, inCurrencyOnly = the busiest currency', () => {
    const v = composeVerdict({
      ...OCT,
      base: 'ILS',
      rates: null,
      profiles: [profile({ kind: 'BUSINESS', activity: activity([block('USD', '1000.00', '0.00', 1), block('ILS', '50.00', '700.00', 9)]) })],
    });
    expect(v.total).toMatchObject({ converted: null, inCurrencyOnly: 'ILS' });
    expect(v.profiles[0]!.converted).toBeNull();
  });

  it('without rates but everything in the base currency: the converted figures are the plain sums (D4)', () => {
    const v = composeVerdict({ ...OCT, base: 'ILS', rates: null, profiles: [profile({ kind: 'BUSINESS', activity: activity([block('ILS', '10.00', '4.00')]) })] });
    expect(v.total).toMatchObject({ converted: '6.00', inCurrencyOnly: null });
  });

  it('an empty period answers zero, not null', () => {
    const v = composeVerdict({ ...OCT, base: 'ILS', rates: null, profiles: [profile({ kind: 'PERSONAL' })] });
    expect(v.total).toMatchObject({ currencies: [], converted: '0.00', inCurrencyOnly: null });
  });
});

describe('composeVerdict: review fixes (qa-reconcile 2026-10-26)', () => {
  // A row written while a Gulf currency was supported (MUT-388 retired them; formatMoney still displays them).
  const retired = (code: string, received: string, spent: string): CurrencyActivity => ({ ...block('ILS', received, spent), currency: code as Currency });

  it('leaves retired-currency rows out of every figure and lists them per profile (#1)', () => {
    const p = profile({
      kind: 'BUSINESS',
      activity: activity([block('ILS', '100.00', '0.00'), retired('AED', '50.00', '0.00')], { '2026-09': [retired('BHD', '1.000', '0.000')] }),
      owed: { currencies: [{ currency: 'SAR' as Currency, outstanding: '9.00', overdue: '0.00' }], overdueCount: 1 },
    });
    const v = composeVerdict({ ...OCT, base: 'ILS', rates: rates(), profiles: [p] });
    expect(v.profiles[0]).toMatchObject({ currencies: [{ currency: 'ILS', net: '100.00' }], omittedCurrencies: ['AED', 'BHD', 'SAR'] });
    expect(v.profiles[0]!.history.find((h) => h.month === '2026-09')!.currencies).toEqual([]);
    expect(v.total).toMatchObject({ currencies: [{ currency: 'ILS', net: '100.00' }], converted: '100.00' });
    expect(v.owed.currencies).toEqual([]);
  });

  it('keeps only monthly in and out in the history it returns (#10)', () => {
    const v = composeVerdict({ ...OCT, base: 'ILS', rates: rates(), profiles: [profile({ kind: 'BUSINESS', activity: activity([], { '2026-09': [block('ILS', '5.00', '1.00')] }) })] });
    expect(v.profiles[0]!.history.find((h) => h.month === '2026-09')!.currencies).toEqual([{ currency: 'ILS', received: '5.00', spent: '1.00' }]);
  });

  it('marks a partial answer and withholds usual, keeping the label of the profiles held (#4)', () => {
    const business = profile({ kind: 'BUSINESS', earlierData: true, activity: activity([block('ILS', '10.00', '0.00')]) });
    const v = composeVerdict({ ...OCT, base: 'ILS', rates: rates(), profiles: [business], partial: true, heldKinds: ['BUSINESS', 'PERSONAL'] });
    expect(v.total).toMatchObject({ label: 'kept', partial: true });
    expect(v.usual).toBeNull();
    expect(composeVerdict({ ...OCT, base: 'ILS', rates: rates(), profiles: [business] }).total.partial).toBe(false);
  });

  it('does not let a profile with no records hide usual, and has no usual when nobody has records (#3)', () => {
    const months = Object.fromEntries(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'].map((m) => [m, [block('ILS', '9.00', '0.00')]]));
    const business = profile({ kind: 'BUSINESS', earlierData: true, activity: activity([], months) });
    const empty = profile({ kind: 'BUSINESS', activity: activity([], {}, null) });
    expect(composeVerdict({ ...OCT, base: 'ILS', rates: rates(), profiles: [business, empty] }).usual).toBe('9.00');
    expect(composeVerdict({ ...OCT, base: 'ILS', rates: rates(), profiles: [empty] }).usual).toBeNull();
  });

  it('rounds an even median half away from zero, in integers (#7)', () => {
    const months = { '2026-04': '-0.01', '2026-05': '-0.02', '2026-06': '-0.01', '2026-07': '-0.02', '2026-08': '-0.01', '2026-09': '-0.02' };
    const p = profile({ kind: 'PERSONAL', earlierData: true, activity: activity([], Object.fromEntries(Object.entries(months).map(([m, v]) => [m, [block('ILS', '0.00', v.slice(1))]]))) });
    expect(composeVerdict({ ...OCT, base: 'ILS', rates: rates(), profiles: [p] }).usual).toBe('-0.02');
  });
});

describe('convertToBase', () => {
  it('converts through the rate set, rounding once at the end', () => {
    expect(convertToBase([{ currency: 'USD', minor: 1n }, { currency: 'USD', minor: 1n }], rates(), 'ILS')).toBe(7n);
    expect(convertToBase([{ currency: 'JOD', minor: 1000n }], rates(), 'ILS')).toBe(522n);
  });

  it('needs no rates when everything is already the base currency, and refuses a missing rate', () => {
    expect(convertToBase([{ currency: 'ILS', minor: 123n }], null, 'ILS')).toBe(123n);
    expect(convertToBase([{ currency: 'USD', minor: 1n }], null, 'ILS')).toBeNull();
    expect(convertToBase([{ currency: 'USD', minor: 1n }], rates().filter((r) => r.currency !== 'USD'), 'ILS')).toBeNull();
  });
});

describe('baseProfileOf (R4)', () => {
  it('picks the oldest personal profile, else the oldest profile', () => {
    const business = profile({ kind: 'BUSINESS', createdAt: new Date('2024-01-01'), defaultCurrency: 'USD' });
    const newer = profile({ kind: 'PERSONAL', createdAt: new Date('2026-01-01'), defaultCurrency: 'JOD' });
    const older = profile({ kind: 'PERSONAL', createdAt: new Date('2025-01-01'), defaultCurrency: 'ILS' });
    expect(baseProfileOf([business, newer, older])).toBe(older);
    expect(baseProfileOf([newer, business].filter((p) => p.kind !== 'PERSONAL'))).toBe(business);
    expect(baseProfileOf([])).toBeNull();
  });
});

describe('usual (R8, D9, D11)', () => {
  const keptMonths = (values: Record<string, string>) => Object.fromEntries(Object.entries(values).map(([m, net]) => [m, [block('ILS', net, '0.00')]]));

  it('is the median of complete months before the period, a calendar month only', () => {
    const odd = profile({ kind: 'BUSINESS', activity: activity([], keptMonths({ '2026-05': '100.00', '2026-06': '300.00', '2026-07': '200.00', '2026-08': '500.00', '2026-09': '400.00' }), '2026-05-01') });
    expect(composeVerdict({ ...OCT, base: 'ILS', rates: rates(), profiles: [odd] }).usual).toBe('300.00');
    const even = profile({ kind: 'BUSINESS', earlierData: true, activity: activity([], keptMonths({ '2026-04': '100.00', '2026-05': '200.00', '2026-06': '300.00', '2026-07': '400.00', '2026-08': '500.00', '2026-09': '600.00' })) });
    expect(composeVerdict({ ...OCT, base: 'ILS', rates: rates(), profiles: [even] }).usual).toBe('350.00');
    expect(composeVerdict({ from: '2026-10-05', to: '2026-10-11', base: 'ILS', rates: rates(), profiles: [even] }).usual).toBeNull();
    expect(composeVerdict({ from: '2026-01-01', to: '2026-12-31', base: 'ILS', rates: rates(), profiles: [even] }).usual).toBeNull();
    expect(composeVerdict({ from: '2026-10-01', to: '2026-10-30', base: 'ILS', rates: rates(), profiles: [even] }).usual).toBeNull();
  });

  it('needs 3 complete months; a month whose records began after the 7th does not count', () => {
    const twoMonths = profile({ kind: 'BUSINESS', activity: activity([], keptMonths({ '2026-08': '1.00', '2026-09': '1.00' }), '2026-08-01') });
    expect(composeVerdict({ ...OCT, base: 'ILS', rates: rates(), profiles: [twoMonths] }).usual).toBeNull();
    const lateStart = profile({ kind: 'BUSINESS', activity: activity([], keptMonths({ '2026-07': '9.00', '2026-08': '1.00', '2026-09': '1.00' }), '2026-07-08') });
    expect(composeVerdict({ ...OCT, base: 'ILS', rates: rates(), profiles: [lateStart] }).usual).toBeNull();
  });

  it('earlier data makes quiet months count (D9)', () => {
    const quiet = profile({ kind: 'BUSINESS', earlierData: true, activity: activity([], keptMonths({ '2026-09': '600.00' }), '2026-09-15') });
    expect(composeVerdict({ ...OCT, base: 'ILS', rates: rates(), profiles: [quiet] }).usual).toBe('0.00');
  });

  it('counts a month only when every profile was complete in it (D11)', () => {
    const business = profile({ kind: 'BUSINESS', earlierData: true, activity: activity([], keptMonths({ '2026-04': '9.00', '2026-05': '9.00', '2026-06': '9.00', '2026-07': '9.00', '2026-08': '9.00', '2026-09': '9.00' })) });
    const newPersonal = profile({ kind: 'PERSONAL', activity: activity([], {}, '2026-09-01') });
    expect(composeVerdict({ ...OCT, base: 'ILS', rates: rates(), profiles: [business, newPersonal] }).usual).toBeNull();
    const settled = profile({ kind: 'PERSONAL', activity: activity([], {}, '2026-07-01') });
    expect(composeVerdict({ ...OCT, base: 'ILS', rates: rates(), profiles: [business, settled] }).usual).toBe('9.00');
  });

  it('is null when months need a rate that is missing', () => {
    const usd = profile({ kind: 'BUSINESS', earlierData: true, activity: activity([], Object.fromEntries(MONTHS.map((m) => [m, [block('USD', '1.00', '0.00')]]))) });
    expect(composeVerdict({ ...OCT, base: 'ILS', rates: null, profiles: [usd] }).usual).toBeNull();
  });
});

describe('owedOf', () => {
  const today = '2026-10-26';
  const rec = (over: Partial<ReceivableRecord>): ReceivableRecord =>
    ({ status: 'OPEN', origin: 'MANUAL', currency: 'ILS', grossMinor: 10000n, paidMinor: 0n, creditedMinor: 0n, postingDate: '2026-10-01', dueDate: '2026-10-30', ...over }) as ReceivableRecord;

  it('is the open balance per currency with an overdue count; settled and not-yet-counting entries add nothing', () => {
    const owed = owedOf(
      [
        rec({ dueDate: '2026-10-01' }),
        rec({ dueDate: '2026-10-02', paidMinor: 2500n }),
        rec({ currency: 'USD', grossMinor: 500n }),
        rec({ status: 'SETTLED', paidMinor: 10000n }),
        rec({ origin: 'ADJUSTMENT', postingDate: '2026-11-15', dueDate: '2026-11-15' }),
      ],
      today,
    );
    expect(owed).toEqual({
      currencies: [
        { currency: 'ILS', outstanding: '175.00', overdue: '175.00' },
        { currency: 'USD', outstanding: '5.00', overdue: '0.00' },
      ],
      overdueCount: 2,
    });
  });

  it('re-review: an overdue entry in a retired currency is returned but not counted, since its amount is left out', () => {
    const owed = owedOf([rec({ currency: 'AED', dueDate: '2026-10-01' }), rec({ dueDate: '2026-10-01' })], today);
    expect(owed.currencies.map((c) => c.currency)).toEqual(['AED', 'ILS']);
    expect(owed.overdueCount).toBe(1);
  });

  it('combines across profiles and converts', () => {
    const v = composeVerdict({
      ...OCT,
      base: 'ILS',
      rates: rates(),
      profiles: [
        profile({ kind: 'BUSINESS', owed: { currencies: [{ currency: 'USD', outstanding: '100.00', overdue: '100.00' }], overdueCount: 1 } }),
        profile({ kind: 'FIRM', owed: { currencies: [{ currency: 'ILS', outstanding: '30.00', overdue: '0.00' }], overdueCount: 0 } }),
      ],
    });
    expect(v.owed).toEqual({
      currencies: [
        { currency: 'ILS', outstanding: '30.00', overdue: '0.00' },
        { currency: 'USD', outstanding: '100.00', overdue: '100.00' },
      ],
      converted: '400.00',
      overdueCount: 1,
    });
  });
});
