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
 * MUT-535 (D6–D8, D12): the monthly summary's doors. The Scheduler's job route answers counts only and runs without
 * Stripe too; the operator's answers rows and can dry-run; You › Account reads and turns the switch; the opt-out page
 * turns it with the mail's signed token.
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
const JOB = '/jobs/v1/billing/monthly-summary-mail';
const ADMIN = '/admin/v1/billing/monthly-summary-mail';
const ME = '/v1/me/monthly-summary-mail';
const OFF = '/v1/mail-preferences/monthly-summary';
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
  const request = (path: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) =>
    app.request(`http://localhost${path}`, { method: init.method ?? 'POST', headers: { 'content-type': 'application/json', ...init.headers }, ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) });

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

describe('the monthly summary job and operator doors', () => {
  it('the job answers counts only with its token, and 401 without', async () => {
    const h = await harness();
    expect((await h.request(JOB)).status).toBe(401);
    const res = await h.request(JOB, { headers: { 'x-job-token': JOB_TOKEN } });
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body).toMatchObject({ dryRun: false, month: '2026-11', sent: 0, incomplete: false });
    expect(body.rows).toBeUndefined();
  });

  it('runs on a server without Stripe (D9: no yearly line, not no mail)', async () => {
    const h = await harness({ stripeOff: true });
    expect((await h.request(JOB, { headers: { 'x-job-token': JOB_TOKEN } })).status).toBe(200);
  });

  it('the operator’s dry run answers a row per person and mails nothing', async () => {
    const h = await harness();
    await h.person();
    const res = await h.request(ADMIN, { headers: { 'x-admin-token': ADMIN_TOKEN }, body: { dryRun: true } });
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body.summary.dryRun).toBe(true);
    expect(body.rows).toHaveLength(1);
    expect(h.outbox.list().filter((m) => m.template === 'monthly-summary')).toHaveLength(0);
  });
});

describe('You › Account’s switch (D7)', () => {
  it('is on for a payer; off and back on returns to the default', async () => {
    const h = await harness();
    const p = await h.person();
    expect(await read(await h.request(ME, { method: 'GET', headers: p.session }))).toEqual({ on: true });
    expect(await read(await h.request(ME, { method: 'PATCH', headers: p.session, body: { on: false } }))).toEqual({ on: false });
    expect((await h.store.users.getById(p.userId))?.monthlySummaryMail).toBe('OFF');
    expect(await read(await h.request(ME, { method: 'PATCH', headers: p.session, body: { on: true } }))).toEqual({ on: true });
    expect((await h.store.users.getById(p.userId))?.monthlySummaryMail).toBeNull();
  });

  it('is off by default when Malafat covers every profile; turning it on includes them (R5)', async () => {
    const h = await harness();
    const p = await h.person({ paying: false });
    await h.store.integrations.connect({ organizationId: p.personal, provider: 'MALAFAT', externalTenantId: 'tenant-1', displayName: 'Office', connectedByApiKeyId: 'key', at: NOW });
    expect(await read(await h.request(ME, { method: 'GET', headers: p.session }))).toEqual({ on: false });
    expect(await read(await h.request(ME, { method: 'PATCH', headers: p.session, body: { on: true } }))).toEqual({ on: true });
    expect((await h.store.users.getById(p.userId))?.monthlySummaryMail).toBe('ON_ALL');
  });

  it('needs a session', async () => {
    const h = await harness();
    expect((await h.request(ME, { method: 'GET' })).status).toBe(401);
  });
});

describe('the opt-out page’s door (D8)', () => {
  it('turns it off with the mail’s token, and back on', async () => {
    const h = await harness();
    const p = await h.person();
    const token = mailOffToken(PEPPER, p.userId);
    expect(await read(await h.request(OFF, { headers: SAME_ORIGIN, body: { token, on: false } }))).toEqual({ on: false });
    expect((await h.store.users.getById(p.userId))?.monthlySummaryMail).toBe('OFF');
    expect(await read(await h.request(OFF, { headers: SAME_ORIGIN, body: { token, on: true } }))).toEqual({ on: true });
  });

  it('answers 404 for a token that names nobody or was signed with another pepper', async () => {
    const h = await harness();
    const p = await h.person();
    expect((await h.request(OFF, { headers: SAME_ORIGIN, body: { token: mailOffToken('another-pepper-with-at-least-32-chars!!', p.userId), on: false } })).status).toBe(404);
    expect((await h.request(OFF, { headers: SAME_ORIGIN, body: { token: 'garbage', on: false } })).status).toBe(404);
    expect((await h.store.users.getById(p.userId))?.monthlySummaryMail).toBeNull();
  });

  it('refuses another site', async () => {
    const h = await harness();
    const p = await h.person();
    const res = await h.request(OFF, { headers: { origin: 'https://evil.example' }, body: { token: mailOffToken(PEPPER, p.userId), on: false } });
    expect(res.status).toBe(403);
  });
});
