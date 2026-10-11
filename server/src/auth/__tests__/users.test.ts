import { describe, expect, it } from 'vitest';
import { ARGON2_MINIMUMS, createArgon2Hasher, generateOneTimePassword, normalizeEmail } from '../users.js';

describe('normalizeEmail', () => {
  it('trims, lower-cases and applies NFKC', () => {
    expect(normalizeEmail('  Partner@Firm.PS \n')).toBe('partner@firm.ps');
    // U+FF45 FULLWIDTH LATIN SMALL LETTER E folds to "e" under NFKC.
    expect(normalizeEmail('nour@ｅxample.com')).toBe('nour@example.com');
  });

  it('is idempotent', () => {
    const once = normalizeEmail('  Ｓader@Firm.ps ');
    expect(normalizeEmail(once)).toBe(once);
  });
});

describe('generateOneTimePassword', () => {
  it('is 24 base64url characters', () => {
    expect(generateOneTimePassword()).toMatch(/^[A-Za-z0-9_-]{24}$/);
  });

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 1000 }, () => generateOneTimePassword()));
    expect(seen.size).toBe(1000);
  });
});

describe('createArgon2Hasher', () => {
  const hasher = createArgon2Hasher(ARGON2_MINIMUMS);

  it('produces an argon2id PHC string carrying the configured parameters', async () => {
    const hash = await hasher.hash('correct horse battery staple');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it('verifies the right password and refuses a wrong one', async () => {
    const hash = await hasher.hash('correct horse battery staple');
    expect(await hasher.verify(hash, 'correct horse battery staple')).toBe(true);
    expect(await hasher.verify(hash, 'correct horse battery stapler')).toBe(false);
  });

  it('salts: two hashes of the same password differ', async () => {
    const [a, b] = await Promise.all([hasher.hash('same'), hasher.hash('same')]);
    expect(a).not.toBe(b);
  });

  it('treats a malformed stored hash as a mismatch, not a crash', async () => {
    expect(await hasher.verify('not-a-phc-string', 'anything')).toBe(false);
  });
});
