import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp, type AppDependencies } from '../app.js';
import { parseBillingCountries } from '../billing/checkout.js';
import { PAUSE_RESUME_LEAD_MS } from '../billing/retention.js';
import { FakeCheckoutGateway, FakePlanGateway, FakeStripeGateway } from '../billing/stripe/__tests__/fake.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { provisionUser } from './helpers/provision.js';

/**
 * MUT-532 (plan D6–D12, R3, R6, ADR-239): MTB3A's own cancel flow through the real app and session auth, with Stripe's
 * doors faked. GET /v1/billing/retention says what the flow may offer; pause, Resume now, cancel, Keep my plan and the
 * stay offer each change Stripe once, record their event, and audit on the person's profiles.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;

const COOKIE = '__Host-mut_session';
const SAME_ORIGIN = { origin: 'http://localhost' };
const NOW = new Date('2026-11-20T09:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const PERIOD_END = new Date('2026-12-02T09:00:00Z');
const ANCHOR = new Date('2026-10-02T09:00:00Z');

function harness(overrides: Partial<AppDependencies> = {}) {
  const store = new MemoryLedgerStore();
  const checkout = new FakeCheckoutGateway().withGaPrices().withStayCoupon();
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
    stripe: { webhookGateway: stripe, reconcileGateway: stripe, checkoutGateway: checkout, planGateway: plan },
    billingCountries: parseBillingCountries({ consumerCountries: '*', customTaxIdCountries: [] }),
    billingGate: true,
    ...overrides,
  });
  return { app, store, checkout, plan, clock, logs };
}
type Harness = ReturnType<typeof harness>;

async function person(h: Harness) {
  const email = `retention${++seq}@studio.ps`;
  const created = await provisionUser(h.app, { email, displayName: 'Rana Saleh', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', locale: 'ar' });
  const res = await h.app.request('/v1/sessions', { method: 'POST', headers: { 'content-type': 'application/json', ...SAME_ORIGIN }, body: JSON.stringify({ email, password: created.password }) });
  const token = new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const headers = { cookie: `${COOKIE}=${token}`, ...SAME_ORIGIN };
  const send = (method: string, path: string, body?: unknown) =>
    h.app.request(path, { method, headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return {
    userId: created.user.id as string,
    personalId: created.personalProfile.id as string,
    headers,
    billing: () => send('GET', '/v1/billing'),
    retention: () => send('GET', '/v1/billing/retention'),
    pause: (body: unknown) => send('POST', '/v1/billing/pause', body),
    endPause: () => send('DELETE', '/v1/billing/pause'),
    cancel: (body: unknown) => send('POST', '/v1/billing/cancellation', body),
    keep: () => send('DELETE', '/v1/billing/cancellation'),
    stay: (body: unknown) => send('POST', '/v1/billing/stay-offer', body),
  };
}

interface SubscribedOptions {
  lookupKey?: string;
  status?: string;
  cancelAtPeriodEnd?: boolean;
  paid?: number;
  discounted?: boolean;
  managedBySchedule?: boolean;
  pausedFrom?: Date | null;
  pauseResumesAt?: Date | null;
}

/** A mirrored subscription for the person, and the same one live in the fake plan door. */
async function subscribed(h: Harness, userId: string, over: SubscribedOptions = {}) {
  const customer = `cus_${++seq}`;
  const id = `sub_${++seq}`;
  const lookupKey = over.lookupKey ?? 'freelancer_list_monthly_ils';
  const pausedFrom = over.pausedFrom ?? null;
  await h.store.billing.saveAccount({ stripeCustomerId: customer, userId, country: 'IL', currency: 'ILS', at: NOW, linkAudit: [] });
  await h.store.billing.saveSubscription({
    stripeCustomerId: customer,
    stripeSubscriptionId: id,
    tier: 'FREELANCER',
    organizationId: null,
    status: over.status ?? 'active',
    currentPeriodEnd: PERIOD_END,
    cancelAtPeriodEnd: over.cancelAtPeriodEnd ?? false,
    priceLookupKey: lookupKey,
    founderUntil: null,
    offerId: null,
    pausedFrom,
    pauseResumesAt: over.pauseResumesAt ?? null,
    stripeUpdatedAt: NOW,
    at: NOW,
    audit: { profileIds: [], source: 'webhook', eventId: null, requestId: null },
  });
  h.plan.withPlan(
    id,
    customer,
    {
      lookupKey,
      status: over.status ?? 'active',
      cancelAtPeriodEnd: over.cancelAtPeriodEnd ?? false,
      discounted: over.discounted ?? false,
      currentPeriodEnd: PERIOD_END,
      billingCycleAnchor: ANCHOR,
      managedBySchedule: over.managedBySchedule ?? false,
      paused: pausedFrom !== null,
      pause: pausedFrom !== null ? { from: pausedFrom, resumesAt: over.pauseResumesAt ?? null } : null,
    },
    over.paid ?? 1,
  );
  return { id, customer };
}

const audits = async (h: Harness, organizationId: string, action: string) =>
  (await h.store.audit.list(organizationId, {}, { limit: 50, cursor: null })).items.filter((e) => e.action === action);
const until = (months: number) => new Date(Date.UTC(2026, 11 + months, 2, 9));

describe('GET /v1/billing/retention (D6, D10, D11)', () => {
  it('offers 1–3 months of pause from the period end, and the stay offer at half the monthly price', async () => {
    const h = harness();
    const u = await person(h);
    await subscribed(h, u.userId);
    const res = await u.retention();
    expect(res.status).toBe(200);
    expect(await read(res)).toEqual({
      endsOn: PERIOD_END.toISOString(),
      pause: {
        options: [1, 2, 3].map((months) => ({ months, from: PERIOD_END.toISOString(), until: until(months).toISOString() })),
      },
      // The fake catalog: ₪39 a month.
      stayOffer: { percentOff: 50, months: 2, currency: 'ILS', monthlyAmount: 1950, listAmount: 3900 },
    });
    expect(h.checkout.couponReads).toEqual(['cached:mtb3a_stay_monthly_50']);
  });

  it('a yearly payer gets neither: straight to Confirm cancel', async () => {
    const h = harness();
    const u = await person(h);
    await subscribed(h, u.userId, { lookupKey: 'freelancer_list_yearly_ils' });
    expect(await read(await u.retention())).toEqual({ endsOn: PERIOD_END.toISOString(), pause: null, stayOffer: null });
  });

  it('a trialist has nothing to pause, and still sees the stay offer', async () => {
    const h = harness();
    const u = await person(h);
    await subscribed(h, u.userId, { paid: 0 });
    expect(await read(await u.retention())).toMatchObject({ pause: null, stayOffer: { percentOff: 50 } });
  });

  it('a missing or wrongly shaped stay coupon means no stay step, logged, never a refusal', async () => {
    const h = harness();
    h.checkout.coupons.clear();
    const u = await person(h);
    await subscribed(h, u.userId);
    expect(await read(await u.retention())).toMatchObject({ pause: { options: expect.any(Array) }, stayOffer: null });
    expect(h.logs.some((line) => line.includes('no stay step'))).toBe(true);

    h.checkout.withStayCoupon('mtb3a_stay_monthly_50', { duration: 'once' });
    expect((await read(await u.retention())).stayOffer).toBeNull();

    h.checkout.withStayCoupon();
    h.checkout.failCoupons();
    expect((await read(await u.retention())).stayOffer).toBeNull();
  });

  it('refuses with nothing to cancel: no subscription, already cancelling, or a founder schedule', async () => {
    const h = harness();
    const none = await person(h);
    expect((await read(await none.retention())).error.details).toEqual({ reason: 'NOTHING_TO_CANCEL', why: 'NO_SUBSCRIPTION' });
    const cancelling = await person(h);
    await subscribed(h, cancelling.userId, { cancelAtPeriodEnd: true });
    expect((await read(await cancelling.retention())).error.details).toEqual({ reason: 'NOTHING_TO_CANCEL', why: 'CANCELLING' });
    const founder = await person(h);
    await subscribed(h, founder.userId, { lookupKey: 'freelancer_founder_monthly_ils', managedBySchedule: true });
    expect((await read(await founder.retention())).error.details).toEqual({ reason: 'NOTHING_TO_CANCEL', why: 'MANAGED_BY_SCHEDULE' });
  });

  it('answers 503 without Stripe, and 401 signed out', async () => {
    const h = harness({ stripe: null });
    const u = await person(h);
    expect((await u.retention()).status).toBe(503);
    expect((await h.app.request('/v1/billing/retention')).status).toBe(401);
  });
});

describe('POST /v1/billing/pause (D6, D10, R6)', () => {
  it('books the pause from the period end, resuming an hour before the restart, and records and audits it', async () => {
    const h = harness();
    const u = await person(h);
    const { id } = await subscribed(h, u.userId);
    const res = await u.pause({ months: 2, reason: 'unused' });
    expect(res.status).toBe(200);
    expect(await read(res)).toEqual({ from: PERIOD_END.toISOString(), until: until(2).toISOString() });
    const resumesAt = new Date(until(2).getTime() - PAUSE_RESUME_LEAD_MS);
    expect(h.plan.writes).toEqual([`pause:${id}:2:${PERIOD_END.toISOString()}:${resumesAt.toISOString()}`]);
    expect(await h.store.billing.retentionEventsOf(u.userId)).toEqual([
      expect.objectContaining({ kind: 'PAUSE', stripeSubscriptionId: id, reason: 'unused', months: 2, startsAt: PERIOD_END, endsAt: until(2), endedEarlyAt: null }),
    ]);
    const rows = await audits(h, u.personalId, 'billing.pause_scheduled');
    expect(rows.map((r) => r.metadata)).toEqual([{ months: 2, reason: 'unused', from: PERIOD_END.toISOString(), until: until(2).toISOString() }]);
  });

  it('refuses a yearly plan, a trialist, and a plan already pausing', async () => {
    const h = harness();
    const yearly = await person(h);
    await subscribed(h, yearly.userId, { lookupKey: 'freelancer_list_yearly_ils' });
    expect((await read(await yearly.pause({ months: 1, reason: 'unused' }))).error.details).toEqual({ reason: 'PAUSE_NOT_AVAILABLE', why: 'NOT_MONTHLY_LIST' });
    const trialist = await person(h);
    await subscribed(h, trialist.userId, { paid: 0 });
    expect((await read(await trialist.pause({ months: 1, reason: 'unused' }))).error.details).toEqual({ reason: 'PAUSE_NOT_AVAILABLE', why: 'TOO_EARLY' });
    const pausing = await person(h);
    await subscribed(h, pausing.userId);
    expect((await pausing.pause({ months: 1, reason: 'unused' })).status).toBe(200);
    expect((await read(await pausing.pause({ months: 1, reason: 'unused' }))).error.details).toEqual({ reason: 'PAUSE_NOT_AVAILABLE', why: 'PAUSED' });
    expect(h.plan.writes.filter((w) => w.startsWith('pause:'))).toHaveLength(1);
  });

  it('is once in 12 months: a pause that ran refuses the next, one undone before it started does not', async () => {
    const h = harness();
    const u = await person(h);
    const { id } = await subscribed(h, u.userId);
    expect((await u.pause({ months: 1, reason: 'unused' })).status).toBe(200);
    expect(await read(await u.endPause())).toEqual({ resumed: 'cancelled', payment: null, hostedInvoiceUrl: null });
    expect((await u.pause({ months: 1, reason: 'unused' })).status).toBe(200);

    // The second pause runs, and Stripe resumes it on its own.
    h.clock.now = new Date(PERIOD_END.getTime() + DAY);
    Object.assign(h.plan.plans.get(id)!, { paused: false, pause: null, currentPeriodEnd: until(1) });
    expect((await read(await u.pause({ months: 1, reason: 'unused' }))).error.details).toEqual({ reason: 'PAUSE_NOT_AVAILABLE', why: 'ONCE_A_YEAR' });
    expect((await read(await u.retention())).pause).toBeNull();
  });

  it('two tabs pausing at once make one pause (R6)', async () => {
    const h = harness();
    const u = await person(h);
    await subscribed(h, u.userId);
    const results = await Promise.all([u.pause({ months: 1, reason: 'unused' }), u.pause({ months: 3, reason: 'other' })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(h.plan.writes.filter((w) => w.startsWith('pause:'))).toHaveLength(1);
  });

  it('a refusal Stripe will repeat releases the claim, so the person can try again (R3)', async () => {
    const h = harness();
    const u = await person(h);
    await subscribed(h, u.userId);
    h.plan.failNextWrite('parameter_invalid');
    expect((await u.pause({ months: 1, reason: 'unused' })).status).toBe(409);
    expect(await h.store.billing.retentionEventsOf(u.userId)).toEqual([]);
    expect((await u.pause({ months: 1, reason: 'unused' })).status).toBe(200);
  });

  it('a timeout that did pause in Stripe answers as booked and keeps the claim (R3)', async () => {
    const h = harness();
    const u = await person(h);
    await subscribed(h, u.userId);
    h.plan.failNextAfterApplying();
    expect((await u.pause({ months: 1, reason: 'unused' })).status).toBe(200);
    expect(await h.store.billing.retentionEventsOf(u.userId)).toHaveLength(1);
  });

  it('a timeout that didn\'t pause releases the claim and says try again (R3)', async () => {
    const h = harness();
    const u = await person(h);
    await subscribed(h, u.userId);
    h.plan.failNextWrite();
    expect((await u.pause({ months: 1, reason: 'unused' })).status).toBe(502);
    expect(await h.store.billing.retentionEventsOf(u.userId)).toEqual([]);
  });

  it('validates the months and the reason', async () => {
    const h = harness();
    const u = await person(h);
    await subscribed(h, u.userId);
    expect((await u.pause({ months: 4, reason: 'unused' })).status).toBe(422);
    expect((await u.pause({ months: 1, reason: 'bored' })).status).toBe(422);
  });
});

describe('DELETE /v1/billing/pause (D7)', () => {
  it('Resume now during the pause charges a month today, ends the event early and audits it', async () => {
    const h = harness();
    const u = await person(h);
    const { id } = await subscribed(h, u.userId);
    await u.pause({ months: 2, reason: 'unused' });
    h.clock.now = new Date(PERIOD_END.getTime() + 3 * DAY);
    const res = await u.endPause();
    expect(await read(res)).toEqual({ resumed: 'now', payment: 'charged', hostedInvoiceUrl: null });
    expect(h.plan.writes.at(-1)).toBe(`end-pause:${id}:now`);
    expect((await h.store.billing.retentionEventsOf(u.userId))[0]!.endedEarlyAt).toEqual(h.clock.now);
    expect((await audits(h, u.personalId, 'billing.pause_ended')).map((r) => r.metadata)).toEqual([{ resumed: 'now', payment: 'charged' }]);
  });

  it('a declined card on Resume now says so; the plan restarts past due (Stripe retries it)', async () => {
    const h = harness();
    const u = await person(h);
    await subscribed(h, u.userId, { pausedFrom: new Date(NOW.getTime() - DAY), pauseResumesAt: until(1) });
    h.plan.resumeOutcome = { outcome: 'payment-failed' };
    expect(await read(await u.endPause())).toEqual({ resumed: 'now', payment: 'failed', hostedInvoiceUrl: null });
  });

  it('refuses with no pause set', async () => {
    const h = harness();
    const u = await person(h);
    await subscribed(h, u.userId);
    expect((await read(await u.endPause())).error.details).toEqual({ reason: 'NOT_PAUSED' });
  });

  it('works while the records are read-only: the gate leaves billing open', async () => {
    const h = harness();
    const u = await person(h);
    await subscribed(h, u.userId, { pausedFrom: new Date(NOW.getTime() - DAY), pauseResumesAt: until(1) });
    const write = await h.app.request('/v1/expenses', {
      method: 'POST',
      headers: { ...u.headers, 'content-type': 'application/json', 'x-mutaba3a-profile': u.personalId, 'idempotency-key': randomUUID() },
      body: JSON.stringify({ amount: '12.00', currency: 'ILS', occurredOn: '2026-11-05', title: 'Paper' }),
    });
    expect(write.status).toBe(402);
    expect((await read(write)).error.details).toEqual({ profileId: u.personalId, state: 'READ_ONLY', source: 'STRIPE', until: until(1).toISOString(), paused: true });
    expect((await u.endPause()).status).toBe(200);
  });
});

describe('POST and DELETE /v1/billing/cancellation (D8)', () => {
  it('cancels at the period end with the reason and comment, then Keep my plan takes it back', async () => {
    const h = harness();
    const u = await person(h);
    const { id } = await subscribed(h, u.userId);
    const res = await u.cancel({ reason: 'too_expensive', comment: '  Too much for now  ' });
    expect(await read(res)).toEqual({ endsOn: PERIOD_END.toISOString() });
    expect(h.plan.writes).toEqual([`cancel:${id}:too_expensive:Too much for now`]);
    expect(await h.store.billing.retentionEventsOf(u.userId)).toEqual([expect.objectContaining({ kind: 'CANCEL', reason: 'too_expensive', endsAt: PERIOD_END, endedEarlyAt: null })]);
    expect((await audits(h, u.personalId, 'billing.cancel_scheduled')).map((r) => r.metadata)).toEqual([{ reason: 'too_expensive' }]);

    expect((await u.keep()).status).toBe(200);
    expect(h.plan.writes.at(-1)).toBe(`keep:${id}`);
    expect((await h.store.billing.retentionEventsOf(u.userId))[0]!.endedEarlyAt).toEqual(NOW);
    expect(await audits(h, u.personalId, 'billing.cancel_undone')).toHaveLength(1);
    expect((await read(await u.keep())).error.details).toEqual({ reason: 'NOT_CANCELLING' });
  });

  it('sends no comment when there is none, and a yearly or founder-free plan cancels the same way', async () => {
    const h = harness();
    const u = await person(h);
    const { id } = await subscribed(h, u.userId, { lookupKey: 'freelancer_list_yearly_ils' });
    expect((await u.cancel({ reason: 'other' })).status).toBe(200);
    expect(h.plan.writes).toEqual([`cancel:${id}:other:`]);
  });

  it('refuses a founder schedule, a second cancel, and a bad body', async () => {
    const h = harness();
    const founder = await person(h);
    await subscribed(h, founder.userId, { managedBySchedule: true });
    expect((await read(await founder.cancel({ reason: 'unused' }))).error.details).toEqual({ reason: 'NOTHING_TO_CANCEL', why: 'MANAGED_BY_SCHEDULE' });
    const u = await person(h);
    await subscribed(h, u.userId);
    expect((await u.cancel({ reason: 'unused', comment: 'x'.repeat(501) })).status).toBe(422);
    expect((await u.cancel({ reason: 'cheaper_elsewhere' })).status).toBe(422);
    expect((await u.cancel({ reason: 'unused' })).status).toBe(200);
    expect((await read(await u.cancel({ reason: 'unused' }))).error.details).toEqual({ reason: 'NOTHING_TO_CANCEL', why: 'CANCELLING' });
  });
});

describe('POST /v1/billing/stay-offer (D11, rule 2, R3)', () => {
  it('puts the stay coupon on the plan, records it once, and audits it', async () => {
    const h = harness();
    const u = await person(h);
    const { id } = await subscribed(h, u.userId);
    const res = await u.stay({ reason: 'too_expensive' });
    expect(await read(res)).toEqual({ percentOff: 50, months: 2, currency: 'ILS', monthlyAmount: 1950 });
    expect(h.plan.writes).toEqual([`coupon:${id}:mtb3a_stay_monthly_50`]);
    expect(h.checkout.couponReads).toEqual(['fresh:mtb3a_stay_monthly_50']);
    expect(await h.store.billing.retentionEventsOf(u.userId)).toEqual([expect.objectContaining({ kind: 'STAY_OFFER', reason: 'too_expensive', months: 2, startsAt: NOW, endsAt: until(2) })]);
    expect((await audits(h, u.personalId, 'billing.stay_offer_applied')).map((r) => r.metadata)).toEqual([{ couponId: 'mtb3a_stay_monthly_50', reason: 'too_expensive' }]);
  });

  it('is once per person, ever', async () => {
    const h = harness();
    const u = await person(h);
    const { id } = await subscribed(h, u.userId);
    expect((await u.stay({ reason: 'unused' })).status).toBe(200);
    expect((await read(await u.stay({ reason: 'unused' }))).error.details).toEqual({ reason: 'STAY_OFFER_NOT_AVAILABLE', why: 'DISCOUNTED' });
    Object.assign(h.plan.plans.get(id)!, { discounted: false, couponIds: [] });
    expect((await read(await u.stay({ reason: 'unused' }))).error.details).toEqual({ reason: 'STAY_OFFER_NOT_AVAILABLE', why: 'ALREADY_HAD' });
    expect((await read(await u.retention())).stayOffer).toBeNull();
  });

  it('a double press applies the coupon once', async () => {
    const h = harness();
    const u = await person(h);
    await subscribed(h, u.userId);
    const results = await Promise.all([u.stay({ reason: 'unused' }), u.stay({ reason: 'unused' })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(h.plan.writes.filter((w) => w.startsWith('coupon:'))).toHaveLength(1);
  });

  it('never for founders, yearly payers or a discounted plan', async () => {
    for (const over of [{ lookupKey: 'freelancer_founder_monthly_ils' }, { lookupKey: 'freelancer_list_yearly_ils' }, { discounted: true }] as const) {
      const h = harness();
      const u = await person(h);
      await subscribed(h, u.userId, over);
      expect((await u.stay({ reason: 'unused' })).status).toBe(409);
      expect(h.plan.writes).toEqual([]);
    }
  });

  it('a refusal releases the claim; a timeout that applied keeps it and succeeds; one that didn\'t releases it (R3)', async () => {
    const h = harness();
    const u = await person(h);
    await subscribed(h, u.userId);
    h.plan.failNextWrite('coupon_expired');
    expect((await u.stay({ reason: 'unused' })).status).toBe(409);
    expect(await h.store.billing.retentionEventsOf(u.userId)).toEqual([]);
    h.plan.failNextWrite();
    expect((await u.stay({ reason: 'unused' })).status).toBe(502);
    expect(await h.store.billing.retentionEventsOf(u.userId)).toEqual([]);
    h.plan.failNextAfterApplying();
    expect((await u.stay({ reason: 'unused' })).status).toBe(200);
    expect(await h.store.billing.retentionEventsOf(u.userId)).toHaveLength(1);
  });
});

describe('GET /v1/billing with a pause (§2.5)', () => {
  it('shows the pause the mirror holds, and /v1/me says the profile is paused while it runs', async () => {
    const h = harness();
    const u = await person(h);
    await subscribed(h, u.userId, { pausedFrom: PERIOD_END, pauseResumesAt: until(2) });
    expect((await read(await u.billing())).subscription.pause).toEqual({ from: PERIOD_END.toISOString(), until: until(2).toISOString() });
    const meBefore = await read(await h.app.request('/v1/me', { headers: u.headers }));
    const billingOf = (me: Loose) => me.profiles.find((p: Loose) => p.id === u.personalId).billing;
    expect(billingOf(meBefore)).toMatchObject({ state: 'ACTIVE', paused: false });
    h.clock.now = new Date(PERIOD_END.getTime() + DAY);
    const meDuring = await read(await h.app.request('/v1/me', { headers: u.headers }));
    expect(billingOf(meDuring)).toMatchObject({ state: 'READ_ONLY', source: 'STRIPE', paused: true, until: until(2).toISOString() });
  });

  it('hides the switch-to-yearly line while the stay offer runs (D13)', async () => {
    const h = harness();
    const u = await person(h);
    await subscribed(h, u.userId, { paid: 2 });
    expect((await read(await u.billing())).yearlySwitch).not.toBeNull();
    await u.stay({ reason: 'unused' });
    expect((await read(await u.billing())).yearlySwitch).toBeNull();
  });
});
