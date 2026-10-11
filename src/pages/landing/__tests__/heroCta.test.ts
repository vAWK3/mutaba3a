import { describe, it, expect } from 'vitest';
import { chooseHeroCta, secondaryHeroLink } from '../heroCta';
import { SAMPLE_CLIENTS, sampleOwedTotals } from '../sampleData';

describe('chooseHeroCta', () => {
  it('offers the Mac download to a Mac', () => {
    expect(chooseHeroCta('mac', true)).toBe('mac');
  });

  it('offers the Windows download to Windows only when the release has one', () => {
    expect(chooseHeroCta('windows', true)).toBe('windows');
    expect(chooseHeroCta('windows', false)).toBe('web');
  });

  it.each(['ios', 'android', 'linux', 'unknown'] as const)('offers the web app to %s', (device) => {
    expect(chooseHeroCta(device, true)).toBe('web');
  });
});

describe('secondaryHeroLink', () => {
  it('points a download visitor to the browser', () => {
    expect(secondaryHeroLink('mac')).toBe('web');
    expect(secondaryHeroLink('windows')).toBe('web');
  });

  it('points a web visitor to the desktop apps', () => {
    expect(secondaryHeroLink('web')).toBe('desktop');
  });
});

describe('sample Clients list', () => {
  it('adds up: the Owed now strip is the sum of the rows, per currency', () => {
    const totals = sampleOwedTotals(SAMPLE_CLIENTS);
    for (const total of totals) {
      const owed = SAMPLE_CLIENTS.flatMap((c) => c.owed)
        .filter((o) => o.currency === total.currency)
        .reduce((sum, o) => sum + o.owedMinor, 0);
      const overdue = SAMPLE_CLIENTS.flatMap((c) => c.owed)
        .filter((o) => o.currency === total.currency)
        .reduce((sum, o) => sum + o.overdueMinor, 0);
      expect(total.owedMinor).toBe(owed);
      expect(total.overdueMinor).toBe(overdue);
    }
    expect(totals.map((t) => t.currency)).toEqual(['USD', 'ILS']);
  });

  it('is ranked by what each client owes, most first', () => {
    const ils = SAMPLE_CLIENTS.map((c) => c.owed.find((o) => o.currency === 'ILS')?.owedMinor ?? 0);
    expect([...ils].sort((a, b) => b - a)).toEqual(ils);
  });
});
