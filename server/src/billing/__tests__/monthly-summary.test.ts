import { describe, expect, it } from 'vitest';
import type { ProfileFigures } from '../../summaries/profile-figures.js';
import { choiceForSwitch, mailProfilesOf, monthEndedFor, profileBlockOf, summaryMonthOf, switchIsOn } from '../monthly-summary.js';

const figures = (over: Partial<ProfileFigures> = {}): ProfileFigures => ({
  today: '2026-12-01',
  earlierData: false,
  activity: { dataSince: null, buckets: [], currencies: [], history: [], daysToPaid: { overall: null, byCustomer: [], samples: [] } } as unknown as ProfileFigures['activity'],
  owed: { currencies: [], overdueCount: 0 },
  entriesInRange: true,
  ...over,
});
const flows = (rows: Array<[string, string]>) => rows.map(([currency, received]) => ({ currency, received, spent: '0.00', byCategory: [], byCustomer: [] })) as unknown as ProfileFigures['activity']['currencies'];
const month = summaryMonthOf(new Date('2026-12-01T12:00:00Z'));

describe('MUT-535: summaryMonthOf (D3)', () => {
  it('is the calendar month before the run, in Jerusalem', () => {
    expect(month).toEqual({ key: '2026-11', from: '2026-11-01', to: '2026-11-30' });
  });

  it('is Jerusalem’s month, not UTC’s: 23:30 UTC on 30 November is already 1 December there', () => {
    expect(summaryMonthOf(new Date('2026-11-30T23:30:00Z')).key).toBe('2026-11');
  });

  it('crosses the year', () => {
    expect(summaryMonthOf(new Date('2027-01-01T12:00:00Z'))).toEqual({ key: '2026-12', from: '2026-12-01', to: '2026-12-31' });
  });
});

describe('MUT-535: monthEndedFor (D3)', () => {
  it('is true once the profile’s own today is after the month', () => {
    expect(monthEndedFor('2026-12-01', month)).toBe(true);
  });

  it('is false for a profile west of UTC whose today is still the 30th', () => {
    expect(monthEndedFor('2026-11-30', month)).toBe(false);
  });
});

describe('MUT-535: profileBlockOf (D4, D10)', () => {
  it('lists what came in, what is owed and what is overdue, per currency sorted by code, never summed', () => {
    const block = profileBlockOf(
      { id: 'p1', name: 'Studio' },
      figures({
        activity: { currencies: flows([['USD', '900.00'], ['ILS', '12400.00']]) } as unknown as ProfileFigures['activity'],
        owed: { currencies: [{ currency: 'USD', outstanding: '450.00', overdue: '200.00' }, { currency: 'ILS', outstanding: '3200.00', overdue: '1100.00' }], overdueCount: 3 },
      }),
    );
    expect(block).toEqual({
      profileId: 'p1',
      name: 'Studio',
      cameIn: [{ currency: 'ILS', amount: '12400.00' }, { currency: 'USD', amount: '900.00' }],
      owed: [{ currency: 'ILS', amount: '3200.00' }, { currency: 'USD', amount: '450.00' }],
      overdue: [{ currency: 'ILS', amount: '1100.00' }, { currency: 'USD', amount: '200.00' }],
      overdueCount: 3,
    });
  });

  it('leaves out zero rows: a currency with nothing overdue is not listed under Overdue', () => {
    const block = profileBlockOf({ id: 'p1', name: 'Studio' }, figures({ owed: { currencies: [{ currency: 'ILS', outstanding: '300.00', overdue: '0.00' }], overdueCount: 0 } }));
    expect(block).toMatchObject({ cameIn: [], owed: [{ currency: 'ILS', amount: '300.00' }], overdue: [], overdueCount: 0 });
  });

  it('is null for a profile with no entries dated in the month, however much is owed (AC5)', () => {
    expect(profileBlockOf({ id: 'p1', name: 'Studio' }, figures({ entriesInRange: false, owed: { currencies: [{ currency: 'ILS', outstanding: '300.00', overdue: '300.00' }], overdueCount: 1 } }))).toBeNull();
  });

  it('is null when the month had entries but nothing to show (only expenses)', () => {
    expect(profileBlockOf({ id: 'p1', name: 'Personal' }, figures({ activity: { currencies: flows([['ILS', '0.00']]) } as unknown as ProfileFigures['activity'] }))).toBeNull();
  });

  it('leaves out a retired currency, as the Glance does (MUT-388)', () => {
    const block = profileBlockOf({ id: 'p1', name: 'Studio' }, figures({ activity: { currencies: flows([['ILS', '50.00'], ['KWD', '10.000']]) } as unknown as ProfileFigures['activity'] }));
    expect(block?.cameIn).toEqual([{ currency: 'ILS', amount: '50.00' }]);
  });
});

describe('MUT-535: the choice (D6, D7)', () => {
  const covered = { malafatCovered: true };
  const own = { malafatCovered: false };

  it('by default mails every profile Malafat doesn’t cover', () => {
    expect(mailProfilesOf(null, [own, covered])).toEqual([own]);
  });

  it('by default mails nothing to someone whose profiles Malafat covers', () => {
    expect(mailProfilesOf(null, [covered])).toEqual([]);
  });

  it('ON_ALL includes the covered profiles; OFF mails nothing', () => {
    expect(mailProfilesOf('ON_ALL', [own, covered])).toEqual([own, covered]);
    expect(mailProfilesOf('OFF', [own, covered])).toEqual([]);
  });

  it('shows the switch on exactly when a mail would go', () => {
    expect(switchIsOn(null, [own])).toBe(true);
    expect(switchIsOn(null, [covered])).toBe(false);
    expect(switchIsOn('ON_ALL', [covered])).toBe(true);
    expect(switchIsOn('OFF', [own])).toBe(false);
  });

  it('turning it on stores the default, or ON_ALL when the default would send nothing (R5)', () => {
    expect(choiceForSwitch(true, [own, covered])).toBeNull();
    expect(choiceForSwitch(true, [covered])).toBe('ON_ALL');
    expect(choiceForSwitch(true, [])).toBeNull();
    expect(choiceForSwitch(false, [own])).toBe('OFF');
  });
});
