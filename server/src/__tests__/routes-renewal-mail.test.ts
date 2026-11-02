import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { FakeCheckoutGateway, FakeStripeGateway } from '../billing/stripe/__tests__/fake.js';
import { createMailer } from '../email/mailer.js';
import { MemoryMailTransport } from '../email/transports/memory.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';

/**
 * MUT-525 (DD8): the two doors to the renewal-notice run, like the trial mail's. The Scheduler's job route answers
 * counts only; the operator's route answers rows too and can dry-run. Both need Stripe and their own token.
 */
const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const JOB_TOKEN = 'test-job-token-with-at-least-32-characters-long';
const NOW = new Date('2027-10-20T07:00:00Z');
const DAY = 86_400_000;
const JOB = '/jobs/v1/billing/renewal-mail';
const ADMIN = '/admin/v1/billing/renewal-mail';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;

function harness(opts: { stripeOff?: boolean } = {}) {
  const store = new MemoryLedgerStore();
  const outbox = new MemoryMailTransport(() => NOW);
  const logger = pino({ level: 'silent' });
  const mailer = createMailer({ transport: outbox, store, logger, now: () => NOW, fromAddress: 'no-reply@mail.example.test', replyTo: null, limits: { daily: 500, securityReserve: 50, perRecipient: 3 } });
  const gateway = new FakeStripeGateway(() => NOW);
  const checkout = new FakeCheckoutGateway();
  const app = createApp({
    store,
    logger,
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => NOW,
    mailer,
    stripe: opts.stripeOff ? null : { webhookGateway: gateway, reconcileGateway: gateway, checkoutGateway: checkout },
    jobToken: JOB_TOKEN,
  });
  async function offerSubscriber() {
    const { user } = await store.users.create({
      email: 'renew@studio.example',
      displayName: 'Rana Saleh',
      passwordHash: 'x',
      locale: 'en',
      personal: { name: 'Personal', slug: 'personal-renew', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
      at: NOW,
    });
    const periodEnd = new Date(NOW.getTime() + 25 * DAY);
    await store.billing.saveAccount({ stripeCustomerId: 'cus_renew', userId: user.id, country: 'IL', currency: 'ILS', at: NOW, linkAudit: [] });
    await store.billing.saveSubscription({
      stripeCustomerId: 'cus_renew',
      stripeSubscriptionId: 'sub_renew',
      tier: 'FREELANCER',
      organizationId: null,
      status: 'active',
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
      priceLookupKey: 'freelancer_list_yearly_ils',
      founderUntil: null,
      offerId: 'launch-2026',
      stripeUpdatedAt: NOW,
      at: NOW,
      audit: { profileIds: [], source: 'webhook', eventId: null, requestId: null },
    });
    checkout.renewals.set('sub_renew', { status: 'active', cancelAtPeriodEnd: false, currentPeriodEnd: periodEnd, firstPaidPeriod: true, unitAmount: 29000, currency: 'ILS', lookupKey: 'freelancer_list_yearly_ils' });
    return user;
  }
  const post = (path: string, headers: Record<string, string>, body?: unknown) =>
    app.request(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { outbox, checkout, offerSubscriber, post };
}

describe('POST /jobs/v1/billing/renewal-mail (Cloud Scheduler)', () => {
  it('sends the day’s notices and answers counts only, never an address; a second run sends nothing new', async () => {
    const h = harness();
    const person = await h.offerSubscriber();
    const res = await h.post(JOB, { 'x-job-token': JOB_TOKEN });
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body).toMatchObject({ dryRun: false, checked: 1, due: 1, sent: 1, duplicate: 0 });
    expect(JSON.stringify(body)).not.toContain(person.email);
    const [mail] = h.outbox.list({ to: person.email });
    expect(mail!.template).toBe('offer-renewing-soon');
    expect(mail!.text).toContain('http://localhost/?billing=true');
    expect(await read(await h.post(JOB, { 'x-job-token': JOB_TOKEN }))).toMatchObject({ sent: 0, duplicate: 1 });
  });

  it('needs the job token, and Stripe', async () => {
    expect((await harness().post(JOB, { 'x-admin-token': ADMIN_TOKEN })).status).toBe(401);
    const off = harness({ stripeOff: true });
    const res = await off.post(JOB, { 'x-job-token': JOB_TOKEN });
    expect(res.status).toBe(503);
    expect((await read(res)).error.code).toBe('BILLING_NOT_CONFIGURED');
  });
});

describe('POST /admin/v1/billing/renewal-mail (operator)', () => {
  it('a dry run lists who would be told and mails nothing; it needs the admin token', async () => {
    const h = harness();
    const person = await h.offerSubscriber();
    expect((await h.post(ADMIN, { 'x-job-token': JOB_TOKEN }, { dryRun: true })).status).toBe(401);
    const res = await h.post(ADMIN, { 'x-admin-token': ADMIN_TOKEN }, { dryRun: true });
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body.summary).toMatchObject({ dryRun: true, due: 1, sent: 0 });
    expect(body.rows).toEqual([{ userId: person.id, email: person.email, locale: 'en', stripeSubscriptionId: 'sub_renew', renewsAt: new Date(NOW.getTime() + 25 * DAY).toISOString(), action: 'send', skip: null, outcome: null }]);
    expect(h.outbox.list()).toHaveLength(0);
  });
});
