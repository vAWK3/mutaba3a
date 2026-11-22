import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * MUT-710 (ADR-274 D4): time-based one-time codes, RFC 6238 over RFC 4226, as authenticator apps (Authy, Google
 * Authenticator, 1Password) compute them: HMAC-SHA1, 6 digits, 30-second steps. Pure: no clock, no store.
 */
export const TOTP_POLICY = {
  digits: 6,
  periodSeconds: 30,
  /** Steps either side of now that still count, for a phone clock a little off. */
  window: 1,
  /** RFC 4226 recommends 160 bits. */
  secretBytes: 20,
} as const;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const CODE_SHAPE = new RegExp(`^\\d{${TOTP_POLICY.digits}}$`);

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Accepts lower case, spaces and `=` padding, as people type a key by hand. Throws on any other letter. */
export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error('Not a base32 key');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(TOTP_POLICY.secretBytes));
}

export function stepOf(at: Date): number {
  return Math.floor(at.getTime() / 1000 / TOTP_POLICY.periodSeconds);
}

/** The code for one time step (RFC 4226 dynamic truncation). */
export function totpAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** TOTP_POLICY.digits).padStart(TOTP_POLICY.digits, '0');
}

export type TotpCheck = { ok: true; step: number } | { ok: false };

/**
 * Whether `code` is the code for now ±1 step. A step at or before `lastUsedStep` is refused, so a code seen once (over
 * a shoulder, in a phishing proxy) can't be used again; the caller stores the returned step.
 */
export function verifyTotp(secret: string, code: string, at: Date, lastUsedStep: number | null): TotpCheck {
  if (!CODE_SHAPE.test(code)) return { ok: false };
  const now = stepOf(at);
  const presented = Buffer.from(code);
  for (let step = now - TOTP_POLICY.window; step <= now + TOTP_POLICY.window; step += 1) {
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    if (timingSafeEqual(Buffer.from(totpAt(secret, step)), presented)) return { ok: true, step };
  }
  return { ok: false };
}

/** The `otpauth://totp/…` address an authenticator app reads from a QR code or a tap (Key Uri Format). */
export function otpauthUri(input: { secret: string; account: string; issuer: string }): string {
  const label = encodeURIComponent(`${input.issuer}:${input.account}`);
  const query = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_POLICY.digits),
    period: String(TOTP_POLICY.periodSeconds),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}
