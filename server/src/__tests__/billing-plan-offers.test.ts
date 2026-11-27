import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { parseBillingCountries } from '../billing/checkout.js';
import type { CouponFact } from '../billing/offer.js';
import { FakeCheckoutGateway, FakePlanGateway, FakeStripeGateway } from '../billing/stripe/__tests__/fake.js';
import { createMailer } from '../email/mailer.js';
import { MemoryMailTransport } from '../email/transports/memory.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import type { BillingTierRecord } from '../repositories/ports.js';
import { provisionUser } from './helpers/provision.js';

/**
 * MUT-703 (ADR-340): the offers on Solo, Business and Firm through the real app. The launch at a yearly plan Checkout,
 * the come-back on the plan chosen, the stay offer and pause on a plan subscription, the switch line's plan, and what a
 * plan change does with a running discount (spikes S1/S2, §13 Q7). Stripe's doors faked; coupons as the script makes them.
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
const REDEEM_BY = new Date('2027-02-21T22:59:00.000Z');
const COUNTRIES = parseBillingCountries({ consumerCountries: '*', customTaxIdCountries: ['IL', 'JO'], vatRates: { IL: 18 } });
const CHECKOUT = '/v1/billing/checkout-session';
const IL = { country: 'IL', line1: 'Az-Zahra St. 18', city: 'Jerusalem', postalCode: '9100000' };
const JO = { country: 'JO', line1: 'Rainbow St. 12', city: 'Amman', postalCode: '11181' };
const PLAN_PRODUCTS = ['prod_solo', 'prod_business', 'prod_firm'];
const LAUNCH = 'mtb3a_launch_yearly_plans_2026';
const STAY = 'mtb3a_stay_monthly_plans_50';
const COMEBACK = 'mtb3a_comeback_first_month_plans_67';

function percentCoupon(id: string, over: Partial<CouponFact>): CouponFact {
  return { id, valid: true, percentOff: 50, amountOff: null, amountOffIn: { ILS: null, USD: null }, duration: 'once', durationInMonths: null, redeemBy: null, appliesToProducts: PLAN_PRODUCTS, ...over };
}

/** The three plan coupons exactly as `billing:plans` makes them (COUPON_SPEC). */
function withPlanCoupons(checkout: FakeCheckoutGateway, which: { launch?: boolean; stay?: boolean; comeback?: boolean } = {}) {
  if (which.launch !== false) checkout.coupons.set(LAUNCH, percentCoupon(LAUNCH, { redeemBy: REDEEM_BY }));
  if (which.stay !== false) checkout.coupons.set(STAY, percentCoupon(STAY, { duration: 'repeating', durationInMonths: 2 }));
  if (which.comeback !== false) checkout.coupons.set(COMEBACK, percentCoupon(COMEBACK, { percentOff: 67 }));
}

function harness(options: { sales?: boolean } = {}) {
  const store = new MemoryLedgerStore({ starterPlan: true });
  const checkout = new FakeCheckoutGateway().withGaPrices().withPlanPrices();
  const plan = new FakePlanGateway();
  const stripe = new FakeStripeGateway(() => NOW);
  const logger = pino({ level: 'silent' });
  const outbox = new MemoryMailTransport(() => NOW);
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
  return { app, store, checkout, plan };
}
type Harness = ReturnType<typeof harness>;

async function person(h: Harness) {
  const email = `offers${++seq}@studio.ps`;
  const created = await provisionUser(h.app, { email, displayName: 'Rana Saleh', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', locale: 'en' });
  const res = await h.app.request('/v1/sessions', { method: 'POST', headers: { 'content-type': 'application/json', ...SAME_ORIGIN }, body: JSON.stringify({ email, password: created.password }) });
  const token = new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const headers = { cookie: `${COOKIE}=${token}`, ...SAME_ORIGIN };
  const send = (method: string, path: string, body?: unknown) =>
    h.app.request(path, { method, headers: { ...headers, 'content-type': 'application/json', 'idempotency-key': `idem-key-703-${++seq}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { userId: created.user.id as string, personalId: created.personalProfile.id as string, send, billing: async () => read(await h.app.request('/v1/billing', { headers })) };
}

const checkoutBody = (over: Record<string, unknown> = {}) => ({ interval: 'year', country: 'IL', buyer: 'person', returnPath: '/', plan: 'business', address: IL, ...over });

const KEY: Record<string, string> = { SOLO: "solo_list_monthly_ils", BUSINESS: "business_list_monthly_ils", FIRM: "firm_list_monthly_ils", FREELANCER: "freelancer_list_monthly_ils" };
const MONTHLY: Record<string, number> = { SOLO: 3900, BUSINESS: 8900, FIRM: 24900, FREELANCER: 2900 };

/** A live monthly plan subscription, mirrored and as Stripe holds it. */
async function subscribed(h: Harness, userId: string, tier: BillingTierRecord, live: { discounted?: boolean; couponIds?: string[]; discountIds?: string[]; managedBySchedule?: boolean } = {}) {
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
    priceLookupKey: KEY[tier]!,
    founderUntil: null,
    offerId: null,
    stripeUpdatedAt: NOW,
    at: NOW,
    audit: { profileIds: [], source: 'webhook', eventId: null, requestId: null },
  });
  const plan = tier.toLowerCase();
  h.plan.withPlan(id, customer, {
    lookupKey: KEY[tier]!,
    currentPeriodEnd: END,
    price: { id: `price_${plan}_m_ils`, currency: 'ils', productId: `prod_${plan}`, unitAmount: MONTHLY[tier]!, taxBehavior: 'exclusive' },
    discounted: live.discounted ?? false,
    couponIds: live.couponIds ?? [],
    discountIds: live.discountIds ?? [],
    managedBySchedule: live.managedBySchedule ?? false,
  });
  return { id, customer };
}

/** A paid plan Stripe ended 35 days ago, mirrored, with the come-back mail's record (what opens the offer). */
async function lapsed(h: Harness, userId: string, tier: BillingTierRecord) {
  const customer = `cus_${++seq}`;
  const sub = `sub_${++seq}`;
  const endedAt = new Date(NOW.getTime() - 35 * DAY);
  await h.store.billing.saveAccount({ stripeCustomerId: customer, userId, country: 'IL', currency: 'ILS', at: NOW, linkAudit: [] });
  await h.store.billing.saveSubscription({ stripeCustomerId: customer, stripeSubscriptionId: sub, tier, organizationId: null, status: 'canceled', currentPeriodEnd: endedAt, cancelAtPeriodEnd: false, priceLookupKey: KEY[tier] ?? 'freelancer_list_monthly_ils', founderUntil: null, endedAt, stripeUpdatedAt: NOW, at: NOW, audit: { profileIds: [], source: 'webhook', eventId: null, requestId: null } });
  await h.store.billing.claimRetentionEvent({ userId, stripeSubscriptionId: sub, kind: 'COMEBACK_OFFERED', reason: 'day-30', months: null, startsAt: null, endsAt: null, at: NOW });
  h.checkout.stripeSubscriptions.set(customer, [{ status: 'canceled', currentPeriodEnd: endedAt }]);
  return customer;
}

const billingAudit = async (h: Harness, organizationId: string) =>
  (await h.store.audit.list(organizationId, {}, { limit: 50, cursor: null })).items.filter((e) => e.action.startsWith('billing.'));

describe('GET /v1/billing with the plans on sale (MUT-703 §5)', () => {
  it('each plan carries its launch: the first year per currency after 50% (Stripe’s rounding); `offer` is the plans’ launch, priced on Solo', async () => {
    const h = harness();
    withPlanCoupons(h.checkout);
    const billing = await (await person(h)).billing();
    expect(billing.plans.map((p: Loose) => [p.plan, p.launch, p.comeback])).toEqual([
      ['solo', { id: 'launch-plans-2026', firstYear: { ILS: 19500, USD: 6000 } }, null],
      ['business', { id: 'launch-plans-2026', firstYear: { ILS: 44500, USD: 13500 } }, null],
      ['firm', { id: 'launch-plans-2026', firstYear: { ILS: 124500, USD: 37500 } }, null],
    ]);
    expect(billing.offer).toEqual({ id: 'launch-plans-2026', percentOff: 50, endsAt: '2027-02-21T21:59:00.000Z', interval: 'year', eligible: true, firstYear: { ILS: 19500, USD: 6000 } });
    // The legacy coupon is never read for the plans.
    expect(h.checkout.couponReads.every((r) => r.endsWith(LAUNCH))).toBe(true);
  });

  it('no coupon, or the legacy-shaped one restricted to Freelancer: no launch anywhere, and GET still answers', async () => {
    const h = harness();
    h.checkout.withLaunchCoupon(REDEEM_BY, LAUNCH);
    const billing = await (await person(h)).billing();
    expect(billing.plans.map((p: Loose) => p.launch)).toEqual([null, null, null]);
    expect(billing.offer).toBeNull();
  });

  it('PLAN_CHECKOUT off: the legacy launch offer as before, no plans', async () => {
    const h = harness({ sales: false });
    h.checkout.withLaunchCoupon(REDEEM_BY);
    withPlanCoupons(h.checkout);
    const billing = await (await person(h)).billing();
    expect(billing.offer).toMatchObject({ id: 'launch-2026', firstYear: { ILS: 19500, USD: 5000 } });
    expect(billing.plans).toEqual([]);
  });

  it('a lapsed Firm payer the mail offered it to: each plan’s first month back (monthly only), and `comeback` names Firm at 67%', async () => {
    const h = harness();
    withPlanCoupons(h.checkout);
    const u = await person(h);
    await lapsed(h, u.userId, 'FIRM');
    const billing = await u.billing();
    expect(billing.plans.map((p: Loose) => [p.plan, p.comeback])).toEqual([
      ['solo', { id: 'comeback-plans-2026', firstMonth: { ILS: 1287, USD: 396 }, listMonth: { ILS: 3900, USD: 1200 }, firstYear: null, listYear: null }],
      ['business', { id: 'comeback-plans-2026', firstMonth: { ILS: 2937, USD: 891 }, listMonth: { ILS: 8900, USD: 2700 }, firstYear: null, listYear: null }],
      ['firm', { id: 'comeback-plans-2026', firstMonth: { ILS: 8217, USD: 2475 }, listMonth: { ILS: 24900, USD: 7500 }, firstYear: null, listYear: null }],
    ]);
    expect(billing.comeback).toEqual({
      id: 'comeback-plans-2026',
      plan: 'firm',
      percentOff: 67,
      firstMonth: { ILS: 8217, USD: 2475 },
      listMonth: { ILS: 24900, USD: 7500 },
      firstYear: { ILS: null, USD: null },
      listYear: { ILS: null, USD: null },
    });
    // Someone who paid before never gets the launch (§13 Q6).
    expect(billing.offer.eligible).toBe(false);
  });

  it('a legacy Freelancer lapser is offered Solo (§13 Q5)', async () => {
    const h = harness();
    withPlanCoupons(h.checkout);
    const u = await person(h);
    await lapsed(h, u.userId, 'FREELANCER');
    expect((await u.billing()).comeback).toMatchObject({ plan: 'solo', firstMonth: { ILS: 1287, USD: 396 } });
  });

  it('a plan subscription renews at its list price, and the switch line names its plan with its own saving', async () => {
    const h = harness();
    const u = await person(h);
    await subscribed(h, u.userId, 'BUSINESS');
    const billing = await u.billing();
    expect(billing.subscription.renewsAtListPrice).toBe(true);
    // Business: twelve ₪89 months less ₪890 a year.
    expect(billing.yearlySwitch).toEqual({ plan: 'business', currency: 'ILS', savings: 17800 });
  });
});

describe('POST /v1/billing/checkout-session for a plan, with offers (MUT-703 §3.4)', () => {
  it.each([
    ['solo', 'IL', IL, 'price_solo_y_ils', '₪195', '₪390'],
    ['business', 'IL', IL, 'price_business_y_ils', '₪445', '₪890'],
    ['firm', 'JO', JO, 'price_firm_y_usd', '$375', '$750'],
  ] as const)('yearly %s carries the plans’ launch coupon, its metadata and the pay-page line; audited with the offer', async (plan, country, address, price, first, list) => {
    const h = harness();
    withPlanCoupons(h.checkout);
    const u = await person(h);
    const res = await u.send('POST', CHECKOUT, checkoutBody({ plan, country, address, expectedOffer: 'launch-plans-2026' }));
    expect(res.status).toBe(200);
    const session = h.checkout.checkoutSessions.at(-1)!;
    expect((session.line_items as Loose)[0].price).toBe(price);
    expect(session.discounts).toEqual([{ coupon: LAUNCH }]);
    expect(session.subscription_data?.metadata).toMatchObject({ mutaba3a_offer: 'launch-plans-2026', mutaba3a_plan: plan });
    const message = (session.custom_text as Loose)?.submit?.message ?? '';
    expect(message).toContain(`Launch offer: ⁨${first}⁩ for your first year. It then renews at ⁨${list}⁩ a year`);
    // The amounts are before VAT: the note says so.
    expect(message).toContain('Prices exclude VAT');
    expect(h.checkout.couponReads).toContain(`fresh:${LAUNCH}`);
    const audit = await billingAudit(h, u.personalId);
    expect(audit[0]!.metadata).toMatchObject({ plan, interval: 'year', offer: 'launch-plans-2026' });
  });

  it('monthly carries no launch (§13 Q2)', async () => {
    const h = harness();
    withPlanCoupons(h.checkout);
    const u = await person(h);
    expect((await u.send('POST', CHECKOUT, checkoutBody({ interval: 'month' }))).status).toBe(200);
    expect(h.checkout.checkoutSessions.at(-1)!.discounts).toBeUndefined();
    expect((await billingAudit(h, u.personalId))[0]!.metadata).toMatchObject({ offer: null });
  });

  it('the coupon ended after the drawer showed it: 409 OFFER_ENDED, no Checkout; asked again, full price', async () => {
    const h = harness();
    withPlanCoupons(h.checkout, { launch: false });
    const u = await person(h);
    const res = await u.send('POST', CHECKOUT, checkoutBody({ expectedOffer: 'launch-plans-2026' }));
    expect(res.status).toBe(409);
    expect((await read(res)).error.details).toEqual({ reason: 'OFFER_ENDED', offer: 'launch-plans-2026' });
    expect(h.checkout.checkoutSessions).toHaveLength(0);
    expect((await u.send('POST', CHECKOUT, checkoutBody())).status).toBe(200);
    expect(h.checkout.checkoutSessions.at(-1)!.discounts).toBeUndefined();
  });

  it('Stripe holding a subscription that took money: full price (the mirror can be late)', async () => {
    const h = harness();
    withPlanCoupons(h.checkout);
    const u = await person(h);
    await h.store.billing.saveAccount({ stripeCustomerId: 'cus_paid', userId: u.userId, country: 'IL', currency: 'ILS', at: NOW, linkAudit: [] });
    h.checkout.stripeSubscriptions.set('cus_paid', [{ status: 'canceled', currentPeriodEnd: new Date(NOW.getTime() - 100 * DAY) }]);
    expect((await u.send('POST', CHECKOUT, checkoutBody())).status).toBe(200);
    expect(h.checkout.checkoutSessions.at(-1)!.discounts).toBeUndefined();
  });

  it('a Solo trial cancelled before it paid doesn’t use the launch up (§13 Q6)', async () => {
    const h = harness();
    withPlanCoupons(h.checkout);
    const u = await person(h);
    await h.store.billing.saveAccount({ stripeCustomerId: 'cus_trial', userId: u.userId, country: 'IL', currency: 'ILS', at: NOW, linkAudit: [] });
    const trialEnd = new Date(NOW.getTime() - 10 * DAY);
    h.checkout.stripeSubscriptions.set('cus_trial', [{ status: 'canceled', currentPeriodEnd: trialEnd, trialEnd, endedAt: trialEnd } as Loose]);
    expect((await u.send('POST', CHECKOUT, checkoutBody())).status).toBe(200);
    expect(h.checkout.checkoutSessions.at(-1)!.discounts).toEqual([{ coupon: LAUNCH }]);
  });

  it('a lapsed payer the mail offered it to: a monthly Checkout on the plan they pick carries the come-back coupon; yearly doesn’t (§13 Q4)', async () => {
    const h = harness();
    withPlanCoupons(h.checkout);
    const u = await person(h);
    await lapsed(h, u.userId, 'SOLO');
    const res = await u.send('POST', CHECKOUT, checkoutBody({ plan: 'business', interval: 'month', expectedOffer: 'comeback-plans-2026' }));
    expect(res.status).toBe(200);
    const session = h.checkout.checkoutSessions.at(-1)!;
    expect(session.discounts).toEqual([{ coupon: COMEBACK }]);
    expect(session.subscription_data?.metadata).toMatchObject({ mutaba3a_offer: 'comeback-plans-2026' });
    expect((session.custom_text as Loose)?.submit?.message).toContain('Welcome-back offer: ⁨₪29.37⁩ for your first month, then ⁨₪89⁩ a month.');
    expect((await u.send('POST', CHECKOUT, checkoutBody({ plan: 'business', interval: 'year' }))).status).toBe(200);
    expect(h.checkout.checkoutSessions.at(-1)!.discounts).toBeUndefined();
  });

  it('already had a come-back (the legacy one counts): full price', async () => {
    const h = harness();
    withPlanCoupons(h.checkout);
    const u = await person(h);
    const customer = await lapsed(h, u.userId, 'FREELANCER');
    h.checkout.stripeSubscriptions.set(customer, [{ status: 'canceled', currentPeriodEnd: NOW, offerId: 'comeback-2026' }]);
    expect((await u.send('POST', CHECKOUT, checkoutBody({ interval: 'month' }))).status).toBe(200);
    expect(h.checkout.checkoutSessions.at(-1)!.discounts).toBeUndefined();
  });
});

describe('the cancel flow and the switch on a plan subscription (MUT-703 AC2, AC4)', () => {
  it.each([
    ['SOLO', 1950, 3900],
    ['BUSINESS', 4450, 8900],
    ['FIRM', 12450, 24900],
  ] as const)('%s monthly: the stay step offers the plans’ coupon on its own price, pause is open, and taking it applies that coupon', async (tier, monthlyAmount, listAmount) => {
    const h = harness();
    withPlanCoupons(h.checkout);
    const u = await person(h);
    const { id } = await subscribed(h, u.userId, tier);
    const retention = await read(await u.send('GET', '/v1/billing/retention'));
    expect(retention.stayOffer).toEqual({ percentOff: 50, months: 2, currency: 'ILS', monthlyAmount, listAmount });
    expect(retention.pause.options).toHaveLength(3);
    const res = await u.send('POST', '/v1/billing/stay-offer', { reason: 'too_expensive' });
    expect(res.status).toBe(200);
    expect(h.plan.writes).toContain(`coupon:${id}:${STAY}`);
  });

  it('a legacy ₪29 payer keeps the legacy stay coupon (AC5)', async () => {
    const h = harness();
    h.checkout.withStayCoupon();
    withPlanCoupons(h.checkout);
    const u = await person(h);
    const { id } = await subscribed(h, u.userId, 'FREELANCER');
    h.plan.withPlan(id, (await h.plan.planOf(id)).customer, { lookupKey: 'freelancer_list_monthly_ils', currentPeriodEnd: END });
    const retention = await read(await u.send('GET', '/v1/billing/retention'));
    expect(retention.stayOffer).toMatchObject({ monthlyAmount: 1950, listAmount: 3900 });
    // The legacy coupon, never the plans'.
    expect(h.checkout.couponReads).toContain('cached:mtb3a_stay_monthly_50');
    expect(h.checkout.couponReads.some((r) => r.endsWith(STAY))).toBe(false);
  });

  it('while a downgrade waits on a schedule, stay, pause and the switch are refused SCHEDULED', async () => {
    const h = harness();
    withPlanCoupons(h.checkout);
    const u = await person(h);
    await subscribed(h, u.userId, 'BUSINESS', { managedBySchedule: true });
    const stay = await u.send('POST', '/v1/billing/stay-offer', { reason: 'too_expensive' });
    expect([stay.status, (await read(stay)).error.details]).toEqual([409, { reason: 'STAY_OFFER_NOT_AVAILABLE', why: 'SCHEDULED' }]);
    const pause = await u.send('POST', '/v1/billing/pause', { months: 1, reason: 'too_expensive' });
    expect([pause.status, (await read(pause)).error.details]).toEqual([409, { reason: 'PAUSE_NOT_AVAILABLE', why: 'SCHEDULED' }]);
    const sw = await u.send('GET', '/v1/billing/yearly-switch');
    expect([sw.status, (await read(sw)).error.details]).toEqual([409, { reason: 'SWITCH_NOT_AVAILABLE', why: 'SCHEDULED' }]);
  });

  it('the switch to yearly previews the plan’s own yearly price', async () => {
    const h = harness();
    const u = await person(h);
    const { id } = await subscribed(h, u.userId, 'FIRM');
    const res = await u.send('GET', '/v1/billing/yearly-switch');
    expect(res.status).toBe(200);
    expect((await read(res)).yearlyAmount).toBe(249000);
    expect(h.plan.calls).toContain(`preview:${id}:price_firm_y_ils`);
  });
});

describe('a plan change and a running offer (MUT-703 §3.7, §13 Q7, spikes S1/S2)', () => {
  it('upgrade during the stay offer: the preview names it and prices without it; the confirm drops it in the same update', async () => {
    const h = harness();
    const u = await person(h);
    const { id } = await subscribed(h, u.userId, 'SOLO', { discounted: true, couponIds: [STAY], discountIds: ['di_stay'] });
    const preview = await read(await u.send('POST', '/v1/billing/plan-change/preview', { plan: 'business' }));
    expect(preview).toMatchObject({ kind: 'upgrade', offerEnds: { id: 'stay-plans-2026', kind: 'stay' } });
    expect(h.plan.previews.at(-1)).toMatchObject({ subscriptionId: id, dropDiscounts: true });
    const res = await u.send('POST', '/v1/billing/plan-change', { plan: 'business', prorationAt: preview.prorationAt, expectedAmountDue: preview.amountDue });
    expect(res.status).toBe(200);
    expect(h.plan.planChanges.at(-1)).toMatchObject({ subscriptionId: id, plan: 'business', dropDiscounts: true });
  });

  it('upgrade with nothing running: offerEnds null, nothing dropped', async () => {
    const h = harness();
    const u = await person(h);
    await subscribed(h, u.userId, 'SOLO');
    const preview = await read(await u.send('POST', '/v1/billing/plan-change/preview', { plan: 'firm' }));
    expect(preview.offerEnds).toBeNull();
    expect(h.plan.previews.at(-1)).toMatchObject({ dropDiscounts: false });
  });

  it('downgrade during the stay offer: the schedule carries the running discount into both phases', async () => {
    const h = harness();
    const u = await person(h);
    const { id } = await subscribed(h, u.userId, 'BUSINESS', { discounted: true, couponIds: [STAY], discountIds: ['di_stay'] });
    const res = await u.send('POST', '/v1/billing/plan-change', { plan: 'solo' });
    expect(res.status).toBe(200);
    expect(h.plan.downgrades.at(-1)).toMatchObject({ subscriptionId: id, targetPriceId: 'price_solo_m_ils', discountIds: ['di_stay'] });
  });
});
