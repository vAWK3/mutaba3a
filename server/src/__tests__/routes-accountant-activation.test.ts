import { describe, expect, it } from 'vitest';
import { parseBillingCountries } from '../billing/checkout.js';
import { FakeCheckoutGateway, FakeStripeGateway, stripeObjects } from '../billing/stripe/__tests__/fake.js';
import { CURRENT_TERMS } from '../legal.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { SAME_ORIGIN, accountantHarness, idem, json, person, read, signedIn, type AccountantHarness, type Person } from './helpers/accountants.js';

/**
 * MUT-766 (accountant channel, epic MUT-762; eng SC-1, T5, R4, R5): an approved accountant takes the card of a customer
 * he created, in the room, before the customer claims the account. The customer is the payer; the Checkout is the one
 * the customer would open themselves (the golden test, R4), except that the Stripe customer carries no email until the
 * claim (R5). 404 for another accountant's customer or a claimed one. A duplicated or late webhook makes one subscription.
 */
const CUSTOMERS = '/v1/accountant/customers';
const COUNTRIES = parseBillingCountries({ consumerCountries: '*', customTaxIdCountries: ['IL', 'JO'], vatRates: { IL: 18 } });
const IL = { country: 'IL', line1: 'Az-Zahra St. 18', city: 'Jerusalem', postalCode: '9100000' };
const PASSWORD = 'a-long-enough-password';
const activation = (over: Record<string, unknown> = {}) => ({ plan: 'solo', interval: 'month', country: 'IL', buyer: 'person', address: IL, returnPath: '/client-books', ...over });

function harness(over: { billingLimiter?: SlidingWindowRateLimiter } = {}) {
  const checkout = new FakeCheckoutGateway().withGaPrices().withPlanPrices();
  const stripe = new FakeStripeGateway(() => new Date('2026-11-06T09:00:00Z'));
  const h = accountantHarness({
    store: new MemoryLedgerStore({ starterPlan: true }),
    accountantProvisioning: true,
    planSales: true,
    billingCountries: COUNTRIES,
    stripe: { webhookGateway: stripe, reconcileGateway: stripe, checkoutGateway: checkout },
    ...(over.billingLimiter ? { billingSessionLimiter: over.billingLimiter } : {}),
  });
  const deliver = (event: Record<string, unknown>) => {
    const signed = stripe.sign(event);
    return h.app.request('/v1/billing/stripe/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': signed.signature }, body: signed.raw });
  };
  return { ...h, checkout, stripe, deliver };
}
type Harness = ReturnType<typeof harness>;

async function approved(h: AccountantHarness): Promise<Person> {
  const accountant = await person(h, { sharing: false, displayName: 'Hadi Khatib' });
  await h.store.provision.setApproval({ userId: accountant.userId, enabled: true, createLimitPerDay: null, lookupLimitPerDay: null, at: h.now() });
  return accountant;
}

async function customer(h: Harness, accountant: Person) {
  const email = `owner${Math.random().toString(36).slice(2, 8)}@cafe-nour.ps`;
  const res = await h.app.request(CUSTOMERS, json({ email, displayName: 'Samer Haddad', profileName: 'Café Nour', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', locale: 'en' }, { ...accountant.auth, ...idem() }));
  expect(res.status).toBe(201);
  const out = await read(res);
  const token = /setup#([A-Za-z0-9_-]{43})/.exec(h.transport.list({ to: email }).at(-1)!.text)![1]!;
  return { userId: out.customer.userId as string, email, profileId: out.profile.id as string, code: out.claimCode as string, token };
}

const activate = (h: Harness, who: Person, userId: string, body: object = activation()) => h.app.request(`${CUSTOMERS}/${userId}/checkout-session`, json(body, who.auth));
const claim = (h: Harness, c: { token: string; code: string }) =>
  h.app.request('/v1/account-setup', json({ token: c.token, password: PASSWORD, acceptedTermsVersion: CURRENT_TERMS.version, claimCode: c.code }, SAME_ORIGIN));

describe('POST /v1/accountant/customers/{userId}/checkout-session (MUT-766)', () => {
  it('opens Stripe Checkout with the customer as payer, a Stripe customer with no email, audited with the accountant as actor', async () => {
    const h = harness();
    const accountant = await approved(h);
    const c = await customer(h, accountant);
    const res = await activate(h, accountant, c.userId);
    expect(res.status).toBe(200);
    expect((await read(res)).url).toMatch(/^https:\/\/checkout\.stripe\.com\//);

    const [params] = h.checkout.checkoutSessions;
    expect(params!.client_reference_id).toBe(c.userId);
    expect(params!.subscription_data?.metadata).toMatchObject({ mutaba3a_user_id: c.userId, mutaba3a_plan: 'solo' });
    expect(params!.success_url).toBe('http://localhost/client-books?billing=true&checkout=success');
    const made = [...h.checkout.customers.entries()].find(([, v]) => v.userId === c.userId);
    expect(made?.[1].email).toBeNull();
    expect(h.checkout.addresses.get(made![0])).toEqual(IL);

    const started = (await h.store.audit.listByOrganization(c.profileId, 50)).find((e) => e.action === 'billing.checkout_started');
    expect(started).toMatchObject({ actorId: accountant.userId, metadata: { plan: 'solo', payerUserId: c.userId } });
  });

  it('golden (R4): the same payer gets the same Stripe parameters and the same expiry from both doors, and the claim sets the verified email (R5)', async () => {
    const h = harness();
    const accountant = await approved(h);
    const c = await customer(h, accountant);
    expect((await activate(h, accountant, c.userId)).status).toBe(200);
    const accountantCalls = [...h.checkout.calls];
    const fromAccountant = h.checkout.checkoutSessions[0];

    expect((await claim(h, c)).status).toBe(200);
    const cus = [...h.checkout.customers.entries()].find(([, v]) => v.userId === c.userId)![0];
    expect(h.checkout.customers.get(cus)?.email).toBe(c.email);

    const self = await signedIn(h, c.email, PASSWORD, c.userId, '');
    h.checkout.calls.length = 0;
    const expiredBefore = h.checkout.expiredCheckouts;
    const own = await h.app.request('/v1/billing/checkout-session', json({ ...activation(), returnPath: '/client-books' }, self.auth));
    expect(own.status).toBe(200);
    const fromCustomer = h.checkout.checkoutSessions[1];

    expect(fromCustomer).toEqual(fromAccountant);
    // The same Stripe calls in the same order, the address saved and the open Checkout expired the same way
    // (the email set at claim sits between the two runs, outside both).
    expect(h.checkout.calls.filter((x) => !x.startsWith('email:'))).toEqual(accountantCalls.filter((x) => !x.startsWith('email:')));
    expect(h.checkout.expiredCheckouts - expiredBefore).toBe(1);
  });

  it('MUT-703 (ADR-300 d2): an activation carries no offer, even yearly while the plans’ launch runs; the customer buying later gets it by the rule', async () => {
    const h = harness();
    h.checkout.coupons.set('mtb3a_launch_yearly_plans_2026', {
      id: 'mtb3a_launch_yearly_plans_2026',
      valid: true,
      percentOff: 50,
      amountOff: null,
      amountOffIn: { ILS: null, USD: null },
      duration: 'once',
      durationInMonths: null,
      redeemBy: new Date('2027-02-21T22:59:00.000Z'),
      appliesToProducts: ['prod_solo', 'prod_business', 'prod_firm'],
    });
    const accountant = await approved(h);
    const c = await customer(h, accountant);
    expect((await activate(h, accountant, c.userId, activation({ interval: 'year' }))).status).toBe(200);
    expect(h.checkout.checkoutSessions[0]!.discounts).toBeUndefined();
    expect(h.checkout.couponReads).toEqual([]);
    const started = (await h.store.audit.listByOrganization(c.profileId, 50)).find((e) => e.action === 'billing.checkout_started');
    expect(started?.metadata).toMatchObject({ offer: null, payerUserId: c.userId });

    expect((await claim(h, c)).status).toBe(200);
    const self = await signedIn(h, c.email, PASSWORD, c.userId, '');
    const own = await h.app.request('/v1/billing/checkout-session', json({ ...activation({ interval: 'year' }), returnPath: '/client-books' }, self.auth));
    expect(own.status).toBe(200);
    expect(h.checkout.checkoutSessions[1]!.discounts).toEqual([{ coupon: 'mtb3a_launch_yearly_plans_2026' }]);
  });

  it('is 404 for another accountant’s customer, an unknown id and a claimed customer; 403 when not approved', async () => {
    const h = harness();
    const a = await approved(h);
    const b = await approved(h);
    const c = await customer(h, a);
    expect((await activate(h, b, c.userId)).status).toBe(404);
    expect((await activate(h, a, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
    await h.store.provision.setApproval({ userId: a.userId, enabled: false, createLimitPerDay: null, lookupLimitPerDay: null, at: h.now() });
    expect((await read(await activate(h, a, c.userId))).error.code).toBe('ACCOUNTANT_NOT_APPROVED');
    await h.store.provision.setApproval({ userId: a.userId, enabled: true, createLimitPerDay: null, lookupLimitPerDay: null, at: h.now() });
    expect((await claim(h, c)).status).toBe(200);
    expect((await activate(h, a, c.userId)).status).toBe(404);
    expect(h.checkout.checkoutSessions).toHaveLength(0);
  });

  it('sells paid plans only, with an address in the chosen country', async () => {
    const h = harness();
    const accountant = await approved(h);
    const c = await customer(h, accountant);
    expect((await activate(h, accountant, c.userId, activation({ plan: 'freelancer' }))).status).toBe(422);
    expect((await activate(h, accountant, c.userId, activation({ trial: true }))).status).toBe(422);
    const wrongCountry = await activate(h, accountant, c.userId, activation({ country: 'JO' }));
    expect((await read(wrongCountry)).error.details?.reason).toBe('ADDRESS_INVALID');
    expect(h.checkout.checkoutSessions).toHaveLength(0);
  });

  it('counts the accountant’s presses against his own billing limit, not the customer’s', async () => {
    const h = harness({ billingLimiter: new SlidingWindowRateLimiter(1) });
    const accountant = await approved(h);
    const first = await customer(h, accountant);
    const second = await customer(h, accountant);
    expect((await activate(h, accountant, first.userId)).status).toBe(200);
    const res = await activate(h, accountant, second.userId);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBeTruthy();
  });

  it('a duplicated and a late webhook make one subscription; the desk then shows the customer as paid', async () => {
    const h = harness();
    const accountant = await approved(h);
    const c = await customer(h, accountant);
    expect((await activate(h, accountant, c.userId)).status).toBe(200);
    const before = await read(await h.app.request(CUSTOMERS, { headers: accountant.auth }));
    expect(before.items[0]).toMatchObject({ userId: c.userId, paid: false, state: 'awaiting_claim' });

    h.stripe.products.set('prod_solo', stripeObjects.product('prod_solo', 'solo'));
    h.stripe.customers.set('cus_act', stripeObjects.customer('cus_act', { mutaba3a_user_id: c.userId }));
    h.stripe.subscriptions.set('sub_act', stripeObjects.subscription({ id: 'sub_act', customer: 'cus_act', product: 'prod_solo' }));
    const event = { id: 'evt_act_1', type: 'customer.subscription.created', data: { object: { id: 'sub_act' } } };
    expect((await h.deliver(event)).status).toBe(200);
    expect((await h.deliver(event)).status).toBe(200);
    expect((await h.deliver({ ...event, id: 'evt_act_late', type: 'customer.subscription.updated' })).status).toBe(200);

    const summary = await h.store.billing.summaryOf(c.userId);
    expect(summary.subscriptions).toHaveLength(1);
    const after = await read(await h.app.request(CUSTOMERS, { headers: accountant.auth }));
    expect(after.items[0]).toMatchObject({ userId: c.userId, paid: true, state: 'awaiting_claim' });
  });

  it('answers 404 while the feature is off', async () => {
    const h = accountantHarness({ accountantProvisioning: false });
    const accountant = await approved(h);
    expect((await h.app.request(`${CUSTOMERS}/00000000-0000-4000-8000-000000000000/checkout-session`, json(activation(), accountant.auth))).status).toBe(404);
  });
});
