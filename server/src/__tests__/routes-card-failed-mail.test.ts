import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { FakeCheckoutGateway, FakePlanGateway, FakeStripeGateway } from '../billing/stripe/__tests__/fake.js';
import { createMailer } from '../email/mailer.js';
import { MemoryMailTransport } from '../email/transports/memory.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';

/**
 * MUT-533 (D1): the two doors to the hourly failed-card run, like the renewal notice's. The Scheduler's job route
 * answers counts only; the operator's route answers rows too and can dry-run. Both need Stripe and their own token.
 */
const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const JOB_TOKEN = 'test-job-token-with-at-least-32-characters-long';
const NOW = new Date('2027-03-10T09:07:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const JOB = '/jobs/v1/billing/card-failed-mail';
const ADMIN = '/admin/v1/billing/card-failed-mail';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;

function harness(opts: { stripeOff?: boolean; gate?: boolean; windowDays?: number } = {}) {
  const store = new MemoryLedgerStore();
  const outbox = new MemoryMailTransport(() => NOW);
  const logger = pino({ level: 'silent' });
  const mailer = createMailer({ transport: outbox, store, logger, now: () => NOW, fromAddress: 'no-reply@mail.example.test', replyTo: null, limits: { daily: 500, securityReserve: 50, perRecipient: 3 } });
  const gateway = new FakeStripeGateway(() => NOW);
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
    stripe: opts.stripeOff ? null : { webhookGateway: gateway, reconcileGateway: gateway, checkoutGateway: new FakeCheckoutGateway(), planGateway: plan },
    jobToken: JOB_TOKEN,
    billingGate: opts.gate ?? true,
    ...(opts.windowDays ? { retryWindowDays: opts.windowDays } : {}),
  });
  async function pastDue(failedAgo: number) {
    const { user } = await store.users.create({
      email: 'card@studio.example',
      displayName: 'Rana Saleh',
      passwordHash: 'x',
      locale: 'en',
      personal: { name: 'Personal', slug: 'personal-card', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
      at: NOW,
    });
    await store.billing.saveAccount({ stripeCustomerId: 'cus_card', userId: user.id, country: 'IL', currency: 'ILS', at: NOW, linkAudit: [] });
    await store.billing.saveSubscription({
      stripeCustomerId: 'cus_card',
      stripeSubscriptionId: 'sub_card',
      tier: 'FREELANCER',
      organizationId: null,
      status: 'past_due',
      currentPeriodEnd: new Date(NOW.getTime() + 28 * DAY),
      cancelAtPeriodEnd: false,
      priceLookupKey: 'freelancer_list_monthly_ils',
      founderUntil: null,
      offerId: null,
      stripeUpdatedAt: NOW,
      at: NOW,
      audit: { profileIds: [], source: 'webhook', eventId: null, requestId: null },
    });
    plan.failedPayments.set('sub_card', {
      status: 'past_due',
      episode: { invoiceId: 'in_card', attemptCount: 2, nextPaymentAttempt: new Date(NOW.getTime() + DAY), firstFailedAt: new Date(NOW.getTime() - failedAgo), needsAuthentication: false },
    });
    return user;
  }
  const post = (path: string, headers: Record<string, string>, body?: unknown) =>
    app.request(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { outbox, plan, pastDue, post };
}

describe('POST /jobs/v1/billing/card-failed-mail (Cloud Scheduler)', () => {
  it('sends this hour’s mails and answers counts only, never an address; a second run sends nothing new', async () => {
    const h = harness();
    const person = await h.pastDue(2 * HOUR);
    const res = await h.post(JOB, { 'x-job-token': JOB_TOKEN });
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body).toMatchObject({ checked: 1, due: 1, sent: 1, incomplete: false });
    expect(JSON.stringify(body)).not.toContain(person.email);
    const [mail] = h.outbox.list({ to: person.email });
    expect(mail!.template).toBe('card-failed');
    expect(mail!.html).toContain('http://localhost/?billing=true');
    expect(await read(await h.post(JOB, { 'x-job-token': JOB_TOKEN }))).toMatchObject({ sent: 0, duplicate: 1 });
  });

  it('times the reminder in the configured window and words it by the lapse gate', async () => {
    const h = harness({ gate: false, windowDays: 28 });
    const person = await h.pastDue(14 * DAY);
    await h.post(JOB, { 'x-job-token': JOB_TOKEN });
    const [mail] = h.outbox.list({ to: person.email });
    expect(mail!.template).toBe('card-failed-reminder');
    expect(mail!.text).toContain('your plan ends within 14 days at most.');
  });

  it('needs the job token, and Stripe', async () => {
    expect((await harness().post(JOB, {})).status).toBe(401);
    const off = await harness({ stripeOff: true }).post(JOB, { 'x-job-token': JOB_TOKEN });
    expect(off.status).toBe(503);
    expect((await read(off)).error.code).toBe('BILLING_NOT_CONFIGURED');
  });
});

describe('POST /admin/v1/billing/card-failed-mail (operator)', () => {
  it('a dry run lists who would be mailed and at which stage, and mails nothing', async () => {
    const h = harness();
    const person = await h.pastDue(2 * HOUR);
    const res = await h.post(ADMIN, { 'x-admin-token': ADMIN_TOKEN }, { dryRun: true });
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body.summary).toMatchObject({ dryRun: true, due: 1, sent: 0 });
    expect(body.rows).toEqual([{ userId: person.id, email: person.email, locale: 'en', stripeSubscriptionId: 'sub_card', stage: 'first', action: 'send', skip: null, outcome: null }]);
    expect(h.outbox.list({})).toHaveLength(0);
  });

  it('needs the admin token', async () => {
    expect((await harness().post(ADMIN, { 'x-job-token': JOB_TOKEN }, { dryRun: true })).status).toBe(401);
  });
});
