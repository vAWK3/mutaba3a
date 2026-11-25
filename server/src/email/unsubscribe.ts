import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

/**
 * ADR-279 (the legal pages rewrite): the mails a person can opt out of, and the one-click unsubscribe headers
 * (RFC 2369 List-Unsubscribe, RFC 8058 List-Unsubscribe-Post) that let a mail client do it without opening a page.
 * The URL is the API under the portal's origin (the portal reaches the API at `/v1`). RFC 8058 needs the recipient in
 * the URL, so it carries its own token, narrower than the mail-off page's: HMAC over `mail-unsubscribe:v1:<mail>:<user>`
 * with its own derived key, so a URL that lands in a request log can only ever turn that one mail off.
 */
export const OPT_OUT_MAILS = ['offers', 'monthly-summary'] as const;
export type OptOutMail = (typeof OPT_OUT_MAILS)[number];

/** The only headers a mail may add (the Resend transport drops any other), so no tracking header can ride along. */
export const ALLOWED_MAIL_HEADERS = ['List-Unsubscribe', 'List-Unsubscribe-Post'] as const;

const PURPOSE = 'mail-unsubscribe:v1';
const keys = new Map<string, Buffer>();

function signatureOf(pepper: string, mail: OptOutMail, userId: string): Buffer {
  let key = keys.get(pepper);
  if (!key) {
    key = Buffer.from(hkdfSync('sha256', pepper, 'mtb3a', PURPOSE, 32));
    keys.set(pepper, key);
  }
  return createHmac('sha256', key).update(`${PURPOSE}:${mail}:${userId}`).digest();
}

/** `<user id, base64url>.<signature>`: names one person and one mail. Never expires (an unsubscribe must keep working). */
export function unsubscribeToken(pepper: string, mail: OptOutMail, userId: string): string {
  return `${Buffer.from(userId, 'utf8').toString('base64url')}.${signatureOf(pepper, mail, userId).toString('base64url')}`;
}

/** The person a one-click token names for `mail`, or null for anything else (never throws). */
export function verifyUnsubscribeToken(pepper: string, mail: OptOutMail, token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const userId = Buffer.from(parts[0], 'base64url').toString('utf8');
  if (!/^[0-9a-f-]{36}$/.test(userId)) return null;
  const given = Buffer.from(parts[1], 'base64url');
  const expected = signatureOf(pepper, mail, userId);
  return given.length === expected.length && timingSafeEqual(given, expected) ? userId : null;
}

export function unsubscribeUrl(portalOrigin: string, mail: OptOutMail, pepper: string, userId: string): string {
  return `${portalOrigin.replace(/\/+$/, '')}/v1/mail-preferences/unsubscribe?mail=${mail}&token=${unsubscribeToken(pepper, mail, userId)}`;
}

export function unsubscribeHeaders(portalOrigin: string, mail: OptOutMail, pepper: string, userId: string): Record<string, string> {
  return { 'List-Unsubscribe': `<${unsubscribeUrl(portalOrigin, mail, pepper, userId)}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
}
