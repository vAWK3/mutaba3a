import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp, type AppDependencies } from '../app.js';
import { parseBillingCountries } from '../billing/checkout.js';
import { FakeCheckoutGateway, FakeStripeGateway } from '../billing/stripe/__tests__/fake.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { provisionUser } from './helpers/provision.js';

/**
 * MUT-362 (plan §2.4, ADR-170): GET /v1/billing, POST /v1/billing/checkout-session and POST /v1/billing/portal-session
 * through the real app and session auth, with Stripe's write door faked. Person-level: no X-Mutaba3a-Profile anywhere.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;

const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const COOKIE = '__Host-mut_session';
const SAME_ORIGIN = { origin: 'http://localhost' };
const NOW = new Date('2026-11-01T09:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const COUNTRIES = parseBillingCountries({ consumerCountries: ['IL', 'GB'], customTaxIdCountries: ['IL', 'JO'] });

function harness(overrides: Partial<AppDependencies> & { stripeOff?: boolean; noPrices?: boolean } = {}) {
  const store = new MemoryLedgerStore();
  const checkout = new FakeCheckoutGateway();
  if (!overrides.noPrices) checkout.withGaPrices();
  const stripe = new FakeStripeGateway(() => NOW);
  const logs: string[] = [];
  const app = createApp({
    store,
    logger: pino({ level: 'info' }, { write: (line: string) => void logs.push(line) }),
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.1.0-test',
    now: () => NOW,
    sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 60 * 24 * 400, absoluteHours: 24 * 400, secureCookie: true, trustedProxyHops: 1 },
    stripe: overrides.stripeOff ? null : { webhookGateway: stripe, reconcileGateway: stripe, checkoutGateway: checkout },
    billingCountries: COUNTRIES,
    ...overrides,
  });
  return { app, store, checkout, logs };
}
type Harness = ReturnType<typeof harness>;

async function person(h: Harness) {
  const email = `billing${++seq}@studio.ps`;
  const created = await provisionUser(h.app, { email, displayName: 'Rana Saleh', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', locale: 'ar' });
  const res = await h.app.request('/v1/sessions', { method: 'POST', headers: { 'content-type': 'application/json', ...SAME_ORIGIN }, body: JSON.stringify({ email, password: created.password }) });
  const token = new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const headers = { cookie: `${COOKIE}=${token}`, ...SAME_ORIGIN };
  const get = () => h.app.request('/v1/billing', { headers });
  const post = (path: string, body: unknown) => h.app.request(path, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { get, post, email, password: created.password as string, userId: created.user.id as string, personalId: created.personalProfile.id as string };
}

/** The person's session headers again (the harness's `person` keeps them private). */
async function sessionHeaders(h: Harness, u: { email: string }) {
  const res = await h.app.request('/v1/sessions', { method: 'POST', headers: { 'content-type': 'application/json', ...SAME_ORIGIN }, body: JSON.stringify({ email: u.email, password: (u as Loose).password }) });
  const token = new RegExp(`${COOKIE}=([^;]*)`).exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
  return { cookie: `${COOKIE}=${token}`, ...SAME_ORIGIN };
}

const checkoutBody = (over: Record<string, unknown> = {}) => ({ interval: 'month', country: 'IL', buyer: 'person', returnPath: '/', ...over });
const CHECKOUT = '/v1/billing/checkout-session';
const PORTAL = '/v1/billing/portal-session';

async function linkSubscription(h: Harness, userId: string, status = 'active', lookupKey = 'freelancer_list_monthly_ils', periodEnd = new Date(NOW.getTime() + 20 * DAY), existing?: string) {
  const customer = existing ?? `cus_${++seq}`;
  await h.store.billing.saveAccount({ stripeCustomerId: customer, userId, country: 'IL', currency: 'ILS', at: NOW, linkAudit: [] });
  await h.store.billing.saveSubscription({
    stripeCustomerId: customer,
    stripeSubscriptionId: `sub_${++seq}`,
    tier: 'FREELANCER',
    organizationId: null,
    status,
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: false,
    priceLookupKey: lookupKey,
    founderUntil: null,
    stripeUpdatedAt: NOW,
    at: NOW,
    audit: { profileIds: [], source: 'webhook', eventId: null, requestId: null },
  });
  return customer;
}
const billingAudit = async (h: Harness, organizationId: string) =>
  (await h.store.audit.list(organizationId, {}, { limit: 50, cursor: null })).items.filter((e) => e.action.startsWith('billing.'));

describe('GET /v1/billing (MUT-362)', () => {
  it('signed out is 401; signed in needs no profile header', async () => {
    const h = harness();
    expect((await h.app.request('/v1/billing')).status).toBe(401);
    const u = await person(h);
    const res = await u.get();
    expect(res.status).toBe(200);
    expect(await read(res)).toEqual({
      configured: true,
      subscription: null,
      canManage: false,
      trial: null,
      catalog: { ILS: { month: 3900, year: 39000 }, USD: { month: 1000, year: 10000 } },
      countries: { consumer: ['IL', 'GB'], customTaxId: ['IL', 'JO'] },
      coveredProfileIds: [u.personalId],
    });
  });

  it('a live subscription wins over a cancelled one with a later period end (review: never strand a payer)', async () => {
    const h = harness();
    const u = await person(h);
    const customer = await linkSubscription(h, u.userId, 'canceled', 'freelancer_list_yearly_ils', new Date(NOW.getTime() + 300 * DAY));
    await linkSubscription(h, u.userId, 'active', 'freelancer_list_monthly_ils', new Date(NOW.getTime() + 5 * DAY), customer);
    expect((await read(await u.get())).subscription).toMatchObject({ status: 'active', interval: 'month' });
  });

  it('lists only the profiles a payment would cover: the ones the person created (review D4, TD-193)', async () => {
    const h = harness();
    const owner = await person(h);
    const coOwner = await person(h);
    const shared = await h.app.request('/v1/profiles', {
      method: 'POST',
      headers: { ...(await sessionHeaders(h, owner)), 'content-type': 'application/json', 'idempotency-key': randomUUID() },
      body: JSON.stringify({ name: 'Shared Studio', type: 'BUSINESS', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }),
    });
    expect(shared.status).toBe(201);
    const sharedId = (await read(shared)).id as string;
    const coOwned = await h.app.request(`/admin/v1/users/${coOwner.userId}/memberships`, {
      method: 'POST',
      headers: { 'x-admin-token': ADMIN_TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({ organizationId: sharedId, role: 'OWNER' }),
    });
    expect(coOwned.status).toBe(201);
    expect((await read(await owner.get())).coveredProfileIds.sort()).toEqual([owner.personalId, sharedId].sort());
    expect((await read(await coOwner.get())).coveredProfileIds).toEqual([coOwner.personalId]);
  });

  it('shows the trial: its start, end (day 14) and lock date (day 30)', async () => {
    const h = harness();
    const u = await person(h);
    await h.store.billing.setTrialStart(u.userId, new Date(NOW.getTime() - 5 * DAY));
    expect((await read(await u.get())).trial).toEqual({
      startedAt: new Date(NOW.getTime() - 5 * DAY).toISOString(),
      endsAt: new Date(NOW.getTime() + 9 * DAY).toISOString(),
      lockAt: new Date(NOW.getTime() + 25 * DAY).toISOString(),
    });
  });

  it('shows the person’s subscription and that they can manage it', async () => {
    const h = harness();
    const u = await person(h);
    await linkSubscription(h, u.userId, 'active', 'freelancer_list_yearly_ils');
    const body = await read(await u.get());
    expect(body.canManage).toBe(true);
    expect(body.subscription).toEqual({
      tier: 'FREELANCER',
      status: 'active',
      interval: 'year',
      currency: 'ILS',
      currentPeriodEnd: new Date(NOW.getTime() + 20 * DAY).toISOString(),
      cancelAtPeriodEnd: false,
    });
  });

  it('a server without Stripe answers configured: false and no catalog', async () => {
    const h = harness({ stripeOff: true });
    const u = await person(h);
    expect(await read(await u.get())).toMatchObject({ configured: false, catalog: { ILS: null, USD: null } });
  });

  it('Stripe failing on the price lookup still opens the drawer: catalog null, warn logged', async () => {
    const h = harness();
    const u = await person(h);
    h.checkout.failPricesNext();
    const res = await u.get();
    expect(res.status).toBe(200);
    expect(await read(res)).toMatchObject({ configured: true, catalog: { ILS: null, USD: null } });
    expect(h.logs.some((l) => l.includes('"level":40') && l.includes('billing catalog'))).toBe(true);
  });
});

describe('POST /v1/billing/checkout-session (MUT-362)', () => {
  it('a person in Israel gets a Checkout URL for a customer created with their id, and it is audited', async () => {
    const h = harness();
    const u = await person(h);
    const res = await u.post(CHECKOUT, checkoutBody({ returnPath: `/p/${u.personalId}` }));
    expect(res.status).toBe(200);
    expect(await read(res)).toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    expect(h.checkout.calls).toEqual(['prices', `customer:${u.userId}`, 'subscriptions:cus_new_1', 'expire:cus_new_1', 'checkout:cus_new_1']);
    const params = h.checkout.checkoutSessions[0]!;
    expect(params).toMatchObject({
      customer: 'cus_new_1',
      client_reference_id: u.userId,
      line_items: [{ price: 'price_freelancer_list_monthly_ils', quantity: 1 }],
      success_url: `http://localhost/p/${u.personalId}?billing=true&checkout=success`,
    });
    const audit = await billingAudit(h, u.personalId);
    expect(audit.map((e) => [e.action, e.actorType, e.actorId])).toEqual([['billing.checkout_started', 'USER', u.userId]]);
    expect(audit[0]!.metadata).toEqual({ interval: 'month', currency: 'ILS', buyer: 'person', country: 'IL' });
  });

  it('a person with a linked customer reuses it, never creating another (MUT-360 OV-7)', async () => {
    const h = harness();
    const u = await person(h);
    const customer = await linkSubscription(h, u.userId, 'canceled');
    expect((await u.post(CHECKOUT, checkoutBody())).status).toBe(200);
    expect(h.checkout.calls).toEqual(['prices', `subscriptions:${customer}`, `expire:${customer}`, `checkout:${customer}`]);
  });

  it('asks Stripe itself: a paid subscription the webhook hasn’t mirrored yet is ALREADY_SUBSCRIBED (review: no double charge)', async () => {
    const h = harness();
    const u = await person(h);
    const customer = await linkSubscription(h, u.userId, 'canceled');
    h.checkout.stripeSubscriptions.set(customer, [{ status: 'active', currentPeriodEnd: new Date(NOW.getTime() + 30 * DAY) }]);
    const res = await u.post(CHECKOUT, checkoutBody());
    expect(res.status).toBe(409);
    expect((await read(res)).error).toMatchObject({ code: 'CONFLICT', details: { reason: 'ALREADY_SUBSCRIBED' } });
    expect(h.checkout.checkoutSessions).toEqual([]);
  });

  it('a second Checkout expires the first, so two tabs can’t both be paid', async () => {
    const h = harness();
    const u = await person(h);
    expect((await u.post(CHECKOUT, checkoutBody())).status).toBe(200);
    expect((await u.post(CHECKOUT, checkoutBody())).status).toBe(200);
    expect(h.checkout.expiredCheckouts).toBe(1);
    expect(h.checkout.openCheckouts.get('cus_new_1')).toBe(1);
  });

  it('subscribing during the trial keeps the rest of it: Stripe first charges on the trial end (review D2)', async () => {
    const h = harness();
    const u = await person(h);
    await h.store.billing.setTrialStart(u.userId, new Date(NOW.getTime() - 4 * DAY));
    expect((await u.post(CHECKOUT, checkoutBody())).status).toBe(200);
    expect(h.checkout.checkoutSessions[0]!.subscription_data).toEqual({
      metadata: { mutaba3a_user_id: u.userId },
      trial_end: Math.floor((NOW.getTime() + 10 * DAY) / 1000),
    });
  });

  it('a person whose only profile is covered by Malafat is COVERED_BY_MALAFAT, before any Stripe call', async () => {
    const h = harness();
    const u = await person(h);
    await h.store.integrations.connect({ organizationId: u.personalId, provider: 'MALAFAT', externalTenantId: `t-${++seq}`, displayName: 'Firm', connectedByApiKeyId: null, at: NOW } as Loose);
    const res = await u.post(CHECKOUT, checkoutBody());
    expect((await read(res)).error).toMatchObject({ code: 'CONFLICT', details: { reason: 'COVERED_BY_MALAFAT' } });
    expect(h.checkout.calls).toEqual([]);
  });

  it('a stale mirror row (period over by more than the grace) no longer blocks paying', async () => {
    const h = harness();
    const u = await person(h);
    await linkSubscription(h, u.userId, 'active', 'freelancer_list_monthly_ils', new Date(NOW.getTime() - 9 * DAY));
    expect((await u.post(CHECKOUT, checkoutBody())).status).toBe(200);
  });

  it.each([
    ['active', 'ALREADY_SUBSCRIBED'],
    ['unpaid', 'RESUME_IN_PORTAL'],
    ['paused', 'CONTACT_US'],
  ])('a %s subscription is 409 CONFLICT with reason %s', async (status, reason) => {
    const h = harness();
    const u = await person(h);
    await linkSubscription(h, u.userId, status);
    const res = await u.post(CHECKOUT, checkoutBody());
    expect(res.status).toBe(409);
    expect((await read(res)).error).toMatchObject({ code: 'CONFLICT', details: { reason } });
    expect(h.checkout.checkoutSessions).toEqual([]);
  });

  it('a no-expiry operator grant is COVERED_BY_GRANT (eng review D5)', async () => {
    const h = harness();
    const u = await person(h);
    await h.store.billing.createGrant({ id: randomUUID(), userId: u.userId, organizationId: null, tier: 'FREELANCER', reason: 'pre-billing', expiresAt: null, grantedBy: 'admin', at: NOW, audit: [] });
    const res = await u.post(CHECKOUT, checkoutBody());
    expect((await read(res)).error).toMatchObject({
      code: 'CONFLICT',
      message: 'Your account is covered by MTB3A; there is nothing to pay',
      details: { reason: 'COVERED_BY_GRANT' },
    });
  });

  it('a person outside the consumer countries is 422 COUNTRY_NEEDS_BUSINESS; a business there gets Checkout (AC2)', async () => {
    const h = harness();
    const u = await person(h);
    const refused = await u.post(CHECKOUT, checkoutBody({ country: 'JO' }));
    expect(refused.status).toBe(422);
    expect((await read(refused)).error).toMatchObject({ code: 'VALIDATION_FAILED', details: { reason: 'COUNTRY_NEEDS_BUSINESS' } });
    const business = await u.post(CHECKOUT, checkoutBody({ country: 'JO', buyer: 'business' }));
    expect(business.status).toBe(200);
    expect(h.checkout.checkoutSessions[0]!.custom_fields).toEqual([expect.objectContaining({ key: 'business_tax_number', optional: false })]);
  });

  it('refuses a return path that leaves the portal, and a malformed body', async () => {
    const h = harness();
    const u = await person(h);
    for (const returnPath of ['https://evil.example/', '//evil.example', '/p/not-a-profile']) {
      expect((await u.post(CHECKOUT, checkoutBody({ returnPath }))).status, returnPath).toBe(422);
    }
    expect((await u.post(CHECKOUT, checkoutBody({ interval: 'week' }))).status).toBe(422);
    expect((await u.post(CHECKOUT, checkoutBody({ country: 'israel' }))).status).toBe(422);
    expect(h.checkout.calls).toEqual([]);
  });

  it('without GA prices is 503 BILLING_NOT_CONFIGURED reason PRICES_NOT_SET; without Stripe, plain 503', async () => {
    const noPrices = harness({ noPrices: true });
    const a = await person(noPrices);
    const res = await a.post(CHECKOUT, checkoutBody());
    expect(res.status).toBe(503);
    expect((await read(res)).error).toMatchObject({ code: 'BILLING_NOT_CONFIGURED', details: { reason: 'PRICES_NOT_SET' } });
    const off = harness({ stripeOff: true });
    const b = await person(off);
    const offRes = await b.post(CHECKOUT, checkoutBody());
    expect(offRes.status).toBe(503);
    expect((await read(offRes)).error.code).toBe('BILLING_NOT_CONFIGURED');
  });

  it('Stripe failing is 502 STRIPE_UNAVAILABLE, logged by ids only (never the person’s email)', async () => {
    const h = harness();
    const u = await person(h);
    h.checkout.failNext();
    const res = await u.post(CHECKOUT, checkoutBody());
    expect(res.status).toBe(502);
    expect((await read(res)).error.code).toBe('STRIPE_UNAVAILABLE');
    const warn = h.logs.find((l) => l.includes('"level":40') && l.includes('Stripe billing call failed'));
    expect(warn).toContain(u.userId);
    expect(h.logs.join('\n')).not.toContain(u.email);
  });

  it('a refusal Stripe will repeat (a key missing D2’s scopes, a bad request) is BILLING_ACCOUNT_NEEDS_HELP, logged as an error', async () => {
    const h = harness();
    const u = await person(h);
    h.checkout.failPermissionNext();
    const res = await u.post(CHECKOUT, checkoutBody());
    expect(res.status).toBe(409);
    expect((await read(res)).error).toMatchObject({ code: 'CONFLICT', details: { reason: 'BILLING_ACCOUNT_NEEDS_HELP' } });
    expect(h.logs.some((l) => l.includes('"level":50') && l.includes('StripePermissionError'))).toBe(true);
  });

  it('a missing object that isn’t the customer (a price deleted in the dashboard) never blames the customer link', async () => {
    const h = harness();
    const u = await person(h);
    await linkSubscription(h, u.userId, 'canceled');
    h.checkout.failNext('resource_missing', 'line_items[0][price]');
    const res = await u.post(CHECKOUT, checkoutBody());
    expect((await read(res)).error).toMatchObject({ details: { reason: 'BILLING_ACCOUNT_NEEDS_HELP' } });
    expect(h.logs.some((l) => l.includes('relink'))).toBe(false);
  });

  it('a failed audit after Stripe made the session still hands the person their Checkout (logged)', async () => {
    const h = harness();
    const u = await person(h);
    const append = h.store.audit.append.bind(h.store.audit);
    h.store.audit.append = async () => {
      throw new Error('audit store down');
    };
    const res = await u.post(CHECKOUT, checkoutBody());
    h.store.audit.append = append;
    expect(res.status).toBe(200);
    expect(h.logs.some((l) => l.includes('"level":50') && l.includes('billing audit'))).toBe(true);
  });

  it('refuses both POSTs from another site, before any Stripe call', async () => {
    const h = harness();
    const u = await person(h);
    const cookie = (await sessionHeaders(h, u)).cookie;
    for (const path of [CHECKOUT, PORTAL]) {
      const res = await h.app.request(path, { method: 'POST', headers: { cookie, origin: 'https://evil.example', 'content-type': 'application/json' }, body: JSON.stringify(checkoutBody()) });
      expect(res.status, path).toBe(403);
    }
    expect(h.checkout.calls).toEqual([]);
  });

  it('a linked customer deleted in Stripe is 409 BILLING_ACCOUNT_NEEDS_HELP with an ids-only warn (eng review D7)', async () => {
    const h = harness();
    const u = await person(h);
    const customer = await linkSubscription(h, u.userId, 'canceled');
    h.checkout.failNext('resource_missing');
    const res = await u.post(CHECKOUT, checkoutBody());
    expect(res.status).toBe(409);
    expect((await read(res)).error).toMatchObject({ code: 'CONFLICT', details: { reason: 'BILLING_ACCOUNT_NEEDS_HELP' } });
    const warn = h.logs.find((l) => l.includes('"level":40') && l.includes(customer));
    expect(warn).toContain(u.userId);
  });

  it('is limited to 10 a minute per person', async () => {
    const h = harness();
    const u = await person(h);
    await linkSubscription(h, u.userId, 'active');
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await u.post(CHECKOUT, checkoutBody())).status);
    expect(statuses.slice(0, 10).every((s) => s === 409)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe('GET /admin/v1/billing/status country check (MUT-362 eng review D9)', () => {
  const admin = { 'x-admin-token': ADMIN_TOKEN };
  const status = async (h: Harness, email: string) => read(await h.app.request(`/admin/v1/billing/status?email=${encodeURIComponent(email)}`, { headers: admin }));

  it('flags a linked payer billed outside the consumer countries with no tax ID, and clears one with a tax ID', async () => {
    const h = harness();
    const u = await person(h);
    const customer = await linkSubscription(h, u.userId);
    await h.store.billing.saveAccount({ stripeCustomerId: customer, userId: null, country: 'JO', currency: null, at: NOW, linkAudit: [] });
    h.checkout.taxIds.set(customer, 0);
    expect((await status(h, u.email)).countryCheck).toEqual([{ stripeCustomerId: customer, country: 'JO', openToConsumers: false, taxIds: 0, flagged: true }]);
    h.checkout.taxIds.set(customer, 1);
    expect((await status(h, u.email)).countryCheck).toEqual([{ stripeCustomerId: customer, country: 'JO', openToConsumers: false, taxIds: 1, flagged: false }]);
  });

  it('a Jordanian business’s Checkout tax number counts as its tax ID (review D3: no false flag)', async () => {
    const h = harness();
    const u = await person(h);
    const customer = await linkSubscription(h, u.userId);
    await h.store.billing.saveAccount({ stripeCustomerId: customer, userId: null, country: 'JO', currency: null, at: NOW, linkAudit: [] });
    h.checkout.taxNumbers.set(customer, '516000000');
    expect((await status(h, u.email)).countryCheck).toEqual([{ stripeCustomerId: customer, country: 'JO', openToConsumers: false, taxIds: 1, flagged: false }]);
  });

  it('without Stripe, or when Stripe fails, says it couldn’t check', async () => {
    const h = harness();
    const u = await person(h);
    const customer = await linkSubscription(h, u.userId);
    await h.store.billing.saveAccount({ stripeCustomerId: customer, userId: null, country: 'US', currency: null, at: NOW, linkAudit: [] });
    h.checkout.failNext();
    expect((await status(h, u.email)).countryCheck).toEqual([{ stripeCustomerId: customer, country: 'US', openToConsumers: false, taxIds: null, flagged: null }]);
    const off = harness({ stripeOff: true });
    const v = await person(off);
    await linkSubscription(off, v.userId);
    expect((await status(off, v.email)).countryCheck).toMatchObject([{ country: 'IL', openToConsumers: true, taxIds: null, flagged: false }]);
  });
});

describe('POST /v1/billing/portal-session (MUT-362)', () => {
  it('opens the Customer Portal for the linked customer, returning to the drawer, audited', async () => {
    const h = harness();
    const u = await person(h);
    const customer = await linkSubscription(h, u.userId);
    const res = await u.post(PORTAL, { returnPath: `/p/${u.personalId}` });
    expect(res.status).toBe(200);
    expect(await read(res)).toEqual({ url: 'https://billing.stripe.com/p/session/test_1' });
    expect(h.checkout.portalSessions).toEqual([{ customer, returnUrl: `http://localhost/p/${u.personalId}?billing=true&portal=returned` }]);
    expect((await billingAudit(h, u.personalId)).map((e) => e.action)).toEqual(['billing.portal_opened']);
  });

  it('without a linked customer is 409 NO_BILLING_ACCOUNT', async () => {
    const h = harness();
    const u = await person(h);
    const res = await u.post(PORTAL, { returnPath: '/' });
    expect(res.status).toBe(409);
    expect((await read(res)).error).toMatchObject({ code: 'CONFLICT', details: { reason: 'NO_BILLING_ACCOUNT' } });
  });

  it('a deleted customer is BILLING_ACCOUNT_NEEDS_HELP; Stripe down is 502', async () => {
    const h = harness();
    const u = await person(h);
    await linkSubscription(h, u.userId);
    h.checkout.failNext('resource_missing');
    expect((await read(await u.post(PORTAL, { returnPath: '/' }))).error).toMatchObject({ details: { reason: 'BILLING_ACCOUNT_NEEDS_HELP' } });
    h.checkout.failNext();
    expect((await u.post(PORTAL, { returnPath: '/' })).status).toBe(502);
  });

  it('shares the ten-a-minute limit with Checkout', async () => {
    const h = harness();
    const u = await person(h);
    await linkSubscription(h, u.userId);
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await u.post(PORTAL, { returnPath: '/' })).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});
