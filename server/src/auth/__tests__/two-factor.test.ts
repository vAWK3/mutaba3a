import { describe, expect, it } from 'vitest';
import {
  challengeTokenDigest,
  emailCodeDigest,
  generateChallengeToken,
  generateRecoveryCodes,
  maskEmail,
  normalizeRecoveryCode,
  TWO_FACTOR_POLICY,
  TwoFactorKeys,
} from '../two-factor.js';

/** MUT-710 (ADR-275): the pure rules of two-step sign-in. */
describe('two-step sign-in rules (MUT-710)', () => {
  it('ten-minute challenges, five tries, ten recovery codes, a 15-minute lock after 5 wrong second steps', () => {
    expect(TWO_FACTOR_POLICY).toMatchObject({
      challengeMinutes: 10,
      maxAttempts: 5,
      recoveryCodes: 10,
      lockAfterFailures: 5,
      failureWindowMinutes: 15,
      lockMinutes: 15,
      resendAfterSeconds: 30,
      maxCodesPerChallenge: 5,
    });
  });

  describe('recovery codes (D9)', () => {
    it('ten distinct xxxx-xxxx codes from an alphabet without look-alikes', () => {
      const codes = generateRecoveryCodes();
      expect(codes).toHaveLength(10);
      expect(new Set(codes).size).toBe(10);
      for (const c of codes) expect(c).toMatch(/^[a-km-np-z2-9]{4}-[a-km-np-z2-9]{4}$/);
      for (const c of codes) expect(c).not.toMatch(/[lo01]/);
    });

    it('normalises what a person types: case, spaces, a missing or extra dash', () => {
      expect(normalizeRecoveryCode(' K7MQ 2XDP ')).toBe('k7mq-2xdp');
      expect(normalizeRecoveryCode('k7mq2xdp')).toBe('k7mq-2xdp');
      expect(normalizeRecoveryCode('k7mq–2xdp')).toBe('k7mq-2xdp');
      expect(normalizeRecoveryCode('k7mq-2xd')).toBeNull();
      expect(normalizeRecoveryCode('k7mq-2xd0')).toBeNull();
    });
  });

  describe('keys (D4)', () => {
    const keys = new TwoFactorKeys('seal-secret');

    it('seals a TOTP secret so only the same key opens it', () => {
      const sealed = keys.sealSecret('JBSWY3DPEHPK3PXP');
      expect(sealed).toMatch(/^v1\./);
      expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
      expect(keys.openSecret(sealed)).toBe('JBSWY3DPEHPK3PXP');
      expect(new TwoFactorKeys('another-secret').openSecret(sealed)).toBeNull();
    });

    it('digests a recovery code bound to the person, independent of the session pepper', () => {
      const a = keys.recoveryDigest('u-1', 'k7mq-2xdp');
      expect(a).toMatch(/^[0-9a-f]{64}$/);
      expect(keys.recoveryDigest('u-1', 'k7mq-2xdp')).toBe(a);
      expect(keys.recoveryDigest('u-2', 'k7mq-2xdp')).not.toBe(a);
      expect(new TwoFactorKeys('another-secret').recoveryDigest('u-1', 'k7mq-2xdp')).not.toBe(a);
    });
  });

  it('a challenge token is 32 random bytes; only its digest is stored', () => {
    const token = generateChallengeToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateChallengeToken()).not.toBe(token);
    const digest = challengeTokenDigest('pepper', token);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(challengeTokenDigest('other', token)).not.toBe(digest);
  });

  it('an emailed code is digested bound to its challenge', () => {
    const a = emailCodeDigest('pepper', 'c-1', '123456');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(emailCodeDigest('pepper', 'c-2', '123456')).not.toBe(a);
  });

  it('masks the address the code went to', () => {
    expect(maskEmail('sader@basel.ps')).toBe('s•••@basel.ps');
    expect(maskEmail('a@b.co')).toBe('a•••@b.co');
  });
});
