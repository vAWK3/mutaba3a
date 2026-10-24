import { describe, expect, it } from 'vitest';
import { isYouPath, parseYouSearch, sectionOf, switchTarget, youPath } from '../youRoutes';

const P = '11111111-1111-4111-8111-111111111111';

/** MUT-425: the You page's paths, and the section a profile switch keeps (eng review D3/D4/D8). */
describe('youRoutes', () => {
  it.each([
    [`/p/${P}`, undefined],
    [`/p/${P}/`, undefined],
    [`/p/${P}/payments`, 'payments'],
    [`/p/${P}/clients/abc`, 'clients'],
    [`/p/${P}/expenses/groups/g1`, 'expenses'],
    [`/p/${P}/conversions`, 'conversions'],
    [`/p/${P}/you`, undefined],
    [`/p/${P}/you/account`, undefined],
    ['/you/app', undefined],
    [`/p/${P}/nonsense`, undefined],
  ])('sectionOf(%s) is %s', (path, section) => {
    expect(sectionOf(path)).toBe(section);
  });

  it('builds each part with and without a profile', () => {
    expect(youPath(P, 'profiles')).toBe(`/p/${P}/you`);
    expect(youPath(P, 'account')).toBe(`/p/${P}/you/account`);
    expect(youPath(null, 'app')).toBe('/you/app');
    expect(youPath(null, 'profiles')).toBe('/you');
  });

  it.each([
    [`/p/${P}/you`, true],
    [`/p/${P}/you/account`, true],
    ['/you', true],
    ['/you/app', true],
    [`/p/${P}/payments`, false],
    [`/p/${P}/youth`, false],
  ])('isYouPath(%s) is %s', (path, expected) => {
    expect(isYouPath(path)).toBe(expected);
  });

  it('keeps a known from and drops anything else', () => {
    expect(parseYouSearch({ from: 'payments' })).toEqual({ from: 'payments' });
    expect(parseYouSearch({ from: 'you' })).toEqual({});
    expect(parseYouSearch({ from: 'bogus' })).toEqual({});
    expect(parseYouSearch({ from: 3 })).toEqual({});
    expect(parseYouSearch({})).toEqual({});
  });

  it('switches to the kept section, or the profile home without one', () => {
    expect(switchTarget('B', 'payments')).toBe('/p/B/payments');
    expect(switchTarget('B', undefined)).toBe('/p/B');
  });
});
