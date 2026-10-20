import { describe, it, expect } from 'vitest';
import { legalLanguageOf } from '../language';

/** MUT-324 / MUT-356: the `?lang` a link to /terms or /privacy names, for the text only. */
describe('legalLanguageOf', () => {
  it.each(['en', 'ar'] as const)('reads ?lang=%s', (lang) => {
    expect(legalLanguageOf(`?lang=${lang}`)).toBe(lang);
  });

  it('finds it among other parameters', () => {
    expect(legalLanguageOf('?utm_source=app&lang=ar')).toBe('ar');
  });

  it.each(['', '?', '?lang=', '?lang=fr', '?lang=EN', '?language=en'])('ignores %j', (search) => {
    expect(legalLanguageOf(search)).toBeNull();
  });
});
