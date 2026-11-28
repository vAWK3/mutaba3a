import { describe, expect, it } from 'vitest';
import { IL_PACK } from '../index.js';
import { defaultVatPeriodKind, effectiveVatPeriodKind, latestEndedVatPeriod, vatFilingDueDate, vatPeriodFromKey, VAT_PERIOD_KINDS } from '../vat-periods.js';

/** MUT-782: the periods a client files VAT for, by the day (pure: no clock, no store). */

describe('defaultVatPeriodKind (Basel, 2026-11-28)', () => {
  it.each([
    ['LICENSED', 'BIMONTHLY'],
    ['EXEMPT', 'YEARLY'],
    ['COMPANY', 'MONTHLY'],
    ['NONPROFIT', 'NONE'],
  ] as const)('%s is %s', (dealer, kind) => {
    expect(defaultVatPeriodKind(dealer)).toBe(kind);
  });
});

describe('effectiveVatPeriodKind', () => {
  it('an accountant\'s choice wins over the dealer default', () => {
    expect(effectiveVatPeriodKind('MONTHLY', 'LICENSED')).toBe('MONTHLY');
    expect(effectiveVatPeriodKind('NONE', 'COMPANY')).toBe('NONE');
  });
  it('follows the dealer type when nothing was chosen', () => {
    expect(effectiveVatPeriodKind(null, 'COMPANY')).toBe('MONTHLY');
  });
  it('is NONE when nothing was chosen and the profile has no dealer type', () => {
    expect(effectiveVatPeriodKind(null, null)).toBe('NONE');
  });
});

describe('latestEndedVatPeriod', () => {
  it('monthly: the month before today\'s', () => {
    expect(latestEndedVatPeriod('MONTHLY', '2026-11-28')).toMatchObject({ key: '2026-M10', startDate: '2026-10-01', endDate: '2026-10-31' });
  });
  it('monthly: January looks back to December of the year before', () => {
    expect(latestEndedVatPeriod('MONTHLY', '2027-01-05')).toMatchObject({ key: '2026-M12', endDate: '2026-12-31' });
  });
  it('bimonthly: a period that ended is announced from the next day, not before', () => {
    expect(latestEndedVatPeriod('BIMONTHLY', '2026-02-28')).toMatchObject({ key: '2025-B6' });
    expect(latestEndedVatPeriod('BIMONTHLY', '2026-03-01')).toMatchObject({ key: '2026-B1', startDate: '2026-01-01', endDate: '2026-02-28' });
  });
  it('bimonthly: mid-period still answers the last ended one', () => {
    expect(latestEndedVatPeriod('BIMONTHLY', '2026-04-15')).toMatchObject({ key: '2026-B1' });
    expect(latestEndedVatPeriod('BIMONTHLY', '2026-05-01')).toMatchObject({ key: '2026-B2', endDate: '2026-04-30' });
  });
  it('bimonthly: the Nov-Dec period ends on 31 December and carries into January and February', () => {
    expect(latestEndedVatPeriod('BIMONTHLY', '2027-01-01')).toMatchObject({ key: '2026-B6', startDate: '2026-11-01', endDate: '2026-12-31' });
    expect(latestEndedVatPeriod('BIMONTHLY', '2027-02-10')).toMatchObject({ key: '2026-B6' });
  });
  it('a leap February ends on the 29th', () => {
    expect(latestEndedVatPeriod('MONTHLY', '2028-03-01')).toMatchObject({ key: '2028-M2', endDate: '2028-02-29' });
  });
  it('yearly: the year before today\'s', () => {
    expect(latestEndedVatPeriod('YEARLY', '2027-01-01')).toMatchObject({ key: '2026-Y', startDate: '2026-01-01', endDate: '2026-12-31' });
    expect(latestEndedVatPeriod('YEARLY', '2026-12-31')).toMatchObject({ key: '2025-Y' });
  });
  it('NONE has no period', () => {
    expect(latestEndedVatPeriod('NONE', '2026-11-28')).toBeNull();
  });
});

describe('vatFilingDueDate', () => {
  it('monthly and bimonthly: the 15th of the month after the period', () => {
    expect(vatFilingDueDate(latestEndedVatPeriod('BIMONTHLY', '2026-03-01')!)).toBe('2026-03-15');
    expect(vatFilingDueDate(latestEndedVatPeriod('MONTHLY', '2027-01-05')!)).toBe('2027-01-15');
  });
  it('a period ending in December is due in January of the next year', () => {
    expect(vatFilingDueDate(latestEndedVatPeriod('BIMONTHLY', '2027-01-01')!)).toBe('2027-01-15');
  });
  it('yearly has no stated date until it is confirmed', () => {
    expect(vatFilingDueDate(latestEndedVatPeriod('YEARLY', '2027-01-01')!)).toBeNull();
  });
});

describe('vatPeriodFromKey', () => {
  it('reads back what latestEndedVatPeriod made', () => {
    for (const kind of VAT_PERIOD_KINDS.filter((k) => k !== 'NONE')) {
      const period = latestEndedVatPeriod(kind, '2026-11-28')!;
      expect(vatPeriodFromKey(period.key)).toEqual(period);
    }
  });
  it.each(['', '2026', '2026-M13', '2026-B7', '2026-X1', '26-M1', '2026-M0'])('refuses %j', (key) => {
    expect(vatPeriodFromKey(key)).toBeNull();
  });
});

describe('the Israel pack carries the rules', () => {
  it('exposes them under vat.periods', () => {
    expect(IL_PACK.vat.periods.defaultKind('LICENSED')).toBe('BIMONTHLY');
    expect(IL_PACK.vat.periods.latestEnded('MONTHLY', '2026-11-28')?.key).toBe('2026-M10');
  });
});
