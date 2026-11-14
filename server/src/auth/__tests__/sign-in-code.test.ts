import { describe, expect, it } from 'vitest';
import { generateSignInCode, isSignInCodeShape, mailsSignInCode, SIGN_IN_CODE_POLICY, signInCodeDigest } from '../sign-in-code.js';

/** MUT-618 (ADR-256): the code's pure rules. */
describe('sign-in code rules (MUT-618)', () => {
  it('six digits, ten minutes, five tries (Basel, 2026-11-14)', () => {
    expect(SIGN_IN_CODE_POLICY).toMatchObject({ digits: 6, validMinutes: 10, maxAttempts: 5 });
  });

  it('generates six zero-padded digits', () => {
    for (let i = 0; i < 500; i += 1) expect(generateSignInCode()).toMatch(/^\d{6}$/);
  });

  it('accepts exactly six digits', () => {
    expect(isSignInCodeShape('004817')).toBe(true);
    for (const bad of ['', '12345', '1234567', '12 456', '12a456', '١٢٣٤٥٦']) expect(isSignInCodeShape(bad)).toBe(false);
  });

  it('digests under the pepper, bound to the address', () => {
    const a = signInCodeDigest('pepper-a', 'rana@studio.ps', '123456');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain('123456');
    expect(signInCodeDigest('pepper-b', 'rana@studio.ps', '123456')).not.toBe(a);
    expect(signInCodeDigest('pepper-a', 'omar@studio.ps', '123456')).not.toBe(a);
    expect(signInCodeDigest('pepper-a', 'rana@studio.ps', '123456')).toBe(a);
  });

  describe('who gets the mail (D4)', () => {
    const now = new Date('2026-11-14T09:00:00Z');
    const person = { status: 'ACTIVE' as const, passwordHash: 'hash', passwordChosen: true, closure: null };
    it('an active account, or one waiting for review', () => {
      expect(mailsSignInCode(person, now)).toBe(true);
      expect(mailsSignInCode({ ...person, status: 'PENDING_REVIEW' }, now)).toBe(true);
    });
    it('nobody else', () => {
      expect(mailsSignInCode(null, now)).toBe(false);
      expect(mailsSignInCode({ ...person, status: 'DISABLED' }, now)).toBe(false);
      expect(mailsSignInCode({ ...person, passwordHash: null }, now)).toBe(false);
      expect(mailsSignInCode({ ...person, passwordChosen: false }, now)).toBe(false);
      const gone = { requestedAt: now, deleteAfter: now, purgeStartedAt: null };
      expect(mailsSignInCode({ ...person, closure: gone as never }, now)).toBe(false);
    });
  });
});
