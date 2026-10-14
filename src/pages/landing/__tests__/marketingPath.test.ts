import { describe, it, expect } from 'vitest';
import { marketingPath } from '../marketingPath';

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

  it('strips only one slash: anything stranger is not a marketing page', () => {
    expect(marketingPath('/hosted//')).toBe('/hosted/');
  });
});
