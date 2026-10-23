import { describe, expect, it } from 'vitest';
import { CATALOG_FAILURE_TTL_MS, CATALOG_TTL_MS, CHECKOUT_BUDGET, INVOICE_TAX_NUMBER_FIELD, createCheckoutGateway } from '../checkout-gateway.js';
import { STRIPE_API_VERSION, StripeGatewayError } from '../gateway.js';
import { fakeStripe, type SeenRequest } from './fake-http.js';

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

function gatewayWith(respond: Parameters<typeof fakeStripe>[0], now = () => new Date('2026-11-01T09:00:00.000Z')) {
  const fake = fakeStripe(respond);
  return { ...fake, gateway: createCheckoutGateway({ secretKey: KEY, ...CHECKOUT_BUDGET, now, httpClient: fake.httpClient }) };
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
      { status: 'active', currentPeriodEnd: new Date(1796083200 * 1000) },
      { status: 'canceled', currentPeriodEnd: new Date(1790000000 * 1000) },
    ]);
    expect(seen.map(route)).toEqual(['GET /v1/subscriptions']);
    expect(seen[0]!.query.get('customer')).toBe('cus_MINE');
    expect(seen[0]!.query.get('status')).toBe('all');
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
    expect(prices.get(keys[0]!)).toEqual({ id: `price_${keys[0]}`, currency: 'ILS', unitAmount: 3900, interval: 'month' });
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
