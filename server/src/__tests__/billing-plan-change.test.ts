import pino from 'pino';
import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { parseBillingCountries } from '../billing/checkout.js';
import { entitlementsFor } from '../billing/coverage.js';
import { createStripeSync } from '../billing/stripe/sync.js';
import { FakeCheckoutGateway, FakePlanGateway, FakeStripeGateway, stripeObjects } from '../billing/stripe/__tests__/fake.js';
import { createMailer } from '../email/mailer.js';
import { MemoryMailTransport } from '../email/transports/memory.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import type { BillingTierRecord } from '../repositories/ports.js';
import { provisionUser } from './helpers/provision.js';

/**
 * MUT-734 (ADR-291): changing plan from Billing: up now with Stripe's proration, down at the period end through a
 * schedule, to Starter by cancel + the Starter choice; undo; the mirror settles them; the paid plans' business counts.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;
const COOKIE = '__Host-mut_session';
const SAME_ORIGIN = { origin: 'http://localhost' };
const NOW = new Date('2026-11-27T09:00:00Z');
const DAY = 86_400_000;
const END = new Date(NOW.getTime() + 20 * DAY);
const COUNTRIES = parseBillingCountries({ consumerCountries: '*', customTaxIdCountries: ['IL', 'JO'], vatRates: { IL: 18 } });

function harness(options: { sales?: boolean; paidBusinessCaps?: boolean } = {}) {
  const store = new MemoryLedgerStore({ starterPlan: true, paidBusinessCaps: options.paidBusinessCaps ?? false });
  const checkout = new FakeCheckoutGateway().withGaPrices().withPlanPrices();
  const plan = new FakePlanGateway();
  const stripe = new FakeStripeGateway(() => NOW);
  const outbox = new MemoryMailTransport(() => NOW);
  const logger = pino({ level: 'silent' });
  const mailer = createMailer({ transport: outbox, store, logger, now: () => NOW, fromAddress: 'no-reply@mail.example.test', replyTo: null, limits: { daily: 500, securityReserve: 50, perRecipient: 50 } });
  const app = createApp({
    store,
    logger,
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: 'test-admin-token-with-at-least-32-characters',
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => NOW,
    mailer,
    sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 60 * 24 * 400, absoluteHours: 24 * 400, secureCookie: true, trustedProxyHops: 1 },
    stripe: { webhookGateway: stripe, reconcileGateway: stripe, checkoutGateway: checkout, planGateway: plan },
    billingCountries: COUNTRIES,
    planSales: options.sales ?? true,
    billingSessionLimiter: new SlidingWindowRateLimiter(1_000_000),
  });
  return { app, store, checkout, plan, stripe, outbox };
}
type Harness = ReturnType<typeof harness>;

async function person(h: Harness) {
  const email = `change${++seq}@studio.ps`;
  const created = await provisionUser(h.app, { email, displayName: 'Rana Saleh', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', locale: 'en' });
  const res = await h.app.request('/v1/sessions', { method: 'POST', headers: { 'content-type': 'application/json', ...SAME_ORIGIN }, body: JSON.stringify({ email, password: created.password }) });
  const token = new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const headers = { cookie: `${COOKIE}=${token}`, ...SAME_ORIGIN };
  const send = (method: string, path: string, body?: unknown) =>
    h.app.request(path, { method, headers: { ...headers, 'content-type': 'application/json', 'idempotency-key': `idem-key-734-${++seq}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { email, userId: created.user.id as string, send, billing: () => h.app.request('/v1/billing', { headers }) };
}

const TIER_KEY: Record<string, string> = { SOLO: 'solo_list_monthly_ils', BUSINESS: 'business_list_monthly_ils', FIRM: 'firm_list_monthly_ils', FREELANCER: 'freelancer_list_monthly_ils' };

async function subscribed(h: Harness, userId: string, tier: BillingTierRecord, over: { taxRateIds?: string[] } = {}) {
  const customer = `cus_${++seq}`;
  const id = `sub_${++seq}`;
  await h.store.billing.saveAccount({ stripeCustomerId: customer, userId, country: 'IL', currency: 'ILS', at: NOW, linkAudit: [] });
  await h.store.billing.saveSubscription({
    stripeCustomerId: customer,
    stripeSubscriptionId: id,
    tier,
    organizationId: null,
    status: 'active',
    currentPeriodEnd: END,
    cancelAtPeriodEnd: false,
    priceLookupKey: TIER_KEY[tier]!,
    founderUntil: null,
    offerId: null,
    stripeUpdatedAt: NOW,
    at: NOW,
    audit: { profileIds: [], source: 'webhook', eventId: null, requestId: null },
  });
  const plan = tier.toLowerCase();
  h.plan.withPlan(id, customer, { lookupKey: TIER_KEY[tier]!, currentPeriodEnd: END, price: { id: `price_${plan}_m_ils`, currency: 'ils', productId: `prod_${plan}`, unitAmount: 3900, taxBehavior: 'exclusive' }, taxRateIds: over.taxRateIds ?? [] });
  return { id, customer };
}

async function business(_h: Harness, u: { send: (m: string, p: string, b?: unknown) => Response | Promise<Response> }, name: string) {
  const res = await u.send('POST', '/v1/profiles', { name, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', type: 'BUSINESS', carriedOver: true });
  const body = await read(res);
  expect({ status: res.status, body }).toEqual({ status: 201, body: expect.objectContaining({ id: expect.any(String) }) });
  return body.id as string;
}

describe('POST /v1/billing/plan-change/preview', () => {
  it('an upgrade previews Stripe’s proration charged now, with the new limits', async () => {
    const h = harness();
    const u = await person(h);
    await subscribed(h, u.userId, 'SOLO');
    const res = await u.send('POST', '/v1/billing/plan-change/preview', { plan: 'business' });
    expect(res.status).toBe(200);
    expect(await read(res)).toEqual({ kind: 'upgrade', plan: 'business', amountDue: 27100, currency: 'ILS', prorationAt: NOW.toISOString(), limits: { businesses: 3, partners: 2, documentsPerMonth: 250, scansPerMonth: 500 } });
  });

  it('a downgrade previews the period end and whether the person must pick businesses', async () => {
    const h = harness();
    const u = await person(h);
    await subscribed(h, u.userId, 'BUSINESS');
    await business(h, u, 'Studio A');
    await business(h, u, 'Studio B');
    const body = await read(await u.send('POST', '/v1/billing/plan-change/preview', { plan: 'solo' }));
    expect(body).toMatchObject({ kind: 'downgrade', plan: 'solo', effectiveAt: END.toISOString(), cap: 1, mustChoose: true });
    expect(body.businesses).toHaveLength(2);
  });

  it('refuses with PLAN_CHECKOUT off, with no subscription, and the legacy plan', async () => {
    const off = harness({ sales: false });
    const u0 = await person(off);
    expect((await read(await u0.send('POST', '/v1/billing/plan-change/preview', { plan: 'business' }))).error.details.reason).toBe('PLAN_CHECKOUT_OFF');
    const h = harness();
    const u = await person(h);
    expect((await read(await u.send('POST', '/v1/billing/plan-change/preview', { plan: 'business' }))).error.details.reason).toBe('NOT_SUBSCRIBED');
    await subscribed(h, u.userId, 'FREELANCER');
    expect((await read(await u.send('POST', '/v1/billing/plan-change/preview', { plan: 'business' }))).error.details.reason).toBe('LEGACY_PLAN');
  });
});

describe('POST /v1/billing/plan-change', () => {
  it('upgrade: charged at the previewed date with the item’s tax rates, recorded APPLIED, audited', async () => {
    const h = harness();
    const u = await person(h);
    const { id } = await subscribed(h, u.userId, 'SOLO', { taxRateIds: ['txr_il_vat'] });
    const res = await u.send('POST', '/v1/billing/plan-change', { plan: 'business', prorationAt: NOW.toISOString(), expectedAmountDue: 27100 });
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body).toMatchObject({ state: 'applied', change: { kind: 'UPGRADE', state: 'APPLIED', fromPlan: 'solo', toPlan: 'business', amountMinor: 27100, currency: 'ILS' }, hostedInvoiceUrl: null });
    expect(h.plan.planChanges).toEqual([{ subscriptionId: id, customer: expect.any(String), itemId: `si_${id}`, yearlyPriceId: 'price_business_m_ils', prorationDate: NOW, taxRates: ['txr_il_vat'], plan: 'business' }]);
    expect((await h.store.billing.planChangesOf(u.userId))[0]).toMatchObject({ kind: 'UPGRADE', state: 'APPLIED', fromTier: 'SOLO', toTier: 'BUSINESS' });
  });

  it('upgrade: a changed amount charges nothing; a bank approval is 202 pending; a failed card is PAYMENT_FAILED', async () => {
    const h = harness();
    const u = await person(h);
    await subscribed(h, u.userId, 'SOLO');
    expect((await read(await u.send('POST', '/v1/billing/plan-change', { plan: 'business', prorationAt: NOW.toISOString(), expectedAmountDue: 1 }))).error.details.reason).toBe('AMOUNT_CHANGED');
    expect(h.plan.planChanges).toEqual([]);
    expect((await read(await u.send('POST', '/v1/billing/plan-change', { plan: 'business', prorationAt: new Date(NOW.getTime() - 20 * 60_000).toISOString(), expectedAmountDue: 27100 }))).error.details.reason).toBe('PREVIEW_EXPIRED');
    h.plan.outcome = { outcome: 'payment-needs-action', hostedInvoiceUrl: 'https://invoice.stripe.com/i/1' };
    const pending = await u.send('POST', '/v1/billing/plan-change', { plan: 'business', prorationAt: NOW.toISOString(), expectedAmountDue: 27100 });
    expect(pending.status).toBe(202);
    expect(await read(pending)).toMatchObject({ state: 'pending', hostedInvoiceUrl: 'https://invoice.stripe.com/i/1', change: { state: 'PENDING' } });
    expect((await read(await u.billing())).pendingChange).toMatchObject({ plan: 'business' });
    h.plan.outcome = { outcome: 'payment-failed' };
    expect((await read(await u.send('POST', '/v1/billing/plan-change', { plan: 'firm', prorationAt: NOW.toISOString(), expectedAmountDue: 27100 }))).error.details.reason).toBe('PAYMENT_FAILED');
  });

  it('downgrade: refused without a pick past the count; with one, a schedule from the period end, kept businesses stored, mailed', async () => {
    const h = harness();
    const u = await person(h);
    const { id } = await subscribed(h, u.userId, 'BUSINESS');
    const a = await business(h, u, 'Studio A');
    await business(h, u, 'Studio B');
    const refused = await u.send('POST', '/v1/billing/plan-change', { plan: 'solo' });
    expect(refused.status).toBe(422);
    expect((await read(refused)).error.details).toMatchObject({ reason: 'ACTIVE_BUSINESSES_REQUIRED', cap: 1 });
    const res = await u.send('POST', '/v1/billing/plan-change', { plan: 'solo', activeBusinessIds: [a] });
    expect(res.status).toBe(200);
    expect(await read(res)).toMatchObject({ state: 'scheduled', change: { kind: 'DOWNGRADE', state: 'SCHEDULED', toPlan: 'solo', effectiveAt: END.toISOString() } });
    expect(h.plan.downgrades).toEqual([{ subscriptionId: id, currentPriceId: 'price_business_m_ils', targetPriceId: 'price_solo_m_ils', interval: 'month', periodEnd: END, plan: 'solo', taxRates: [] }]);
    expect((await h.store.billing.factsFor({ ownerUserIds: [u.userId], organizationIds: [] })).activeBusinesses?.get(u.userId)).toEqual([a]);
    expect(h.outbox.list({ to: u.email }).filter((m) => /changes to Solo/.test(m.subject))).toHaveLength(1);
    const billing = await read(await u.billing());
    expect(billing.scheduledChange).toEqual({ plan: 'solo', at: END.toISOString(), kind: 'DOWNGRADE' });
    // A second change waits for the undo.
    expect((await read(await u.send('POST', '/v1/billing/plan-change/preview', { plan: 'firm' }))).error.details.reason).toBe('SCHEDULE_PENDING');
  });

  it('undo releases the schedule; nothing scheduled is NOTHING_SCHEDULED', async () => {
    const h = harness();
    const u = await person(h);
    await subscribed(h, u.userId, 'BUSINESS');
    expect((await read(await u.send('DELETE', '/v1/billing/plan-change'))).error.details.reason).toBe('NOTHING_SCHEDULED');
    await u.send('POST', '/v1/billing/plan-change', { plan: 'solo' });
    const res = await u.send('DELETE', '/v1/billing/plan-change');
    expect(res.status).toBe(200);
    expect((await read(res)).change.state).toBe('UNDONE');
    expect(h.plan.released).toHaveLength(1);
    expect((await read(await u.billing())).scheduledChange).toBeNull();
  });

  it('to Starter: cancel at the period end and Starter chosen now; undo takes both back', async () => {
    const h = harness();
    const u = await person(h);
    const { id } = await subscribed(h, u.userId, 'SOLO');
    const res = await u.send('POST', '/v1/billing/plan-change', { plan: 'starter' });
    expect(await read(res)).toMatchObject({ state: 'scheduled', change: { kind: 'TO_STARTER', toPlan: 'starter' } });
    expect(h.plan.calls).toContain(`cancel:${id}:other:Moved to Starter (MUT-734)`);
    expect((await h.store.billing.factsFor({ ownerUserIds: [u.userId], organizationIds: [] })).starterChosen?.get(u.userId)).toEqual(NOW);
    await u.send('DELETE', '/v1/billing/plan-change');
    expect(h.plan.calls).toContain(`keep:${id}`);
    expect((await h.store.billing.factsFor({ ownerUserIds: [u.userId], organizationIds: [] })).starterChosen?.get(u.userId) ?? null).toBeNull();
  });
});

describe('the mirror settles plan changes (MUT-734)', () => {
  it('a scheduled downgrade is APPLIED once the subscription’s tier is the target’s', async () => {
    const h = harness();
    const u = await person(h);
    const { id, customer } = await subscribed(h, u.userId, 'BUSINESS');
    await u.send('POST', '/v1/billing/plan-change', { plan: 'solo' });
    h.stripe.products.set('prod_solo', stripeObjects.product('prod_solo', 'solo'));
    h.stripe.customers.set(customer, stripeObjects.customer(customer, { mutaba3a_user_id: u.userId }));
    h.stripe.subscriptions.set(id, stripeObjects.subscription({ id, customer, product: 'prod_solo', currency: 'ils', periodEnd: new Date(END.getTime() + 30 * DAY) }));
    const sync = createStripeSync({ store: h.store, webhookGateway: h.stripe, reconcileGateway: h.stripe, logger: pino({ level: 'silent' }), now: () => new Date(END.getTime() + DAY) });
    await sync.handleEvent({ id: `evt_734_${seq++}`, object: 'event', type: 'customer.subscription.updated', livemode: false, created: 0, data: { object: { id } } } as unknown as Stripe.Event, null);
    expect((await h.store.billing.planChangesOf(u.userId))[0]).toMatchObject({ kind: 'DOWNGRADE', state: 'APPLIED' });
  });
});

describe('PAID_BUSINESS_CAPS (MUT-734, MUT-704 AC1/AC6)', () => {
  it('on: Solo keeps one business active (the rest read-only until picked) and refuses another; off: unlimited as today', async () => {
    const h = harness({ paidBusinessCaps: true });
    const u = await person(h);
    await subscribed(h, u.userId, 'SOLO');
    const a = await business(h, u, 'Studio A');
    const b = await business(h, u, 'Studio B');
    const res = await u.send('POST', '/v1/profiles', { name: 'Studio C', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', type: 'BUSINESS' });
    expect(res.status).toBe(409);
    expect((await read(res)).error).toMatchObject({ code: 'PLAN_LIMIT', details: { limit: 'businesses' } });
    const orgs = await Promise.all([a, b].map(async (id) => ({ organization: (await h.store.organizations.getById(id))!, malafatConnected: false })));
    const states = await entitlementsFor(h.store, orgs, NOW);
    expect([states.get(a)!.state, states.get(b)!.state]).toEqual(['READ_ONLY', 'READ_ONLY']);

    const off = harness();
    const v = await person(off);
    await subscribed(off, v.userId, 'SOLO');
    await business(off, v, 'Studio A');
    expect((await v.send('POST', '/v1/profiles', { name: 'Studio B', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', type: 'BUSINESS' })).status).toBe(201);
  });
});
