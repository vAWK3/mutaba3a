import { describe, expect, it } from 'vitest';
import { formatSigned } from '../reportFormat';

/** MUT-448: a Glance business line carries its sign; zero carries none, and a loss uses U+2212. */

describe('formatSigned', () => {
  it('signs gains and losses in whole units', () => {
    expect(formatSigned(904000, 'ILS', 'en')).toBe('+₪9,040');
    expect(formatSigned(-310050, 'ILS', 'en')).toBe('−₪3,101');
    expect(formatSigned(0, 'ILS', 'en')).toBe('₪0');
  });

  it('never shows a sign for an amount that rounds to zero', () => {
    expect(formatSigned(-40, 'ILS', 'en')).toBe('₪0');
  });

  it('keeps the sign in Arabic', () => {
    expect(formatSigned(-310000, 'ILS', 'ar')).toContain('−');
    expect(formatSigned(310000, 'ILS', 'ar')).toContain('+');
  });
});
