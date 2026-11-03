import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { FakeCheckoutGateway, FakePlanGateway, FakeStripeGateway } from '../billing/stripe/__tests__/fake.js';
import { createMailer } from '../email/mailer.js';
import { MemoryMailTransport } from '../email/transports/memory.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';

/**
 * MUT-534 (D11): the two doors to the daily come-back run, like the renewal notice's. The Scheduler's job route answers
 * counts only; the operator's route answers rows too and can dry-run. Both need Stripe and their own token.
 */
const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const JOB_TOKEN = 'test-job-token-with-at-least-32-characters-long';
const NOW = new Date('2027-03-10T08:30:00Z');
const DAY = 86_400_000;
const JOB = '/jobs/v1/billing/comeback-mail';
const ADMIN = '/admin/v1/billing/comeback-mail';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;

function harness(opts: { stripeOff?: boolean; noCoupon?: boolean } = {}) {
  const store = new MemoryLedgerStore();
  const outbox = new MemoryMailTransport(() => NOW);
  const logger = pino({ level: 'silent' });
  const mailer = createMailer({ transport: outbox, store, logger, now: () => NOW, fromAddress: 'no-reply@mail.example.test', replyTo: null, limits: { daily: 500, securityReserve: 50, perRecipient: 3 } });
  const gateway = new FakeStripeGateway(() => NOW);
  const checkout = new FakeCheckoutGateway().withGaPrices();
  if (!opts.noCoupon) checkout.withComebackCoupon();
  const plan = new FakePlanGateway();
  const app = createApp({
    store,
    logger,
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => NOW,
    mailer,
    stripe: opts.stripeOff ? null : { webhookGateway: gateway, reconcileGateway: gateway, checkoutGateway: checkout, planGateway: plan },
    jobToken: JOB_TOKEN,
  });
  async function lapsed() {
    const { user } = await store.users.create({
      email: 'back@studio.example',
      displayName: 'Rana Saleh',
      passwordHash: 'x',
      locale: 'en',
      personal: { name: 'Personal', slug: 'personal-back', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
      at: NOW,
    });
    await store.billing.saveAccount({ stripeCustomerId: 'cus_back', userId: user.id, country: 'IL', currency: 'ILS', at: NOW, linkAudit: [] });
    await store.billing.saveSubscription({
      stripeCustomerId: 'cus_back',
      stripeSubscriptionId: 'sub_back',
      tier: 'FREELANCER',
      organizationId: null,
      status: 'canceled',
      currentPeriodEnd: new Date(NOW.getTime() - 20 * DAY),
      cancelAtPeriodEnd: false,
      priceLookupKey: 'freelancer_list_monthly_ils',
      founderUntil: null,
      offerId: null,
      endedAt: new Date(NOW.getTime() - 31 * DAY),
      stripeUpdatedAt: NOW,
      at: NOW,
      audit: { profileIds: [], source: 'webhook', eventId: null, requestId: null },
    });
    plan.paid.set('sub_back', 1);
    return user;
  }
  const post = (path: string, headers: Record<string, string>, body?: unknown) =>
    app.request(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { store, outbox, lapsed, post };
}

describe('POST /jobs/v1/billing/comeback-mail (Cloud Scheduler)', () => {
  it('mails a lapsed payer the come-back prices from the coupon and the catalog; counts only; a second run sends nothing new', async () => {
    const h = harness();
    const person = await h.lapsed();
    const res = await h.post(JOB, { 'x-job-token': JOB_TOKEN });
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body).toMatchObject({ checked: 1, due: 1, sent: 1, incomplete: false });
    expect(JSON.stringify(body)).not.toContain(person.email);
    const [mail] = h.outbox.list({ to: person.email });
    expect(mail!.template).toBe('comeback-offer');
    // The fake catalog's monthly price is ₪39: the prices are the catalog's less the coupon's ₪20, never a number in code.
    expect(mail!.text).toContain('Come back for ₪19 for your first month, then ₪39 a month.');
    expect(mail!.html).toContain('http://localhost/?billing=true&amp;step=subscribe');
    expect(await read(await h.post(JOB, { 'x-job-token': JOB_TOKEN }))).toMatchObject({ sent: 0, skipped: { alreadyMailed: 1 } });
  });

  it('with no come-back coupon in Stripe, nobody is mailed', async () => {
    const h = harness({ noCoupon: true });
    await h.lapsed();
    expect(await read(await h.post(JOB, { 'x-job-token': JOB_TOKEN }))).toMatchObject({ sent: 0, skipped: { noOffer: 1 } });
  });

  it('needs the job token, and Stripe', async () => {
    expect((await harness().post(JOB, {})).status).toBe(401);
    const off = await harness({ stripeOff: true }).post(JOB, { 'x-job-token': JOB_TOKEN });
    expect(off.status).toBe(503);
  });
});

describe('POST /admin/v1/billing/comeback-mail (operator)', () => {
  it('a dry run lists who would be mailed and at which stage, and records nothing', async () => {
    const h = harness();
    const person = await h.lapsed();
    const body = await read(await h.post(ADMIN, { 'x-admin-token': ADMIN_TOKEN }, { dryRun: true }));
    expect(body.rows).toEqual([{ userId: person.id, email: person.email, locale: 'en', stripeSubscriptionId: 'sub_back', stage: 'day-30', action: 'send', skip: null, outcome: null }]);
    expect(await h.store.billing.retentionEventsOf(person.id)).toEqual([]);
    expect((await h.post(ADMIN, { 'x-job-token': JOB_TOKEN }, { dryRun: true })).status).toBe(401);
  });
});
