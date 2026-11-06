import { describe, expect, it } from 'vitest';
import { mintTicket, TICKET_TTL_MS, verifyTicket, type TicketClaims } from '../ticket.js';

/** MUT-314 test group 9 (pure): a stateless HMAC ticket; any change, another pepper or an expired one verifies to null. */
const PEPPER = 'session-pepper-with-at-least-32-chars!!';
const now = new Date('2026-11-06T09:00:00Z');
const claims: TicketClaims = {
  type: 'report',
  kind: 'member',
  org: '7c2b3c1e-0000-4000-8000-000000000001',
  sub: '7c2b3c1e-0000-4000-8000-000000000002',
  from: '2026-10-01',
  to: '2026-10-31',
  asOf: '2026-11-06T09:00:00.000Z',
  lang: 'ar',
};

describe('ticket (MUT-314)', () => {
  it('round-trips its claims until it expires, 120 s on', () => {
    const { ticket, expiresAt } = mintTicket(PEPPER, claims, now);
    expect(expiresAt.getTime() - now.getTime()).toBe(TICKET_TTL_MS);
    expect(TICKET_TTL_MS).toBe(120_000);
    expect(verifyTicket(PEPPER, ticket, now)).toMatchObject(claims);
    expect(verifyTicket(PEPPER, ticket, new Date(expiresAt.getTime() - 1))).toMatchObject(claims);
    expect(verifyTicket(PEPPER, ticket, expiresAt)).toBeNull();
  });

  it('two tickets for the same claims differ (a nonce)', () => {
    expect(mintTicket(PEPPER, claims, now).ticket).not.toBe(mintTicket(PEPPER, claims, now).ticket);
  });

  it('a tampered payload, a wrong signature, another pepper or garbage verifies to null', () => {
    const { ticket } = mintTicket(PEPPER, claims, now);
    const [payload, sig] = ticket.split('.') as [string, string];
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), type: 'receipts' })).toString('base64url');
    expect(verifyTicket(PEPPER, `${forged}.${sig}`, now)).toBeNull();
    expect(verifyTicket(PEPPER, `${payload}.${sig.slice(0, -2)}aa`, now)).toBeNull();
    expect(verifyTicket('another-pepper-with-at-least-32-chars!!', ticket, now)).toBeNull();
    for (const bad of ['', 'abc', 'a.b.c', `${payload}.`, `.${sig}`]) expect(verifyTicket(PEPPER, bad, now)).toBeNull();
  });

  it('a validly signed payload of the wrong shape verifies to null', async () => {
    const { createHmac } = await import('node:crypto');
    const payload = Buffer.from(JSON.stringify({ v: 1, type: 'everything', exp: now.getTime() + 1000 })).toString('base64url');
    const sig = createHmac('sha256', PEPPER).update(`period-download:${payload}`).digest('hex');
    expect(verifyTicket(PEPPER, `${payload}.${sig}`, now)).toBeNull();
  });
});
