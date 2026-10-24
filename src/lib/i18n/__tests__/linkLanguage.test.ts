import { describe, expect, it, vi } from 'vitest';
import { linkedLanguageOf, takeLinkedLanguage } from '../linkLanguage';

describe('linkedLanguageOf (MUT-356, MUT-369)', () => {
  it('reads ?lang=en|ar and ignores anything else', () => {
    expect(linkedLanguageOf('?lang=en')).toBe('en');
    expect(linkedLanguageOf('?x=1&lang=ar')).toBe('ar');
    expect(linkedLanguageOf('?lang=fr')).toBeNull();
    expect(linkedLanguageOf('')).toBeNull();
  });
});

describe('takeLinkedLanguage (MUT-369, D5/D15)', () => {
  const at = (href: string) => {
    const url = new URL(href);
    const replaceState = vi.fn();
    return { location: { pathname: url.pathname, search: url.search, hash: url.hash }, history: { state: { k: 1 }, replaceState }, replaceState };
  };

  it('returns the link language and removes only ?lang from the address, so a reload keeps the person’s own switch', () => {
    const { location, history, replaceState } = at('https://portal.example/signup?lang=en&x=1#frag');
    expect(takeLinkedLanguage(location, history)).toBe('en');
    expect(replaceState).toHaveBeenCalledWith({ k: 1 }, '', '/signup?x=1#frag');
  });

  it('leaves the address alone when there is no ?lang', () => {
    const { location, history, replaceState } = at('https://portal.example/signup?x=1');
    expect(takeLinkedLanguage(location, history)).toBeNull();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('removes an unknown ?lang too, but names no language', () => {
    const { location, history, replaceState } = at('https://portal.example/signup?lang=fr');
    expect(takeLinkedLanguage(location, history)).toBeNull();
    expect(replaceState).toHaveBeenCalledWith({ k: 1 }, '', '/signup');
  });
});
