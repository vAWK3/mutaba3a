import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SVIX_TOLERANCE_SECONDS, verifySvixSignature } from '../svix.js';

/**
 * MUT-359 A3: Resend signs webhooks with Svix. The vector is Svix's own worked example
 * (docs.svix.com, "Verifying manually"), recomputed with node:crypto before it was pinned here.
 */
const SECRET = 'whsec_plJ3nmyCDGBKInavdOK15jsl';
const ID = 'msg_loFOjxBNrRLzqYUf';
const TIMESTAMP = '1731705121';
const BODY = '{"event_type":"ping","data":{"success":true}}';
const SIGNATURE = 'v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=';
const AT = new Date(Number(TIMESTAMP) * 1000);

const headers = (overrides: Record<string, string | undefined> = {}) => ({ 'svix-id': ID, 'svix-timestamp': TIMESTAMP, 'svix-signature': SIGNATURE, ...overrides });
const verify = (h: Record<string, string | undefined>, body = BODY, now = AT, secret = SECRET) => verifySvixSignature({ secret, header: (n) => h[n], body, now });

function sign(secret: string, id: string, ts: string, body: string): string {
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
  return `v1,${createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64')}`;
}

describe('verifySvixSignature', () => {
  it("verifies Svix's published example at its own timestamp", () => {
    expect(verify(headers())).toBe(true);
  });

  it('refuses another secret, a changed body, a changed id or a changed timestamp', () => {
    expect(verify(headers(), BODY, AT, 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw')).toBe(false);
    expect(verify(headers(), BODY.replace('true', 'false'))).toBe(false);
    expect(verify(headers({ 'svix-id': 'msg_other' }))).toBe(false);
    expect(verify(headers({ 'svix-timestamp': String(Number(TIMESTAMP) + 1) }), BODY, AT)).toBe(false);
  });

  it(`refuses a timestamp more than ${SVIX_TOLERANCE_SECONDS} s old or ahead`, () => {
    const late = new Date(AT.getTime() + (SVIX_TOLERANCE_SECONDS + 1) * 1000);
    const early = new Date(AT.getTime() - (SVIX_TOLERANCE_SECONDS + 1) * 1000);
    expect(verify(headers(), BODY, late)).toBe(false);
    expect(verify(headers(), BODY, early)).toBe(false);
    expect(verify(headers(), BODY, new Date(AT.getTime() + (SVIX_TOLERANCE_SECONDS - 1) * 1000))).toBe(true);
  });

  it('accepts any matching signature in a space-separated list (secret rotation)', () => {
    expect(verify(headers({ 'svix-signature': `v1,AAAA v1,bm90LWl0 ${SIGNATURE}` }))).toBe(true);
    expect(verify(headers({ 'svix-signature': 'v1,AAAA v1,bm90LWl0' }))).toBe(false);
  });

  it('ignores signatures of other versions', () => {
    expect(verify(headers({ 'svix-signature': SIGNATURE.replace('v1,', 'v2,') }))).toBe(false);
  });

  it('refuses a missing header, a non-numeric timestamp or a malformed secret', () => {
    expect(verify(headers({ 'svix-id': undefined }))).toBe(false);
    expect(verify(headers({ 'svix-signature': undefined }))).toBe(false);
    expect(verify(headers({ 'svix-timestamp': 'yesterday' }))).toBe(false);
    expect(verify(headers(), BODY, AT, 'plJ3nmyCDGBKInavdOK15jsl')).toBe(false);
    expect(verify(headers(), BODY, AT, 'whsec_')).toBe(false);
  });

  it('verifies what it signs for a fresh secret, so the helper below matches production', () => {
    const secret = `whsec_${Buffer.from('a fresh secret, 32 bytes long!!!').toString('base64')}`;
    const now = new Date('2026-10-23T10:00:00Z');
    const ts = String(Math.floor(now.getTime() / 1000));
    expect(verifySvixSignature({ secret, header: (n) => ({ 'svix-id': 'msg_1', 'svix-timestamp': ts, 'svix-signature': sign(secret, 'msg_1', ts, '{}') })[n], body: '{}', now })).toBe(true);
  });
});
