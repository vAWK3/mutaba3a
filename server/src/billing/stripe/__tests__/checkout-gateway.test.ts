import { describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import { expectedTierOfLookupKey } from '../../checkout.js';
import { CATALOG_FAILURE_TTL_MS, CATALOG_TTL_MS, CHECKOUT_BUDGET, INVOICE_TAX_NUMBER_FIELD, createCheckoutGateway, sellableFactOf } from '../checkout-gateway.js';
import { STRIPE_API_VERSION, StripeGatewayError } from '../gateway.js';
import { fakeStripe, type SeenRequest } from './fake-http.js';
import { mirrorOf } from '../mirror.js';

/**
 * MUT-362 (plan §2.2, eng review D2/D3): the write door to Stripe under the real SDK and a fake fetch. Pinned here:
 * the customer lookup order and its idempotency key, the session bodies, the price lookup and its cache, the budget.
 * Fixtures follow the pinned API version's shapes, written by hand.
 */
const KEY = 'rk_test_mut362_fixture_key';
const PERSON = { userId: '11111111-1111-4111-8111-111111111111', email: 'nour@studio.ps', name: 'Nour Haddad' };

const price = (lookupKey: string, currency: string, unitAmount: number, interval: 'month' | 'year') => ({
  id: `price_${lookupKey}`,
  object: 'price',
  active: true,
  currency,
  unit_amount: unitAmount,
  lookup_key: lookupKey,
  recurring: { interval, interval_count: 1 },
  type: 'recurring',
  tax_behavior: 'exclusive',
  product: { id: 'prod_FREELANCER', object: 'product', metadata: { tier: 'freelancer' } },
});
const customer = (id: string, email: string, userId: string | null) => ({ id, object: 'customer', email, metadata: userId ? { mutaba3a_user_id: userId } : {} });
const list = (data: unknown[]) => ({ object: 'list', has_more: false, data });

function gatewayWith(respond: Parameters<typeof fakeStripe>[0], now = () => new Date('2026-11-01T09:00:00.000Z'), couponTtlMs?: number) {
  const fake = fakeStripe(respond);
  return { ...fake, gateway: createCheckoutGateway({ secretKey: KEY, ...CHECKOUT_BUDGET, now, httpClient: fake.httpClient, ...(couponTtlMs === undefined ? {} : { couponTtlMs }) }) };
}
const route = (s: SeenRequest) => `${s.method} ${s.path}`;

describe('CheckoutGateway customer (MUT-362 eng review D3)', () => {
  it('reuses the customer already carrying this person’s id, found by exact email', async () => {
    const { seen, gateway } = gatewayWith(() => ({
      status: 200,
      body: list([customer('cus_SOMEONE', PERSON.email, '99999999-9999-4999-8999-999999999999'), customer('cus_MINE', PERSON.email, PERSON.userId)]),
    }));
    expect(await gateway.findOrCreateCustomer(PERSON)).toBe('cus_MINE');
    expect(seen.map(route)).toEqual(['GET /v1/customers']);
    expect(seen[0]!.query.get('email')).toBe(PERSON.email);
    expect(seen[0]!.headers.get('stripe-version')).toBe(STRIPE_API_VERSION);
  });

  it('creates one with the person’s id in its metadata and a per-person idempotency key when none carries it', async () => {
    const { seen, gateway } = gatewayWith((request) =>
      request.method === 'GET' ? { status: 200, body: list([customer('cus_OTHER', PERSON.email, null)]) } : { status: 200, body: customer('cus_NEW', PERSON.email, PERSON.userId) },
    );
    expect(await gateway.findOrCreateCustomer(PERSON)).toBe('cus_NEW');
    expect(seen.map(route)).toEqual(['GET /v1/customers', 'POST /v1/customers']);
    const create = seen[1]!;
    expect(create.form.get('email')).toBe(PERSON.email);
    expect(create.form.get('name')).toBe(PERSON.name);
    expect(create.form.get('metadata[mutaba3a_user_id]')).toBe(PERSON.userId);
    expect(create.headers.get('idempotency-key')).toMatch(new RegExp(`^mut362-customer-${PERSON.userId}-[0-9a-f]{12}$`));
  });

  it('a changed email or name gets a new idempotency key, so Stripe never refuses a reused key with new parameters', async () => {
    const keys: (string | null)[] = [];
    const { gateway } = gatewayWith((request) => {
      if (request.method === 'POST') keys.push(request.headers.get('idempotency-key'));
      return request.method === 'GET' ? { status: 200, body: list([]) } : { status: 200, body: customer('cus_NEW', PERSON.email, PERSON.userId) };
    });
    await gateway.findOrCreateCustomer(PERSON);
    await gateway.findOrCreateCustomer({ ...PERSON, email: 'nour@new.ps' });
    await gateway.findOrCreateCustomer(PERSON);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[0]).toBe(keys[2]);
  });
});

describe('CheckoutGateway before a Checkout (MUT-362 review: no double charge)', () => {
  it('reads every subscription Stripe holds for the customer, whatever the mirror says', async () => {
    const sub = (status: string, end: number) => ({ id: `sub_${status}`, object: 'subscription', status, items: list([{ id: 'si_1', object: 'subscription_item', current_period_end: end }]) });
    const { seen, gateway } = gatewayWith(() => ({ status: 200, body: list([sub('active', 1796083200), sub('canceled', 1790000000)]) }));
    expect(await gateway.subscriptionsOf('cus_MINE')).toEqual([
      { tier: null, status: 'active', currentPeriodEnd: new Date(1796083200 * 1000), offerId: null },
      { tier: null, status: 'canceled', currentPeriodEnd: new Date(1790000000 * 1000), offerId: null },
    ]);
    expect(seen.map(route)).toEqual(['GET /v1/subscriptions']);
    expect(seen[0]!.query.get('customer')).toBe('cus_MINE');
    expect(seen[0]!.query.get('status')).toBe('all');
  });

  it('MUT-565 review: expires only the open sessions of the same plan (no metadata is the Freelancer plan)', async () => {
    const session = (id: string, plan?: string) => ({ id, object: 'checkout.session', status: 'open', metadata: plan ? { mutaba3a_plan: plan } : {} });
    const { seen, gateway } = gatewayWith((request) =>
      request.method === 'GET'
        ? { status: 200, body: list([session('cs_free'), session('cs_acc', 'accountant'), session('cs_free2', 'freelancer')]) }
        : { status: 200, body: { id: request.path.split('/')[4], object: 'checkout.session', status: 'expired' } },
    );
    expect(await gateway.expireOpenCheckouts('cus_MINE', 'accountant')).toBe(1);
    expect(seen.map(route)).toEqual(['GET /v1/checkout/sessions', 'POST /v1/checkout/sessions/cs_acc/expire']);
    expect(await gateway.expireOpenCheckouts('cus_MINE', 'freelancer')).toBe(2);
    expect(seen.slice(2).map(route)).toEqual(['GET /v1/checkout/sessions', 'POST /v1/checkout/sessions/cs_free/expire', 'POST /v1/checkout/sessions/cs_free2/expire']);
  });

  it('expires the customer’s open Checkout sessions, so a second tab can’t be paid as well', async () => {
    const { seen, gateway } = gatewayWith((request) =>
      request.method === 'GET'
        ? { status: 200, body: list([{ id: 'cs_test_A', object: 'checkout.session', status: 'open' }, { id: 'cs_test_B', object: 'checkout.session', status: 'open' }]) }
        : { status: 200, body: { id: request.path.split('/')[4], object: 'checkout.session', status: 'expired' } },
    );
    expect(await gateway.expireOpenCheckouts('cus_MINE')).toBe(2);
    expect(seen.map(route)).toEqual(['GET /v1/checkout/sessions', 'POST /v1/checkout/sessions/cs_test_A/expire', 'POST /v1/checkout/sessions/cs_test_B/expire']);
    expect(seen[0]!.query.get('customer')).toBe('cus_MINE');
    expect(seen[0]!.query.get('status')).toBe('open');
  });
});

describe('CheckoutGateway sessions (MUT-362 §2.2)', () => {
  it('creates a Checkout Session with the customer and returns its URL', async () => {
    const { seen, gateway } = gatewayWith(() => ({ status: 200, body: { id: 'cs_test_1', object: 'checkout.session', url: 'https://checkout.stripe.com/c/pay/cs_test_1' } }));
    const result = await gateway.createCheckoutSession({
      customer: 'cus_MINE',
      mode: 'subscription',
      line_items: [{ price: 'price_ils_m', quantity: 1 }],
      client_reference_id: PERSON.userId,
      success_url: 'https://portal.example/?billing=true&checkout=success',
      cancel_url: 'https://portal.example/?billing=true&checkout=cancelled',
    });
    expect(result).toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    expect(seen.map(route)).toEqual(['POST /v1/checkout/sessions']);
    expect(seen[0]!.form.get('customer')).toBe('cus_MINE');
    expect(seen[0]!.form.get('line_items[0][price]')).toBe('price_ils_m');
    expect(seen[0]!.form.get('client_reference_id')).toBe(PERSON.userId);
  });

  it('opens a Customer Portal session for the customer with the return URL', async () => {
    const { seen, gateway } = gatewayWith(() => ({ status: 200, body: { id: 'bps_1', object: 'billing_portal.session', url: 'https://billing.stripe.com/p/session/test_1' } }));
    expect(await gateway.createPortalSession({ customer: 'cus_MINE', returnUrl: 'https://portal.example/?billing=true' })).toEqual({ url: 'https://billing.stripe.com/p/session/test_1' });
    expect(seen.map(route)).toEqual(['POST /v1/billing_portal/sessions']);
    expect(seen[0]!.form.get('customer')).toBe('cus_MINE');
    expect(seen[0]!.form.get('return_url')).toBe('https://portal.example/?billing=true');
    expect(seen[0]!.form.get('locale')).toBe('auto');
  });

  it('MUT-533 (D5): the card flow opens straight on Stripe’s card form and comes back to the drawer when done', async () => {
    const { seen, gateway } = gatewayWith(() => ({ status: 200, body: { id: 'bps_2', object: 'billing_portal.session', url: 'https://billing.stripe.com/p/session/test_2' } }));
    await gateway.createPortalSession({ customer: 'cus_MINE', returnUrl: 'https://portal.example/?billing=true&portal=returned', flow: 'card' });
    expect(seen[0]!.form.get('flow_data[type]')).toBe('payment_method_update');
    expect(seen[0]!.form.get('flow_data[after_completion][type]')).toBe('redirect');
    expect(seen[0]!.form.get('flow_data[after_completion][redirect][return_url]')).toBe('https://portal.example/?billing=true&portal=returned');
    expect(seen[0]!.form.get('return_url')).toBe('https://portal.example/?billing=true&portal=returned');
  });

  it('a session without a URL is a gateway error, never an empty redirect', async () => {
    const { gateway } = gatewayWith(() => ({ status: 200, body: { id: 'cs_test_2', object: 'checkout.session', url: null } }));
    await expect(gateway.createCheckoutSession({ customer: 'cus_MINE', mode: 'subscription' })).rejects.toBeInstanceOf(StripeGatewayError);
  });

  it('a deleted customer surfaces as resource_missing, not transient (eng review D7)', async () => {
    const { gateway } = gatewayWith(() => ({ status: 404, body: { error: { type: 'invalid_request_error', code: 'resource_missing', param: 'customer', message: 'No such customer' } } }));
    expect(await gateway.createPortalSession({ customer: 'cus_GONE', returnUrl: 'https://portal.example/' }).catch((e: unknown) => e)).toMatchObject({
      code: 'resource_missing',
      transient: false,
    });
  });

  it('retries a retryable failure once under the checkout budget (a person is waiting)', async () => {
    const { seen, gateway } = gatewayWith(() => ({ status: 503, body: { error: { type: 'api_error', message: 'boom' } }, headers: { 'stripe-should-retry': 'true' } }));
    await expect(gateway.createPortalSession({ customer: 'cus_MINE', returnUrl: 'https://portal.example/' })).rejects.toBeInstanceOf(StripeGatewayError);
    expect(seen).toHaveLength(2);
    // The SDK keeps one idempotency key across its retry, so a retried POST can't open two sessions.
    expect(seen[0]!.headers.get('idempotency-key')).toBe(seen[1]!.headers.get('idempotency-key'));
  }, 15_000);
});

describe('CheckoutGateway business tax numbers (MUT-362 eng review D9, review D3)', () => {
  const withInvoiceFields = (fields: { name: string; value: string }[]) => ({ ...customer('cus_MINE', PERSON.email, PERSON.userId), invoice_settings: { custom_fields: fields } });

  it('counts Stripe tax IDs and our invoice tax number together', async () => {
    const { seen, gateway } = gatewayWith((request) =>
      request.path.endsWith('/tax_ids')
        ? { status: 200, body: list([{ id: 'txi_1', object: 'tax_id', type: 'ae_trn', value: '100000000000003' }]) }
        : { status: 200, body: withInvoiceFields([{ name: INVOICE_TAX_NUMBER_FIELD, value: '516000000' }]) },
    );
    expect(await gateway.businessTaxIdCount('cus_MINE')).toBe(2);
    expect(seen.map(route).sort()).toEqual(['GET /v1/customers/cus_MINE', 'GET /v1/customers/cus_MINE/tax_ids']);
  });

  it('a customer with neither counts zero', async () => {
    const { gateway } = gatewayWith((request) => (request.path.endsWith('/tax_ids') ? { status: 200, body: list([]) } : { status: 200, body: withInvoiceFields([]) }));
    expect(await gateway.businessTaxIdCount('cus_MINE')).toBe(0);
  });

  it('prints the Checkout tax number on the customer’s invoices', async () => {
    const { seen, gateway } = gatewayWith(() => ({ status: 200, body: withInvoiceFields([{ name: INVOICE_TAX_NUMBER_FIELD, value: '516000000' }]) }));
    await gateway.setInvoiceTaxNumber('cus_MINE', '516000000');
    expect(seen.map(route)).toEqual(['POST /v1/customers/cus_MINE']);
    expect(seen[0]!.form.get('invoice_settings[custom_fields][0][name]')).toBe(INVOICE_TAX_NUMBER_FIELD);
    expect(seen[0]!.form.get('invoice_settings[custom_fields][0][value]')).toBe('516000000');
    expect(INVOICE_TAX_NUMBER_FIELD.length).toBeLessThanOrEqual(40);
  });
});

describe('CheckoutGateway prices (MUT-362 §2.1)', () => {
  const keys = ['freelancer_list_monthly_ils', 'freelancer_list_yearly_ils'];

  it('looks the active prices up by lookup key', async () => {
    const { seen, gateway } = gatewayWith(() => ({ status: 200, body: list([price(keys[0]!, 'ils', 3900, 'month'), price(keys[1]!, 'ils', 39000, 'year')]) }));
    const prices = await gateway.pricesByLookupKey(keys);
    expect(prices.get(keys[0]!)).toEqual({ id: `price_${keys[0]}`, currency: 'ILS', unitAmount: 3900, interval: 'month', productId: 'prod_FREELANCER' });
    expect(prices.get(keys[1]!)).toMatchObject({ unitAmount: 39000, interval: 'year' });
    expect(seen.map(route)).toEqual(['GET /v1/prices']);
    expect(seen[0]!.query.get('expand[0]')).toBe('data.product');
    expect([...seen[0]!.query.entries()].filter(([k]) => k.startsWith('lookup_keys')).map(([, v]) => v)).toEqual(keys);
    expect(seen[0]!.query.get('active')).toBe('true');
  });

  it('caches the answer for ten minutes, then asks again; a failure for one minute', async () => {
    let now = new Date('2026-11-01T09:00:00.000Z');
    let fail = true;
    const { seen, gateway } = gatewayWith(
      () => (fail ? { status: 500, body: { error: { type: 'api_error', message: 'boom' } } } : { status: 200, body: list([price(keys[0]!, 'ils', 3900, 'month')]) }),
      () => now,
    );
    await expect(gateway.pricesByLookupKey(keys)).rejects.toBeInstanceOf(StripeGatewayError);
    const failedCalls = seen.length;
    fail = false;
    // Within the minute the failure answers again without asking Stripe (a person polling must not pile calls up).
    await expect(gateway.pricesByLookupKey(keys)).rejects.toBeInstanceOf(StripeGatewayError);
    expect(seen.length).toBe(failedCalls);
    now = new Date(now.getTime() + CATALOG_FAILURE_TTL_MS + 1);
    await gateway.pricesByLookupKey(keys);
    const asked = seen.length;
    await gateway.pricesByLookupKey(keys);
    expect(seen.length).toBe(asked);
    now = new Date(now.getTime() + CATALOG_TTL_MS + 1);
    await gateway.pricesByLookupKey(keys);
    expect(seen.length).toBe(asked + 1);
  }, 15_000);

  it('asks Stripe once for simultaneous lookups', async () => {
    const { seen, gateway } = gatewayWith(() => ({ status: 200, body: list([price(keys[0]!, 'ils', 3900, 'month')]) }));
    await Promise.all([gateway.pricesByLookupKey(keys), gateway.pricesByLookupKey(keys), gateway.pricesByLookupKey(keys)]);
    expect(seen).toHaveLength(1);
  });

  it('sells only a Freelancer-tagged, VAT-exclusive, one-month-or-one-year price (review: else paid but never mirrored)', async () => {
    const good = price(keys[0]!, 'ils', 3900, 'month');
    const { gateway } = gatewayWith(() => ({
      status: 200,
      body: list([
        { ...good, lookup_key: 'untagged', product: { id: 'prod_X', object: 'product', metadata: {} } },
        { ...good, lookup_key: 'inclusive', tax_behavior: 'inclusive' },
        { ...good, lookup_key: 'unspecified', tax_behavior: 'unspecified' },
        { ...good, lookup_key: 'quarterly', recurring: { interval: 'month', interval_count: 3 } },
        good,
      ]),
    }));
    expect([...(await gateway.pricesByLookupKey(keys)).keys()]).toEqual([keys[0]]);
  });

  it('skips a price that isn’t recurring or has no amount', async () => {
    const { gateway } = gatewayWith(() => ({ status: 200, body: list([{ ...price(keys[0]!, 'ils', 3900, 'month'), recurring: null }, { ...price(keys[1]!, 'ils', 0, 'year'), unit_amount: null }]) }));
    expect((await gateway.pricesByLookupKey(keys)).size).toBe(0);
  });
});

describe('CheckoutGateway coupons (MUT-525 D6, R6, R7)', () => {
  const COUPON = 'mtb3a_launch_yearly_2026';
  const coupon = (over: Record<string, unknown> = {}) => ({
    id: COUPON,
    object: 'coupon',
    valid: true,
    percent_off: 50,
    amount_off: null,
    duration: 'once',
    redeem_by: 1801000000,
    applies_to: { products: ['prod_FREELANCER'] },
    ...over,
  });
  const missing = { status: 404, body: { error: { type: 'invalid_request_error', code: 'resource_missing', message: 'No such coupon' } } };

  it('reads the coupon with applies_to and currency_options expanded', async () => {
    const { seen, gateway } = gatewayWith(() => ({ status: 200, body: coupon() }));
    expect(await gateway.couponById(COUPON)).toEqual({
      id: COUPON,
      valid: true,
      percentOff: 50,
      amountOff: null,
      amountOffIn: { ILS: null, USD: null },
      duration: 'once',
      durationInMonths: null,
      redeemBy: new Date(1801000000 * 1000),
      appliesToProducts: ['prod_FREELANCER'],
    });
    expect(seen.map(route)).toEqual([`GET /v1/coupons/${COUPON}`]);
    expect(seen[0]!.query.get('expand[0]')).toBe('applies_to');
    expect(seen[0]!.query.get('expand[1]')).toBe('currency_options');
  });

  it('MUT-534 (D8): an amount-off coupon reads its amount in each currency, its own and its currency options', async () => {
    const body = coupon({ percent_off: null, amount_off: 2000, currency: 'ils', currency_options: { ils: { amount_off: 2000 }, usd: { amount_off: 600 } } });
    expect(await gatewayWith(() => ({ status: 200, body })).gateway.couponById(COUPON)).toMatchObject({ amountOff: 2000, amountOffIn: { ILS: 2000, USD: 600 } });
    const ilsOnly = coupon({ percent_off: null, amount_off: 2000, currency: 'ils' });
    expect(await gatewayWith(() => ({ status: 200, body: ilsOnly })).gateway.couponById(COUPON)).toMatchObject({ amountOffIn: { ILS: 2000, USD: null } });
  });

  it('a coupon Stripe no longer has, or one no longer valid, is null', async () => {
    expect(await gatewayWith(() => missing).gateway.couponById(COUPON)).toBeNull();
    expect(await gatewayWith(() => ({ status: 200, body: coupon({ valid: false }) })).gateway.couponById(COUPON)).toBeNull();
  });

  it('a coupon with no redeem_by or no product list says so', async () => {
    const fact = await gatewayWith(() => ({ status: 200, body: coupon({ redeem_by: null, applies_to: undefined }) })).gateway.couponById(COUPON);
    expect(fact).toMatchObject({ redeemBy: null, appliesToProducts: null });
  });

  it('caches for ten minutes by default, a failure for one; `fresh` always asks Stripe', async () => {
    let now = new Date('2026-11-01T09:00:00.000Z');
    let fail = true;
    const { seen, gateway } = gatewayWith(() => (fail ? { status: 500, body: { error: { type: 'api_error', message: 'boom' } } } : { status: 200, body: coupon() }), () => now);
    await expect(gateway.couponById(COUPON)).rejects.toBeInstanceOf(StripeGatewayError);
    const failed = seen.length;
    fail = false;
    await expect(gateway.couponById(COUPON)).rejects.toBeInstanceOf(StripeGatewayError);
    expect(seen.length).toBe(failed);
    expect(await gateway.couponById(COUPON, { fresh: true })).not.toBeNull();
    expect(seen.length).toBe(failed + 1);
    // The fresh read refreshed the cache.
    await gateway.couponById(COUPON);
    expect(seen.length).toBe(failed + 1);
    now = new Date(now.getTime() + CATALOG_TTL_MS + 1);
    await gateway.couponById(COUPON);
    expect(seen.length).toBe(failed + 2);
  }, 15_000);

  it('a missing coupon is cached like an answer, not a failure', async () => {
    const { seen, gateway } = gatewayWith(() => missing);
    expect(await gateway.couponById(COUPON)).toBeNull();
    expect(await gateway.couponById(COUPON)).toBeNull();
    expect(seen).toHaveLength(1);
  });

  it('a cache TTL of 0 (the QA harness, R6) asks Stripe every time', async () => {
    const { seen, gateway } = gatewayWith(() => ({ status: 200, body: coupon() }), undefined, 0);
    await gateway.couponById(COUPON);
    await gateway.couponById(COUPON);
    expect(seen).toHaveLength(2);
  });

  it('a permission error is a gateway error the route turns into no offer (R7)', async () => {
    const { gateway } = gatewayWith(() => ({ status: 403, body: { error: { type: 'invalid_request_error', message: 'The provided key does not have the required permissions' } } }));
    await expect(gateway.couponById(COUPON)).rejects.toBeInstanceOf(StripeGatewayError);
  });
});

describe('CheckoutGateway renewals (MUT-525 DD8)', () => {
  const T0 = 1_794_000_000;
  const YEAR = 365 * 24 * 60 * 60;
  const sub = (over: Record<string, unknown> = {}, itemOver: Record<string, unknown> = {}) => ({
    id: 'sub_1',
    object: 'subscription',
    status: 'active',
    cancel_at_period_end: false,
    cancel_at: null,
    start_date: T0 - 10 * 86_400,
    trial_end: T0,
    items: { object: 'list', has_more: false, data: [{ id: 'si_1', object: 'subscription_item', current_period_start: T0, current_period_end: T0 + YEAR, price: { id: 'price_y', currency: 'ils', unit_amount: 29000, lookup_key: 'freelancer_list_yearly_ils' }, ...itemOver }] },
    ...over,
  });

  it('reads the subscription’s own price and whether this is its first paid year (the trial’s end, or the start)', async () => {
    const { seen, gateway } = gatewayWith(() => ({ status: 200, body: sub() }));
    expect(await gateway.renewalOf('sub_1')).toEqual({
      status: 'active',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: new Date((T0 + YEAR) * 1000),
      firstPaidPeriod: true,
      unitAmount: 29000,
      currency: 'ILS',
      lookupKey: 'freelancer_list_yearly_ils',
    });
    expect(seen.map(route)).toEqual(['GET /v1/subscriptions/sub_1']);
    const noTrial = await gatewayWith(() => ({ status: 200, body: sub({ trial_end: null, start_date: T0 }) })).gateway.renewalOf('sub_1');
    expect(noTrial?.firstPaidPeriod).toBe(true);
    const secondYear = await gatewayWith(() => ({ status: 200, body: sub({}, { current_period_start: T0 + YEAR, current_period_end: T0 + 2 * YEAR }) })).gateway.renewalOf('sub_1');
    expect(secondYear?.firstPaidPeriod).toBe(false);
  });

  it('a subscription Stripe no longer has is null', async () => {
    const { gateway } = gatewayWith(() => ({ status: 404, body: { error: { type: 'invalid_request_error', code: 'resource_missing', message: 'No such subscription' } } }));
    expect(await gateway.renewalOf('sub_gone')).toBeNull();
  });
});

describe('sellableFactOf: each plan’s keys on its own product (MUT-565, test 7)', () => {
  const onProduct = (lookupKey: string, tier: string) => ({ ...price(lookupKey, 'ils', 9900, 'month'), product: { id: `prod_${tier}`, object: 'product', metadata: { tier } } }) as unknown as Stripe.Price;

  it('an accountant key sells only on a product tagged accountant; a freelancer key only on freelancer', () => {
    expect(sellableFactOf(onProduct('accountant_list_monthly_ils', 'accountant'), expectedTierOfLookupKey('accountant_list_monthly_ils'))).toMatchObject({ unitAmount: 9900, productId: 'prod_accountant' });
    expect(sellableFactOf(onProduct('accountant_list_monthly_ils', 'freelancer'), expectedTierOfLookupKey('accountant_list_monthly_ils'))).toBeNull();
    expect(sellableFactOf(onProduct('freelancer_list_monthly_ils', 'accountant'), expectedTierOfLookupKey('freelancer_list_monthly_ils'))).toBeNull();
  });
});

describe('one tier reading: Stripe’s list and the mirror agree (MUT-565 review 6)', () => {
  const stripeSub = (id: string, productId: string, lookupKey: string) =>
    ({
      id,
      object: 'subscription',
      status: 'active',
      currency: 'ils',
      customer: 'cus_MINE',
      metadata: {},
      items: list([{ id: `si_${id}`, object: 'subscription_item', current_period_end: 1796083200, price: { id: `price_${id}`, lookup_key: lookupKey, product: productId } }]),
    }) as unknown as Stripe.Subscription;
  const products: Record<string, Stripe.Product> = {
    prod_A: { id: 'prod_A', object: 'product', active: true, metadata: { tier: 'accountant' } } as unknown as Stripe.Product,
    prod_F: { id: 'prod_F', object: 'product', active: true, metadata: { tier: 'freelancer' } } as unknown as Stripe.Product,
  };
  const subs = [stripeSub('sub_acc', 'prod_A', 'accountant_list_monthly_ils'), stripeSub('sub_free', 'prod_F', 'freelancer_list_monthly_ils'), stripeSub('sub_mislabelled', 'prod_F', 'accountant_list_monthly_ils')];

  it('reads the tier from the product’s metadata, as mirrorOf does, never from the lookup key; products are read once', async () => {
    const { seen, gateway } = gatewayWith((request) =>
      request.path.startsWith('/v1/products/') ? { status: 200, body: products[request.path.split('/')[3]!] } : { status: 200, body: list(subs) },
    );
    const listed = await gateway.subscriptionsOf('cus_MINE');
    const mirrored = subs.map((sub) => {
      const result = mirrorOf(sub, new Map(Object.entries(products)));
      return 'ok' in result ? result.ok.tier : null;
    });
    expect(listed.map((s) => s.tier)).toEqual(['ACCOUNTANT', 'FREELANCER', 'FREELANCER']);
    expect(listed.map((s) => s.tier)).toEqual(mirrored);
    expect(seen.filter((r) => r.path.startsWith('/v1/products/')).map(route).sort()).toEqual(['GET /v1/products/prod_A', 'GET /v1/products/prod_F']);
  });
});
