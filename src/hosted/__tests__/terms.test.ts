import { afterEach, describe, it, expect, vi } from 'vitest';
import { termsHref } from '../terms';

const TERMS_URL = 'https://mutaba3a.example/terms';

afterEach(() => vi.unstubAllGlobals());

/**
 * MUT-324 review fix 1: the landing opens in its own stored language, so the link
 * names the portal's language. What a person reads is what their acceptance records.
 */
describe('termsHref (MUT-324)', () => {
  it('links a version in the language the portal records', () => {
    vi.stubGlobal('__TERMS_URL__', TERMS_URL);
    expect(termsHref('en', '2026-10-19')).toBe(`${TERMS_URL}/2026-10-19?lang=en`);
    expect(termsHref('ar', '2026-10-19')).toBe(`${TERMS_URL}/2026-10-19?lang=ar`);
  });

  it('links the latest terms in that language when no version is named', () => {
    vi.stubGlobal('__TERMS_URL__', TERMS_URL);
    expect(termsHref('ar')).toBe(`${TERMS_URL}?lang=ar`);
  });

  it('links nowhere when the build has no terms address', () => {
    expect(termsHref('en', '2026-10-19')).toBe('');
  });
});
