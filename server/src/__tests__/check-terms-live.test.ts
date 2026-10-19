import { describe, expect, it } from 'vitest';
import { termsLiveProblem } from '../scripts/check-terms-live.js';
import type { CurrentTerms } from '../legal.js';

/** MUT-324 (D11): the release refuses a terms version the public site does not list with the same text. */
const TERMS: CurrentTerms = { version: '2026-10-19', sha256: { en: 'e'.repeat(64), ar: 'a'.repeat(64) } };
const listed = (sha256 = TERMS.sha256) => ({ versions: [{ version: '2026-10-19', sha256 }] });

describe('termsLiveProblem', () => {
  it('passes when the site lists the version with the same fingerprints', () => {
    expect(termsLiveProblem(listed(), TERMS)).toBeNull();
  });

  it('refuses a version the site does not list yet (release web first)', () => {
    expect(termsLiveProblem({ versions: [] }, TERMS)).toMatch(/2026-10-19 is not live/);
  });

  it('refuses a version whose live text differs from the one this release fingerprints', () => {
    expect(termsLiveProblem(listed({ en: 'e'.repeat(64), ar: 'b'.repeat(64) }), TERMS)).toMatch(/ar text differs/);
  });

  it('refuses an answer that is not the manifest', () => {
    expect(termsLiveProblem('<html>', TERMS)).toMatch(/not a terms manifest/);
  });
});
