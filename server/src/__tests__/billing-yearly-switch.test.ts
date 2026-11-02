import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp, type AppDependencies } from '../app.js';
import { parseBillingCountries } from '../billing/checkout.js';
import { FakeCheckoutGateway, FakePlanGateway, FakeStripeGateway } from '../billing/stripe/__tests__/fake.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { provisionUser } from './helpers/provision.js';

/**
 * MUT-531 (plan D1–D4, R1, R2, ADR-238): the switch from monthly to yearly through the real app and session auth, with
 * Stripe's doors faked. GET /v1/billing shows the line; GET /v1/billing/yearly-switch previews today's charge; POST
 * makes the switch at the previewed proration date, or changes nothing.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;

const COOKIE = '__Host-mut_session';
const SAME_ORIGIN = { origin: 'http://localhost' };
const NOW = new Date('2026-11-02T09:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const SWITCH = '/v1/billing/yearly-switch';

function harness(overrides: Partial<AppDependencies> & { stripeOff?: boolean } = {}) {
  const store = new MemoryLedgerStore();
  const checkout = new FakeCheckoutGateway().withGaPrices();
  const plan = new FakePlanGateway();
  const stripe = new FakeStripeGateway(() => NOW);
  const clock = { now: NOW };
  const logs: string[] = [];
  const app = createApp({
    store,
    logger: pino({ level: 'info' }, { write: (line: string) => void logs.push(line) }),
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: 'test-admin-token-with-at-least-32-characters',
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => clock.now,
    sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 60 * 24 * 400, absoluteHours: 24 * 400, secureCookie: true, trustedProxyHops: 1 },
    stripe: overrides.stripeOff ? null : { webhookGateway: stripe, reconcileGateway: stripe, checkoutGateway: checkout, planGateway: plan },
    billingCountries: parseBillingCountries({ consumerCountries: '*', customTaxIdCountries: [] }),
    ...overrides,
  });
  return { app, store, checkout, plan, clock, logs };
}
type Harness = ReturnType<typeof harness>;

async function person(h: Harness) {
  const email = `switch${++seq}@studio.ps`;
  const created = await provisionUser(h.app, { email, displayName: 'Rana Saleh', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', locale: 'ar' });
  const res = await h.app.request('/v1/sessions', { method: 'POST', headers: { 'content-type': 'application/json', ...SAME_ORIGIN }, body: JSON.stringify({ email, password: created.password }) });
  const token = new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const headers = { cookie: `${COOKIE}=${token}`, ...SAME_ORIGIN };
  return {
    userId: created.user.id as string,
    personalId: created.personalProfile.id as string,
    billing: () => h.app.request('/v1/billing', { headers }),
    preview: () => h.app.request(SWITCH, { headers }),
    switch: (body: unknown) => h.app.request(SWITCH, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  };
}

/** A mirrored subscription for the person, and the same one live in the fake plan door. */
async function subscribed(h: Harness, userId: string, over: { lookupKey?: string; status?: string; cancelAtPeriodEnd?: boolean; paid?: number; discounted?: boolean; paused?: boolean } = {}) {
  const customer = `cus_${++seq}`;
  const id = `sub_${++seq}`;
  const lookupKey = over.lookupKey ?? 'freelancer_list_monthly_ils';
  await h.store.billing.saveAccount({ stripeCustomerId: customer, userId, country: 'IL', currency: 'ILS', at: NOW, linkAudit: [] });
  await h.store.billing.saveSubscription({
    stripeCustomerId: customer,
    stripeSubscriptionId: id,
    tier: 'FREELANCER',
    organizationId: null,
    status: over.status ?? 'active',
    currentPeriodEnd: new Date(NOW.getTime() + 20 * DAY),
    cancelAtPeriodEnd: over.cancelAtPeriodEnd ?? false,
    priceLookupKey: lookupKey,
    founderUntil: null,
    offerId: null,
    stripeUpdatedAt: NOW,
    at: NOW,
    audit: { profileIds: [], source: 'webhook', eventId: null, requestId: null },
  });
  h.plan.withPlan(id, customer, { lookupKey, status: over.status ?? 'active', cancelAtPeriodEnd: over.cancelAtPeriodEnd ?? false, discounted: over.discounted ?? false, paused: over.paused ?? false }, over.paid ?? 2);
  return { id, customer };
}

const audit = async (h: Harness, organizationId: string) =>
  (await h.store.audit.list(organizationId, {}, { limit: 50, cursor: null })).items.filter((e) => e.action === 'billing.yearly_switched');

describe('GET /v1/billing yearlySwitch (AC2, D2, D3, R1)', () => {
  it('shows the saving from the catalog once a monthly list-price payer has 2 paid invoices', async () => {
    const h = harness();
    const u = await person(h);
    const { id } = await subscribed(h, u.userId);
    const body = await read(await u.billing());
    // The fake catalog: ₪39 a month, ₪390 a year → 12 × 3900 − 39000.
    expect(body.yearlySwitch).toEqual({ currency: 'ILS', savings: 7800 });
    expect(h.plan.calls).toEqual([`paid:${id}`]);
  });

  it('is null before the 2nd paid invoice', async () => {
    const h = harness();
    const u = await person(h);
    await subscribed(h, u.userId, { paid: 1 });
    expect((await read(await u.billing())).yearlySwitch).toBeNull();
  });

  it('is null for a yearly, founder, cancelling or trialing subscription, and asks Stripe nothing', async () => {
    for (const over of [{ lookupKey: 'freelancer_list_yearly_ils' }, { lookupKey: 'freelancer_founder_monthly_ils' }, { cancelAtPeriodEnd: true }, { status: 'trialing' }]) {
      const h = harness();
      const u = await person(h);
      await subscribed(h, u.userId, over);
      expect((await read(await u.billing())).yearlySwitch).toBeNull();
      expect(h.plan.calls).toEqual([]);
    }
  });

  it('a Stripe failure hides the line and still answers', async () => {
    const h = harness();
    const u = await person(h);
    await subscribed(h, u.userId);
    h.plan.failNext();
    const res = await u.billing();
    expect(res.status).toBe(200);
    expect((await read(res)).yearlySwitch).toBeNull();
  });
});

describe('GET /v1/billing/yearly-switch (D1: the preview)', () => {
  it('answers what is due today, the yearly price, the renewal and the proration date to confirm with', async () => {
    const h = harness();
    const u = await person(h);
    const { id } = await subscribed(h, u.userId);
    const res = await u.preview();
    expect(res.status).toBe(200);
    expect(await read(res)).toEqual({ amountDue: 27100, currency: 'ILS', yearlyAmount: 39000, renewsOn: '2027-10-02T09:00:00.000Z', prorationDate: NOW.toISOString() });
    expect(h.plan.calls).toEqual([`plan:${id}`, `paid:${id}:fresh`, `preview:${id}:price_freelancer_list_yearly_ils`]);
  });

  it('decides from Stripe’s own state: a discount or a pause refuses it with the reason', async () => {
    for (const [over, why] of [
      [{ discounted: true }, 'DISCOUNTED'],
      [{ paused: true }, 'PAUSED'],
      [{ paid: 1 }, 'TOO_EARLY'],
      [{ lookupKey: 'freelancer_founder_monthly_ils' }, 'NOT_MONTHLY_LIST'],
    ] as const) {
      const h = harness();
      const u = await person(h);
      await subscribed(h, u.userId, over);
      const res = await u.preview();
      expect(res.status).toBe(409);
      expect((await read(res)).error.details).toEqual({ reason: 'SWITCH_NOT_AVAILABLE', why });
    }
  });

  it('refuses someone with no subscription, and answers 503 without Stripe', async () => {
    const h = harness();
    const u = await person(h);
    expect((await read(await u.preview())).error.details).toEqual({ reason: 'SWITCH_NOT_AVAILABLE', why: 'NO_SUBSCRIPTION' });
    const off = harness({ stripeOff: true });
    const v = await person(off);
    expect((await v.preview()).status).toBe(503);
  });

  it('signed out is 401', async () => {
    const h = harness();
    expect((await h.app.request(SWITCH)).status).toBe(401);
  });
});

describe('POST /v1/billing/yearly-switch (D1, D4, R2)', () => {
  it('switches at the previewed proration date to the yearly price, with no discount, and audits it', async () => {
    const h = harness();
    const u = await person(h);
    const { id, customer } = await subscribed(h, u.userId);
    h.plan.outcome = { outcome: 'switched', currentPeriodEnd: new Date('2027-11-02T09:00:00Z') };
    h.clock.now = new Date(NOW.getTime() + 2 * MINUTE);
    const res = await u.switch({ prorationDate: NOW.toISOString(), expectedAmountDue: 27100 });
    expect(res.status).toBe(200);
    expect(await read(res)).toEqual({ renewsOn: '2027-11-02T09:00:00.000Z', yearlyAmount: 39000, currency: 'ILS' });
    expect(h.plan.switches).toEqual([{ subscriptionId: id, customer, itemId: `si_${id}`, yearlyPriceId: 'price_freelancer_list_yearly_ils', prorationDate: NOW }]);
    expect(h.plan.calls).toContain(`paid:${id}:fresh`);
    const rows = await audit(h, u.personalId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.metadata).toEqual({ currency: 'ILS', amountDue: 27100 });
  });

  it('charges nothing when a fresh preview no longer matches what the person saw', async () => {
    const h = harness();
    const u = await person(h);
    await subscribed(h, u.userId);
    h.plan.amountDue = 27500;
    const res = await u.switch({ prorationDate: NOW.toISOString(), expectedAmountDue: 27100 });
    expect(res.status).toBe(409);
    expect((await read(res)).error.details).toEqual({ reason: 'AMOUNT_CHANGED' });
    expect(h.plan.switches).toEqual([]);
  });

  it('a proration date older than 30 minutes, or in the future, must be previewed again', async () => {
    const h = harness();
    const u = await person(h);
    await subscribed(h, u.userId);
    for (const at of [new Date(NOW.getTime() - 31 * MINUTE), new Date(NOW.getTime() + 5 * MINUTE)]) {
      const res = await u.switch({ prorationDate: at.toISOString(), expectedAmountDue: 27100 });
      expect((await read(res)).error.details).toEqual({ reason: 'AMOUNT_CHANGED' });
    }
    expect(h.plan.switches).toEqual([]);
  });

  it('a declined card leaves the plan monthly: 409 PAYMENT_FAILED, no audit', async () => {
    const h = harness();
    const u = await person(h);
    await subscribed(h, u.userId);
    h.plan.outcome = { outcome: 'payment-failed' };
    const res = await u.switch({ prorationDate: NOW.toISOString(), expectedAmountDue: 27100 });
    expect(res.status).toBe(409);
    expect((await read(res)).error.details).toEqual({ reason: 'PAYMENT_FAILED' });
    expect(await audit(h, u.personalId)).toEqual([]);
  });

  it('a payment waiting for the bank answers with Stripe’s invoice page (R2)', async () => {
    const h = harness();
    const u = await person(h);
    await subscribed(h, u.userId);
    h.plan.outcome = { outcome: 'payment-needs-action', hostedInvoiceUrl: 'https://invoice.stripe.com/i/acct_1/in_9' };
    const res = await u.switch({ prorationDate: NOW.toISOString(), expectedAmountDue: 27100 });
    expect(res.status).toBe(409);
    expect((await read(res)).error.details).toEqual({ reason: 'PAYMENT_NEEDS_ACTION', hostedInvoiceUrl: 'https://invoice.stripe.com/i/acct_1/in_9' });
  });

  it('refuses a subscription that became ineligible since the preview', async () => {
    const h = harness();
    const u = await person(h);
    const { id } = await subscribed(h, u.userId);
    h.plan.plans.set(id, { ...h.plan.plans.get(id)!, cancelAtPeriodEnd: true });
    const res = await u.switch({ prorationDate: NOW.toISOString(), expectedAmountDue: 27100 });
    expect((await read(res)).error.details).toEqual({ reason: 'SWITCH_NOT_AVAILABLE', why: 'CANCELLING' });
    expect(h.plan.switches).toEqual([]);
  });

  it('on a sandbox test clock, previews and switches at the clock’s time, not the server’s', async () => {
    const h = harness();
    const u = await person(h);
    const { id } = await subscribed(h, u.userId);
    const clock = new Date('2026-10-15T12:00:00Z');
    h.plan.plans.set(id, { ...h.plan.plans.get(id)!, clockNow: clock });
    expect((await read(await u.preview())).prorationDate).toBe(clock.toISOString());
    expect((await u.switch({ prorationDate: clock.toISOString(), expectedAmountDue: 27100 })).status).toBe(200);
    expect(h.plan.switches[0]!.prorationDate).toEqual(clock);
  });

  it('takes only the two fields it needs', async () => {
    const h = harness();
    const u = await person(h);
    await subscribed(h, u.userId);
    expect((await u.switch({ prorationDate: NOW.toISOString(), expectedAmountDue: 27100, coupon: 'mtb3a_launch_yearly_2026' })).status).toBe(422);
    expect((await u.switch({ prorationDate: 'yesterday', expectedAmountDue: 27100 })).status).toBe(422);
  });
});
