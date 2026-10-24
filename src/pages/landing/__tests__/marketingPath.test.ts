import { describe, it, expect } from 'vitest';
import { landingRoute, marketingPath } from '../marketingPath';

describe('marketingPath', () => {
  it.each([
    ['/hosted/', '/hosted'],
    ['/privacy/', '/privacy'],
    ['/download/', '/download'],
    ['/hosted', '/hosted'],
    ['/', '/'],
    ['/app/clients/', '/app/clients'],
  ])('reads %s as %s, so a pasted or shortened link with a trailing slash still opens the page', (pathname, expected) => {
    expect(marketingPath(pathname)).toBe(expected);
  });

  it.each(['/hosted-offer.html', '/hosted-offer', '/hosted-offer/'])('reads the page copy\'s own address %s as /hosted', (pathname) => {
    expect(marketingPath(pathname)).toBe('/hosted');
  });

  it('strips only one slash: anything stranger is not a marketing page', () => {
    expect(marketingPath('/hosted//')).toBe('/hosted/');
  });
});

describe('landingRoute (MUT-150 eng D7)', () => {
  it.each([
    ['/', '/'],
    ['/download', '/download'],
    ['/download/', '/download'],
    ['/privacy', '/privacy'],
    ['/terms', '/terms'],
    ['/terms/', '/terms'],
    ['/terms/2026-10-20', '/terms/:version'],
  ] as const)('names %s as the landing page %s, a template that never carries the version', (pathname, expected) => {
    expect(landingRoute(pathname)).toBe(expected);
  });

  it.each(['/app', '/app/', '/app/clients', '/hosted', '/hosted-offer.html', '/download/mac', '/privacyx', '/termsx', '/unknown', '/hosted//'])(
    'is null for %s: not a page the website renders, so nothing there may report',
    (pathname) => {
      expect(landingRoute(pathname)).toBeNull();
    },
  );
});
