import { describe, it, expect } from 'vitest';
import {
  groupOccurrencesByRule,
  currencyTotals,
  formatMonthList,
  formatMonthYear,
  formatDateOnly,
  snoozeDateAfter,
} from '../recurringAttention';
import type { VirtualOccurrenceDisplay } from '../../../types';

function occurrence(overrides: Partial<VirtualOccurrenceDisplay> = {}): VirtualOccurrenceDisplay {
  const amountMinor = overrides.amountMinor ?? 8000;
  const currency = overrides.currency ?? 'USD';
  return {
    ruleId: 'rule-hosting',
    profileId: 'profile-1',
    expectedDate: '2026-08-05',
    amountMinor,
    currency,
    computedState: 'overdue',
    ruleTitle: 'Server hosting',
    frequency: 'monthly',
    daysUntilDue: -68,
    isOverdue: true,
    isUpcoming: false,
    effectiveAmount: amountMinor,
    effectiveCurrency: currency,
    ...overrides,
  };
}

const AUG = occurrence({ expectedDate: '2026-08-05', daysUntilDue: -68 });
const SEP = occurrence({ expectedDate: '2026-09-05', daysUntilDue: -37 });
const OCT = occurrence({ expectedDate: '2026-10-05', daysUntilDue: -7 });

describe('groupOccurrencesByRule', () => {
  it('turns one missed payment into one group (T1)', () => {
    const groups = groupOccurrencesByRule([OCT]);

    expect(groups).toHaveLength(1);
    expect(groups[0].occurrences.map((o) => o.expectedDate)).toEqual(['2026-10-05']);
    expect(groups[0].totalMinor).toBe(8000);
  });

  it('puts every missed payment of a rule in one group, oldest first (T2)', () => {
    const groups = groupOccurrencesByRule([OCT, AUG, SEP]);

    expect(groups).toHaveLength(1);
    expect(groups[0].occurrences.map((o) => o.expectedDate)).toEqual([
      '2026-08-05',
      '2026-09-05',
      '2026-10-05',
    ]);
    expect(groups[0].totalMinor).toBe(24000);
  });

  it('orders rules by their oldest payment, then title, then id, and keeps rules apart (T3)', () => {
    const rent = occurrence({ ruleId: 'rule-rent', ruleTitle: 'Rent', expectedDate: '2026-09-01', amountMinor: 350000, currency: 'ILS' });
    const adobe = occurrence({ ruleId: 'rule-adobe', ruleTitle: 'Adobe', expectedDate: '2026-09-01', amountMinor: 2000 });
    const zoomB = occurrence({ ruleId: 'rule-zoom-b', ruleTitle: 'Zoom', expectedDate: '2026-10-01' });
    const zoomA = occurrence({ ruleId: 'rule-zoom-a', ruleTitle: 'Zoom', expectedDate: '2026-10-01' });

    const groups = groupOccurrencesByRule([zoomB, rent, OCT, adobe, zoomA, AUG]);

    expect(groups.map((g) => g.ruleId)).toEqual([
      'rule-hosting', // Aug 5
      'rule-adobe', // Sep 1, "Adobe" before "Rent"
      'rule-rent',
      'rule-zoom-a', // same date and title: by id
      'rule-zoom-b',
    ]);
    expect(groups[0].occurrences.map((o) => o.expectedDate)).toEqual(['2026-08-05', '2026-10-05']);
    expect(groups[2].totalMinor).toBe(350000);
    expect(groups[2].currency).toBe('ILS');
  });

  it('carries what the row says about the rule (T4)', () => {
    const yearly = occurrence({
      ruleId: 'rule-domain',
      ruleTitle: 'Domain',
      frequency: 'yearly',
      currency: 'EUR',
      amountMinor: 1500,
    });

    const [group] = groupOccurrencesByRule([yearly]);

    expect(group).toMatchObject({
      ruleId: 'rule-domain',
      profileId: 'profile-1',
      title: 'Domain',
      frequency: 'yearly',
      currency: 'EUR',
      periodAmountMinor: 1500,
      totalMinor: 1500,
    });
  });

  it('takes the per-period amount from the newest payment and sums the effective amounts', () => {
    const edited = occurrence({ expectedDate: '2026-08-05', amountMinor: 9000, effectiveAmount: 9000 });

    const [group] = groupOccurrencesByRule([edited, SEP]);

    expect(group.periodAmountMinor).toBe(8000);
    expect(group.totalMinor).toBe(17000);
  });

  it('returns no groups for no payments (T5)', () => {
    expect(groupOccurrencesByRule([])).toEqual([]);
  });
});

describe('currencyTotals', () => {
  it('adds within a currency only, drops zero and keeps USD, ILS, EUR order (T6)', () => {
    const groups = groupOccurrencesByRule([
      occurrence({ ruleId: 'eur', ruleTitle: 'EU tool', currency: 'EUR', amountMinor: 1500 }),
      occurrence({ ruleId: 'ils', ruleTitle: 'Rent', currency: 'ILS', amountMinor: 350000 }),
      AUG,
      SEP,
      occurrence({ ruleId: 'free', ruleTitle: 'Free plan', currency: 'ILS', amountMinor: 0 }),
    ]);

    expect(currencyTotals(groups)).toEqual([
      { currency: 'USD', amountMinor: 16000 },
      { currency: 'ILS', amountMinor: 350000 },
      { currency: 'EUR', amountMinor: 1500 },
    ]);
  });

  it('is empty for no groups (T5)', () => {
    expect(currencyTotals([])).toEqual([]);
  });
});

describe('month and date labels (T7)', () => {
  it('lists the months in English', () => {
    expect(formatMonthList(['2026-08-05', '2026-09-05', '2026-10-05'], 'en-US')).toBe('Aug, Sep, Oct');
  });

  it('names one month on its own', () => {
    expect(formatMonthList(['2026-10-05'], 'en-US')).toBe('Oct');
  });

  it('lists the months in Arabic', () => {
    const list = formatMonthList(['2026-08-05', '2026-09-05'], 'ar');

    expect(list).toContain('أغسطس');
    expect(list).toContain('سبتمبر');
  });

  it('adds the year only when the payments span two years', () => {
    expect(formatMonthList(['2025-12-05', '2026-01-05'], 'en-US')).toBe('Dec 2025, Jan 2026');
  });

  it('reads a date-only value as a local calendar date (the first of a month stays in its month)', () => {
    // new Date('2026-09-01') is UTC midnight: west of UTC that is still August.
    expect(formatMonthList(['2026-09-01'], 'en-US')).toBe('Sep');
    expect(formatMonthYear('2026-09-01', 'en-US')).toBe('September 2026');
    expect(formatDateOnly('2026-09-01', 'en-US')).toBe('Sep 1, 2026');
  });
});

describe('snoozeDateAfter (T8)', () => {
  it('adds calendar days', () => {
    expect(snoozeDateAfter('2026-10-12', 7)).toBe('2026-10-19');
  });

  it('crosses a month end and a year end', () => {
    expect(snoozeDateAfter('2026-10-28', 7)).toBe('2026-11-04');
    expect(snoozeDateAfter('2026-12-20', 30)).toBe('2027-01-19');
  });
});
