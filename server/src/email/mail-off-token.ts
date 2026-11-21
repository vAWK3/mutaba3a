import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

/**
 * MUT-535 (plan D8): the monthly summary mail's opt-out link carries `<id>.<signature>`, where id is the person's id
 * in base64url and the signature is HMAC-SHA256 over `mail-off:v1:<userId>` with a key derived (HKDF) from the
 * session pepper. It never expires, since an opt-out link must keep working, and it only switches this one mail;
 * rotating the pepper voids the links already sent (the page then points at You › Account).
 */
const PURPOSE = 'mail-off:v1';
const keys = new Map<string, Buffer>();

function keyOf(pepper: string): Buffer {
  let key = keys.get(pepper);
  if (!key) {
    key = Buffer.from(hkdfSync('sha256', pepper, 'mtb3a', PURPOSE, 32));
    keys.set(pepper, key);
  }
  return key;
}

function signatureOf(pepper: string, userId: string): Buffer {
  return createHmac('sha256', keyOf(pepper)).update(`${PURPOSE}:${userId}`).digest();
}

export function mailOffToken(pepper: string, userId: string): string {
  return `${Buffer.from(userId, 'utf8').toString('base64url')}.${signatureOf(pepper, userId).toString('base64url')}`;
}

/** The person the token was made for, or null for anything else (never throws). */
export function verifyMailOffToken(pepper: string, token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const userId = Buffer.from(parts[0], 'base64url').toString('utf8');
  if (!/^[0-9a-f-]{36}$/.test(userId)) return null;
  const given = Buffer.from(parts[1], 'base64url');
  const expected = signatureOf(pepper, userId);
  return given.length === expected.length && timingSafeEqual(given, expected) ? userId : null;
}
