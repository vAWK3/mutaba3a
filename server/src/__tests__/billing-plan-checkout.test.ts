import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp, type AppDependencies } from '../app.js';
import { parseBillingCountries } from '../billing/checkout.js';
import { FakeCheckoutGateway, FakeStripeGateway } from '../billing/stripe/__tests__/fake.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { provisionUser } from './helpers/provision.js';

/**
 * MUT-702 Part B (ADR-286): buying Solo, Business or Firm through the provider port, with the billing address given on
 * the pay path, and the one-time Solo trial. Real app and session auth; Stripe's write door faked.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;

const COOKIE = '__Host-mut_session';
const SAME_ORIGIN = { origin: 'http://localhost' };
const NOW = new Date('2026-11-26T09:00:00Z');
const COUNTRIES = parseBillingCountries({ consumerCountries: '*', customTaxIdCountries: ['IL', 'JO'] });
const CHECKOUT = '/v1/billing/checkout-session';
const IL = { country: 'IL', line1: 'Az-Zahra St. 18', city: 'Jerusalem', postalCode: '9100000' };
const JO = { country: 'JO', line1: 'Rainbow St. 12', city: 'Amman', postalCode: '11181' };

function harness(over: Partial<AppDependencies> & { sales?: boolean } = {}) {
  const store = new MemoryLedgerStore({ starterPlan: true });
  const checkout = new FakeCheckoutGateway().withGaPrices().withPlanPrices();
  const stripe = new FakeStripeGateway(() => NOW);
  const { sales = true, ...rest } = over;
  const app = createApp({
    store,
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: 'test-admin-token-with-at-least-32-characters',
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => NOW,
    sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 60 * 24 * 400, absoluteHours: 24 * 400, secureCookie: true, trustedProxyHops: 1 },
    stripe: { webhookGateway: stripe, reconcileGateway: stripe, checkoutGateway: checkout },
    billingCountries: COUNTRIES,
    planSales: sales,
    ...rest,
  });
  return { app, store, checkout };
}
type Harness = ReturnType<typeof harness>;

async function person(h: Harness) {
  const email = `plans${++seq}@studio.ps`;
  const created = await provisionUser(h.app, { email, displayName: 'Rana Saleh', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', locale: 'ar' });
  const res = await h.app.request('/v1/sessions', { method: 'POST', headers: { 'content-type': 'application/json', ...SAME_ORIGIN }, body: JSON.stringify({ email, password: created.password }) });
  const token = new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const headers = { cookie: `${COOKIE}=${token}`, ...SAME_ORIGIN };
  const get = () => h.app.request('/v1/billing', { headers });
  const post = (path: string, body: unknown) => h.app.request(path, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { get, post, userId: created.user.id as string };
}

const body = (over: Record<string, unknown> = {}) => ({ interval: 'month', country: 'IL', buyer: 'person', returnPath: '/', plan: 'solo', address: IL, ...over });

describe('GET /v1/billing plans (MUT-702 Part B)', () => {
  it('lists the three plans with live prices and limits, and no saved address yet', async () => {
    const h = harness();
    const u = await person(h);
    const billing = await read(await u.get());
    expect(billing.plans).toEqual([
      { plan: 'solo', catalog: { ILS: { month: 3900, year: 39000 }, USD: { month: 1200, year: 12000 } }, limits: { businesses: 1, partners: 0, documentsPerMonth: 50, scansPerMonth: 100 } },
      { plan: 'business', catalog: { ILS: { month: 8900, year: 89000 }, USD: { month: 2700, year: 27000 } }, limits: { businesses: 3, partners: 2, documentsPerMonth: 250, scansPerMonth: 500 } },
      { plan: 'firm', catalog: { ILS: { month: 24900, year: 249000 }, USD: { month: 7500, year: 75000 } }, limits: { businesses: 6, partners: 2, documentsPerMonth: 1000, scansPerMonth: 2000 } },
    ]);
    expect(billing.billingAddress).toBeNull();
    expect(billing.currentPlan).toBe('starter');
  });

  it('is empty with PLAN_CHECKOUT off', async () => {
    const h = harness({ sales: false });
    expect((await read(await (await person(h)).get())).plans).toEqual([]);
  });

  it('prefills a returning payer’s form from the address saved on their billing account', async () => {
    const h = harness();
    const u = await person(h);
    await u.post(CHECKOUT, body());
    // The webhook links the customer once a Checkout is paid; before that there is nothing to prefill from.
    expect((await read(await u.get())).billingAddress).toBeNull();
    const customer = String(h.checkout.checkoutSessions.at(-1)!.customer);
    await h.store.billing.saveAccount({ stripeCustomerId: customer, userId: u.userId, country: 'IL', currency: 'ILS', at: NOW, linkAudit: [] });
    expect((await read(await u.get())).billingAddress).toEqual(IL);
  });
});

describe('POST /v1/billing/checkout-session for a plan (MUT-702 Part B)', () => {
  it('Solo with an Israeli address: ILS, the address saved first, plan and seller named', async () => {
    const h = harness();
    const u = await person(h);
    const res = await u.post(CHECKOUT, body());
    expect(res.status).toBe(200);
    expect((await read(res)).url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    const session = h.checkout.checkoutSessions.at(-1)!;
    expect(session.line_items).toEqual([{ price: 'price_solo_m_ils', quantity: 1 }]);
    expect(session.metadata).toEqual({ mutaba3a_plan: 'solo', mutaba3a_seller: 'barmajiyat' });
    expect(session.customer_update).toEqual({ address: 'never', name: 'auto' });
    const customer = String(session.customer);
    expect(h.checkout.addresses.get(customer)).toEqual(IL);
    expect(h.checkout.calls.indexOf(`address:${customer}`)).toBeLessThan(h.checkout.calls.lastIndexOf(`checkout:${customer}`));
  });

  it('Business yearly with a Jordanian address is USD', async () => {
    const h = harness();
    const u = await person(h);
    expect((await u.post(CHECKOUT, body({ plan: 'business', interval: 'year', country: 'JO', address: JO }))).status).toBe(200);
    expect(h.checkout.checkoutSessions.at(-1)!.line_items).toEqual([{ price: 'price_business_y_usd', quantity: 1 }]);
  });

  it('a plan needs an address whose country is the request’s', async () => {
    const h = harness();
    const u = await person(h);
    const { address: _a, ...noAddress } = body();
    void _a;
    const missing = await u.post(CHECKOUT, noAddress);
    expect(missing.status).toBe(422);
    expect((await read(missing)).error.details).toMatchObject({ reason: 'ADDRESS_INVALID' });
    const mismatch = await u.post(CHECKOUT, body({ country: 'JO' }));
    expect(mismatch.status).toBe(422);
    expect((await read(mismatch)).error.details).toMatchObject({ reason: 'ADDRESS_INVALID' });
    expect((await u.post(CHECKOUT, body({ address: { ...IL, city: '  ' } }))).status).toBe(422);
    expect(h.checkout.checkoutSessions).toHaveLength(0);
  });

  it('with PLAN_CHECKOUT off a plan is refused 409 PLAN_CHECKOUT_OFF; the Freelancer Checkout still works', async () => {
    const h = harness({ sales: false });
    const u = await person(h);
    const res = await u.post(CHECKOUT, body());
    expect(res.status).toBe(409);
    expect((await read(res)).error.details).toMatchObject({ reason: 'PLAN_CHECKOUT_OFF' });
    const { plan: _p, address: _a, ...legacy } = body();
    void _p;
    void _a;
    expect((await u.post(CHECKOUT, legacy)).status).toBe(200);
  });

  it('a live subscription is ALREADY_SUBSCRIBED, as for Freelancer (moving plans is MUT-734)', async () => {
    const h = harness();
    const u = await person(h);
    await u.post(CHECKOUT, body());
    const customer = String(h.checkout.checkoutSessions.at(-1)!.customer);
    h.checkout.stripeSubscriptions.set(customer, [{ status: 'active', currentPeriodEnd: new Date(NOW.getTime() + 20 * 86_400_000) }]);
    const res = await u.post(CHECKOUT, body({ plan: 'business' }));
    expect(res.status).toBe(409);
    expect((await read(res)).error.details).toMatchObject({ reason: 'ALREADY_SUBSCRIBED' });
  });

  it('expires the person’s other open profile-plan Checkouts, so two tabs can’t buy two plans', async () => {
    const h = harness();
    const u = await person(h);
    await u.post(CHECKOUT, body());
    await u.post(CHECKOUT, body({ plan: 'firm' }));
    expect(h.checkout.expiredCheckouts).toBe(1);
  });
});

describe('the one-time Solo trial at Checkout (MUT-702 Part B, MUT-731 Q7)', () => {
  const SINCE = new Date('2026-11-01T00:00:00Z');

  it('once offered on the web, Try Solo opens a 14-day trial with a card required', async () => {
    const h = harness({ soloTrialOfferSince: SINCE });
    const u = await person(h);
    await u.post('/v1/billing/solo-trial/offered', {});
    const res = await u.post(CHECKOUT, body({ trial: true }));
    expect(res.status).toBe(200);
    const session = h.checkout.checkoutSessions.at(-1)!;
    expect(session.payment_method_collection).toBe('always');
    expect(session.subscription_data).toMatchObject({ trial_period_days: 14, metadata: { mutaba3a_trial: 'solo' } });
  });

  it('is refused 409 TRIAL_NOT_OFFERED before it was offered, for another plan, or with the switch unset', async () => {
    const offered = harness({ soloTrialOfferSince: SINCE });
    const u = await person(offered);
    const before = await u.post(CHECKOUT, body({ trial: true }));
    expect(before.status).toBe(409);
    expect((await read(before)).error.details).toMatchObject({ reason: 'TRIAL_NOT_OFFERED' });
    await u.post('/v1/billing/solo-trial/offered', {});
    const business = await u.post(CHECKOUT, body({ plan: 'business', trial: true }));
    expect(business.status).toBe(409);
    const off = harness();
    const v = await person(off);
    expect((await v.post(CHECKOUT, body({ trial: true }))).status).toBe(409);
    expect(offered.checkout.checkoutSessions).toHaveLength(0);
  });

  it('is refused once used', async () => {
    const h = harness({ soloTrialOfferSince: SINCE });
    const u = await person(h);
    await u.post('/v1/billing/solo-trial/offered', {});
    await h.store.billing.markPaidTrialUsed(u.userId, NOW);
    expect((await u.post(CHECKOUT, body({ trial: true }))).status).toBe(409);
  });
});
