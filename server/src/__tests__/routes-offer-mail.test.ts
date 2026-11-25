import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { FakeCheckoutGateway, FakePlanGateway, FakeStripeGateway } from '../billing/stripe/__tests__/fake.js';
import { mailOffToken } from '../email/mail-off-token.js';
import { createMailer } from '../email/mailer.js';
import { MemoryMailTransport } from '../email/transports/memory.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { provisionUser } from './helpers/provision.js';

/**
 * ADR-278 (the legal pages rewrite, Basel 2026-11-25): promotional mail (the come-back offer) has its own opt-out. The
 * mail-off page turns it off or back on with the mail's signed token; mail clients' one-click unsubscribe (RFC 8058)
 * posts to a door that needs no page and no origin, for the offers and for the monthly summary.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const JOB_TOKEN = 'test-job-token-with-at-least-32-characters-long';
const PEPPER = 'session-pepper-with-at-least-32-chars!!';
const COOKIE = '__Host-mut_session';
const SAME_ORIGIN = { origin: 'http://localhost' };
const NOW = new Date('2026-12-01T12:00:00Z');
const OFFERS = '/v1/mail-preferences/offers';
const ONE_CLICK = '/v1/mail-preferences/unsubscribe';
let seq = 0;

async function harness(opts: { stripeOff?: boolean } = {}) {
  const store = new MemoryLedgerStore();
  const logger = pino({ level: 'silent' });
  const outbox = new MemoryMailTransport(() => NOW);
  const mailer = createMailer({ transport: outbox, store, logger, now: () => NOW, fromAddress: 'no-reply@mail.example.test', replyTo: null, limits: { daily: 500, securityReserve: 50, perRecipient: 3 } });
  const gateway = new FakeStripeGateway(() => NOW);
  const app = createApp({
    store,
    logger,
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => NOW,
    mailer,
    stripe: opts.stripeOff ? null : { webhookGateway: gateway, reconcileGateway: gateway, checkoutGateway: new FakeCheckoutGateway().withGaPrices(), planGateway: new FakePlanGateway() },
    jobToken: JOB_TOKEN,
    sessions: { pepper: PEPPER, idleMinutes: 120, absoluteHours: 12, secureCookie: true, trustedProxyHops: 1 },
  });
  const request = (path: string, init: { method?: string; headers?: Record<string, string>; body?: unknown; rawBody?: string } = {}) =>
    app.request(`http://localhost${path}`, {
      method: init.method ?? 'POST',
      headers: { 'content-type': 'application/json', ...init.headers },
      ...(init.rawBody !== undefined ? { body: init.rawBody } : init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });

  async function person(opts: { paying?: boolean } = {}) {
    const firm = await read(await request('/admin/v1/organizations', { headers: { 'x-admin-token': ADMIN_TOKEN }, body: { name: `Firm ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' } }));
    const email = `r${seq}@studio.ps`;
    const created = await provisionUser(app, { email, displayName: 'Rana Saleh', organizationId: firm.id });
    const res = await request('/v1/sessions', { headers: SAME_ORIGIN, body: { email, password: created.password } });
    const session = { cookie: `${COOKIE}=${new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? ''}`, ...SAME_ORIGIN };
    const userId = created.user.id as string;
    if (opts.paying !== false) {
      await store.billing.saveAccount({ stripeCustomerId: `cus_${seq}`, userId, country: 'IL', currency: 'ILS', at: NOW, linkAudit: [] });
      await store.billing.saveSubscription({
        stripeCustomerId: `cus_${seq}`,
        stripeSubscriptionId: `sub_${seq}`,
        tier: 'FREELANCER',
        organizationId: null,
        status: 'active',
        currentPeriodEnd: new Date('2026-12-20T00:00:00Z'),
        cancelAtPeriodEnd: false,
        priceLookupKey: 'freelancer_list_monthly_ils',
        founderUntil: null,
        offerId: null,
        endedAt: null,
        stripeUpdatedAt: NOW,
        at: NOW,
        audit: { profileIds: [], source: 'webhook', eventId: null, requestId: null },
      });
    }
    return { userId, personal: created.personalProfile.id as string, session };
  }
  return { store, outbox, request, person };
}

describe('the offers opt-out page’s door', () => {
  it('turns promotional mail off with the mail’s token, and back on', async () => {
    const h = await harness();
    const p = await h.person();
    const token = mailOffToken(PEPPER, p.userId);
    expect(await read(await h.request(OFFERS, { headers: SAME_ORIGIN, body: { token, on: false } }))).toEqual({ on: false });
    expect((await h.store.users.getById(p.userId))?.offerMail).toBe('OFF');
    expect(await read(await h.request(OFFERS, { headers: SAME_ORIGIN, body: { token, on: true } }))).toEqual({ on: true });
    expect((await h.store.users.getById(p.userId))?.offerMail).toBeNull();
  });

  it('answers 404 for a bad token and refuses another site', async () => {
    const h = await harness();
    const p = await h.person();
    expect((await h.request(OFFERS, { headers: SAME_ORIGIN, body: { token: 'garbage', on: false } })).status).toBe(404);
    expect((await h.request(OFFERS, { headers: { origin: 'https://evil.example' }, body: { token: mailOffToken(PEPPER, p.userId), on: false } })).status).toBe(403);
    expect((await h.store.users.getById(p.userId))?.offerMail).toBeNull();
  });
});

describe('the one-click unsubscribe door (RFC 8058)', () => {
  const oneClick = (h: Awaited<ReturnType<typeof harness>>, query: string) =>
    h.request(`${ONE_CLICK}?${query}`, { headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: undefined, rawBody: 'List-Unsubscribe=One-Click' });

  it('a mail client’s POST, with no page and no origin, turns the offers off', async () => {
    const h = await harness();
    const p = await h.person();
    const res = await oneClick(h, `mail=offers&token=${mailOffToken(PEPPER, p.userId)}`);
    expect(res.status).toBe(200);
    expect((await h.store.users.getById(p.userId))?.offerMail).toBe('OFF');
  });

  it('turns the monthly summary off', async () => {
    const h = await harness();
    const p = await h.person();
    expect((await oneClick(h, `mail=monthly-summary&token=${mailOffToken(PEPPER, p.userId)}`)).status).toBe(200);
    expect((await h.store.users.getById(p.userId))?.monthlySummaryMail).toBe('OFF');
  });

  it('answers 404 for a bad token and 422 for an unknown mail, changing nothing', async () => {
    const h = await harness();
    const p = await h.person();
    expect((await oneClick(h, 'mail=offers&token=garbage')).status).toBe(404);
    expect((await oneClick(h, `mail=everything&token=${mailOffToken(PEPPER, p.userId)}`)).status).toBe(422);
    expect((await h.store.users.getById(p.userId))?.offerMail).toBeNull();
  });
});
