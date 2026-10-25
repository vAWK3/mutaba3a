import { describe, expect, it } from 'vitest';
import { islandTarget, isYouPath, parseYouSearch, sectionOf, switchTarget, youPath } from '../youRoutes';

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
    // MUT-426 D8: Reports is per profile, so a switch from it keeps it
    [`/p/${P}/reports`, 'reports'],
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
    expect(parseYouSearch({ from: 'reports' })).toEqual({ from: 'reports' });
    expect(parseYouSearch({ from: 'you' })).toEqual({});
    expect(parseYouSearch({ from: 'bogus' })).toEqual({});
    expect(parseYouSearch({ from: 3 })).toEqual({});
    expect(parseYouSearch({})).toEqual({});
  });

  it('switches to the kept section, or the profile home without one', () => {
    expect(switchTarget('B', 'payments')).toBe('/p/B/payments');
    expect(switchTarget('B', undefined)).toBe('/p/B');
    expect(switchTarget('B', 'reports')).toBe('/p/B/reports');
  });

  /** MUT-426 D7: the island's second press returns to the exact page, path only, never out of the profile. */
  describe('back', () => {
    it.each([
      `/p/${P}`,
      `/p/${P}/clients/c-1`,
      `/p/${P}/expenses/groups/g1`,
      `/p/${P}/reports`,
      `/p/${P}/receivables`,
    ])('keeps a path inside a profile (%s)', (back) => {
      expect(parseYouSearch({ back })).toEqual({ back });
    });

    it.each([
      ['the You page', `/p/${P}/you`],
      ['the profile-less You page', '/you'],
      ['an unknown section', `/p/${P}/nonsense`],
      ['an absolute URL', 'https://evil.example/p/x'],
      ['a protocol-relative URL', '//evil.example/p/x'],
      ['a query string', `/p/${P}/clients?status=late`],
      ['a hash', `/p/${P}/clients#top`],
      ['a dot segment', `/p/${P}/clients/../../x`],
      ['a backslash', `/p/${P}/clients\\evil`],
      ['a non-string', 42],
    ])('drops %s', (_name, back) => {
      expect(parseYouSearch({ back })).toEqual({});
    });

    it('keeps from and back side by side', () => {
      expect(parseYouSearch({ from: 'clients', back: `/p/${P}/clients/c-1` })).toEqual({ from: 'clients', back: `/p/${P}/clients/c-1` });
    });

    it('returns to back in the same profile, else the kept section, else home', () => {
      expect(islandTarget(P, { from: 'clients', back: `/p/${P}/clients/c-1` })).toBe(`/p/${P}/clients/c-1`);
      expect(islandTarget(P, { from: 'clients', back: '/p/other-profile/clients/c-1' })).toBe(`/p/${P}/clients`);
      expect(islandTarget(P, { from: 'payments' })).toBe(`/p/${P}/payments`);
      expect(islandTarget(P, {})).toBe(`/p/${P}`);
    });

    it('returns home with no profile', () => {
      expect(islandTarget(null, { from: 'clients', back: `/p/${P}/clients` })).toBe('/');
    });
  });
});
