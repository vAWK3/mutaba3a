import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, generateTotpSecret, otpauthUri, TOTP_POLICY, totpAt, verifyTotp } from '../totp.js';

/** MUT-710 (ADR-274 D4): RFC 6238 TOTP, HMAC-SHA1, 6 digits, 30 s, ±1 step, no reuse of a step. */
describe('TOTP (MUT-710)', () => {
  // RFC 6238 appendix B: the SHA-1 seed is the ASCII "12345678901234567890"; the RFC prints 8 digits, we use the last 6.
  const rfcSecret = base32Encode(Buffer.from('12345678901234567890', 'ascii'));
  const vectors: Array<[number, string]> = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];

  it('six digits, thirty seconds, one step either side', () => {
    expect(TOTP_POLICY).toMatchObject({ digits: 6, periodSeconds: 30, window: 1, secretBytes: 20 });
  });

  it.each(vectors)('matches RFC 6238 at T=%i', (seconds, eight) => {
    expect(totpAt(rfcSecret, Math.floor(seconds / 30))).toBe(eight.slice(-6));
  });

  it('base32 round-trips and ignores spaces, case and padding', () => {
    const bytes = Buffer.from([0, 1, 2, 250, 255, 128, 64]);
    const encoded = base32Encode(bytes);
    expect(encoded).toMatch(/^[A-Z2-7]+$/);
    expect(base32Decode(encoded)).toEqual(bytes);
    expect(base32Decode(` ${encoded.toLowerCase().replace(/(.{4})/g, '$1 ')}==`)).toEqual(bytes);
    expect(() => base32Decode('ABC1')).toThrow();
  });

  it('a new secret is 20 random bytes, base32 (32 letters)', () => {
    const a = generateTotpSecret();
    expect(a).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(a)).toHaveLength(20);
    expect(generateTotpSecret()).not.toBe(a);
  });

  describe('verify', () => {
    const at = (seconds: number) => new Date(seconds * 1000);
    const step = Math.floor(1234567890 / 30);

    it('accepts the current step and returns it', () => {
      expect(verifyTotp(rfcSecret, '005924', at(1234567890), null)).toEqual({ ok: true, step });
    });

    it('accepts one step before and after (clock drift), not two', () => {
      expect(verifyTotp(rfcSecret, totpAt(rfcSecret, step - 1), at(1234567890), null)).toEqual({ ok: true, step: step - 1 });
      expect(verifyTotp(rfcSecret, totpAt(rfcSecret, step + 1), at(1234567890), null)).toEqual({ ok: true, step: step + 1 });
      expect(verifyTotp(rfcSecret, totpAt(rfcSecret, step - 2), at(1234567890), null)).toEqual({ ok: false });
      expect(verifyTotp(rfcSecret, totpAt(rfcSecret, step + 2), at(1234567890), null)).toEqual({ ok: false });
    });

    it('refuses a step at or before the last one used (no replay)', () => {
      expect(verifyTotp(rfcSecret, '005924', at(1234567890), step)).toEqual({ ok: false });
      expect(verifyTotp(rfcSecret, totpAt(rfcSecret, step - 1), at(1234567890), step - 1)).toEqual({ ok: false });
      expect(verifyTotp(rfcSecret, totpAt(rfcSecret, step + 1), at(1234567890), step)).toEqual({ ok: true, step: step + 1 });
    });

    it('refuses anything that is not six digits', () => {
      for (const bad of ['', '00592', '0059244', 'abcdef', '٠٠٥٩٢٤', '005 924']) expect(verifyTotp(rfcSecret, bad, at(1234567890), null)).toEqual({ ok: false });
    });
  });

  it('builds the otpauth:// address authenticator apps read', () => {
    const uri = otpauthUri({ secret: 'JBSWY3DPEHPK3PXP', account: 'rana@studio.ps', issuer: 'MTB3A' });
    const url = new URL(uri);
    expect(url.protocol).toBe('otpauth:');
    expect(url.host).toBe('totp');
    expect(decodeURIComponent(url.pathname)).toBe('/MTB3A:rana@studio.ps');
    expect(Object.fromEntries(url.searchParams)).toEqual({ secret: 'JBSWY3DPEHPK3PXP', issuer: 'MTB3A', algorithm: 'SHA1', digits: '6', period: '30' });
  });
});
