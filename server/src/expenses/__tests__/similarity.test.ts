import { describe, expect, it } from 'vitest';
import { MATCH_DATE_WINDOW_DAYS, dateWindow, matchScore, rankMatches } from '../similarity.js';

/**
 * MUT-435 (AC2): the one "same purchase" rule — same currency, same amount, dated within ±3 days, a similar vendor
 * ranking higher. MUT-437 (statement ↔ receipt matching) reuses this module; it must not redefine the rule.
 */
const probe = { amountMinor: 4590n, currency: 'ILS', occurredOn: '2026-10-20', vendor: 'Carrefour' };
const candidate = (over: Partial<{ amountMinor: bigint; currency: string; occurredOn: string; vendor: string | null }> = {}) => ({
  amountMinor: 4590n,
  currency: 'ILS',
  occurredOn: '2026-10-20',
  vendor: 'Carrefour' as string | null,
  ...over,
});

describe('matchScore', () => {
  it('matches the same currency, amount, day and vendor, with every reason', () => {
    const m = matchScore(probe, candidate());
    expect(m.matches).toBe(true);
    expect(m.reasons).toEqual(['currency', 'amount', 'date', 'vendor']);
    expect(m.daysApart).toBe(0);
  });

  it('never matches another currency or another amount, however close', () => {
    expect(matchScore(probe, candidate({ currency: 'USD' })).matches).toBe(false);
    expect(matchScore(probe, candidate({ amountMinor: 4591n })).matches).toBe(false);
  });

  it(`matches up to ${MATCH_DATE_WINDOW_DAYS} days either side and not a day further`, () => {
    expect(matchScore(probe, candidate({ occurredOn: '2026-10-17' })).matches).toBe(true);
    expect(matchScore(probe, candidate({ occurredOn: '2026-10-23' })).matches).toBe(true);
    expect(matchScore(probe, candidate({ occurredOn: '2026-10-16' })).matches).toBe(false);
    expect(matchScore(probe, candidate({ occurredOn: '2026-10-24' })).matches).toBe(false);
  });

  it('counts days across a month and year boundary', () => {
    const m = matchScore({ ...probe, occurredOn: '2027-01-01' }, candidate({ occurredOn: '2026-12-30' }));
    expect(m).toMatchObject({ matches: true, daysApart: 2 });
  });

  it('still matches when either side has no vendor, without the vendor reason, ranked below a vendor match', () => {
    const noVendor = matchScore(probe, candidate({ vendor: null }));
    const probeOnly = matchScore({ ...probe, vendor: undefined }, candidate());
    expect(noVendor.matches).toBe(true);
    expect(noVendor.reasons).not.toContain('vendor');
    expect(probeOnly.matches).toBe(true);
    expect(noVendor.score).toBeLessThan(matchScore(probe, candidate()).score);
  });

  it('matches a differently written vendor (case, spacing, a suffix) and not an unrelated one', () => {
    expect(matchScore(probe, candidate({ vendor: '  CARREFOUR market ' })).reasons).toContain('vendor');
    const other = matchScore(probe, candidate({ vendor: 'Shufersal' }));
    expect(other.matches).toBe(true);
    expect(other.reasons).not.toContain('vendor');
  });

  it('compares Arabic and Hebrew vendor names as typed', () => {
    const ar = { ...probe, vendor: 'كارفور' };
    expect(matchScore(ar, candidate({ vendor: 'كارفور' })).reasons).toContain('vendor');
    expect(matchScore(ar, candidate({ vendor: 'Carrefour' })).reasons).not.toContain('vendor');
    expect(matchScore({ ...probe, vendor: 'שופרסל' }, candidate({ vendor: 'שופרסל דיל' })).reasons).toContain('vendor');
  });
});

describe('rankMatches', () => {
  it('keeps only matches, best first: vendor match, then the nearest date', () => {
    const ranked = rankMatches(probe, [
      { id: 'far', ...candidate({ occurredOn: '2026-10-23', vendor: null }) },
      { id: 'wrong-amount', ...candidate({ amountMinor: 100n }) },
      { id: 'near', ...candidate({ occurredOn: '2026-10-21', vendor: null }) },
      { id: 'vendor', ...candidate({ occurredOn: '2026-10-22' }) },
    ]);
    expect(ranked.map((r) => r.item.id)).toEqual(['vendor', 'near', 'far']);
  });
});

describe('dateWindow', () => {
  it('is the inclusive ±3-day range around a date', () => {
    expect(dateWindow('2026-03-01')).toEqual({ from: '2026-02-26', to: '2026-03-04' });
  });
});
