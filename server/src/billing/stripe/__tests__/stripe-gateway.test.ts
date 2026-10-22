import { readFileSync } from 'node:fs';
import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { fakeStripe } from './fake-http.js';
import { createStripeGateway, InvalidStripeSignature, RECONCILE_BUDGET, STRIPE_API_VERSION, StripeGatewayError, WEBHOOK_BUDGET } from '../gateway.js';

/**
 * MUT-360 R8: the real adapter against a fake `fetch` under the real SDK. What is pinned here would otherwise only
 * break in production: the expand paths (a wrong one makes every subscription UNKNOWN_TIER), `status=all`, the page
 * walk, the API version header, the budgets, and that failures never carry the SDK's error object.
 *
 * Fixtures are written by hand to the pinned version's shapes (the SDK's types), not captured from an account.
 */
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')) as Record<string, unknown>;
const KEY = 'rk_test_mut360_fixture_key';
const WHSEC = 'whsec_mut360_fixture';
const NOW = new Date('2026-11-01T09:00:00.000Z');

const gateway = (httpClient: Stripe.HttpClient, budget: { timeoutMs: number; maxNetworkRetries: number } = WEBHOOK_BUDGET) =>
  createStripeGateway({ secretKey: KEY, webhookSecret: WHSEC, ...budget, now: () => NOW, httpClient });

const expands = (q: URLSearchParams) => [...q.entries()].filter(([k]) => k.startsWith('expand')).map(([, v]) => v);

describe('Stripe gateway (MUT-360)', () => {
  it('pins the SDK’s API version and sends it on every request', async () => {
    expect(STRIPE_API_VERSION).toBe(Stripe.API_VERSION);
    const { seen, httpClient } = fakeStripe(() => ({ status: 200, body: fixture('customer-linked') }));
    await gateway(httpClient).customer('cus_P01');
    expect(seen[0]!.headers.get('stripe-version')).toBe(STRIPE_API_VERSION);
    expect(seen[0]!.headers.get('authorization')).toBe(`Bearer ${KEY}`);
  });

  it('retrieves a subscription with its prices’ products and its customer expanded, stamped with the request time', async () => {
    const { seen, httpClient } = fakeStripe(() => ({ status: 200, body: fixture('subscription-expanded') }));
    const { value, fetchedAt } = await gateway(httpClient).subscription('sub_P01');
    expect(seen.map((s) => [s.method, s.path])).toEqual([['GET', '/v1/subscriptions/sub_P01']]);
    expect(expands(seen[0]!.query)).toEqual(['items.data.price.product', 'customer']);
    expect(fetchedAt).toEqual(NOW);
    expect((value.items.data[0]!.price.product as Stripe.Product).metadata.tier).toBe('freelancer');
    expect(value.items.data[0]!.current_period_end).toBe(1796083200);
  });

  it('lists every subscription page by page (status=all, 100 a page, customers expanded)', async () => {
    const sub = fixture('subscription-expanded');
    const { seen, httpClient } = fakeStripe((request) =>
      request.query.get('starting_after') === null
        ? { status: 200, body: { object: 'list', has_more: true, data: [{ ...sub, id: 'sub_1' }, { ...sub, id: 'sub_2' }] } }
        : { status: 200, body: { object: 'list', has_more: false, data: [{ ...sub, id: 'sub_3' }] } },
    );
    const ids: string[] = [];
    for await (const { value } of gateway(httpClient, RECONCILE_BUDGET).listSubscriptions()) ids.push(value.id);
    expect(ids).toEqual(['sub_1', 'sub_2', 'sub_3']);
    expect(seen).toHaveLength(2);
    for (const request of seen) {
      expect(request.path).toBe('/v1/subscriptions');
      expect(request.query.get('status')).toBe('all');
      expect(request.query.get('limit')).toBe('100');
      expect(expands(request.query)).toEqual(['data.customer']);
    }
    expect(seen[1]!.query.get('starting_after')).toBe('sub_2');
  });

  it('lists products, archived ones included, across pages', async () => {
    const product = fixture('product-freelancer');
    const { seen, httpClient } = fakeStripe((request) =>
      request.query.get('starting_after') === null
        ? { status: 200, body: { object: 'list', has_more: true, data: [product] } }
        : { status: 200, body: { object: 'list', has_more: false, data: [{ ...product, id: 'prod_OLD', active: false }] } },
    );
    const products = await gateway(httpClient, RECONCILE_BUDGET).listProducts();
    expect([...products.keys()]).toEqual(['prod_FREELANCER', 'prod_OLD']);
    expect(seen.every((s) => s.path === '/v1/products' && s.query.get('active') === null)).toBe(true);
  });

  it('the webhook budget never retries; the reconcile budget retries a retryable failure twice (D7)', async () => {
    const failing = () => fakeStripe(() => ({ status: 503, body: { error: { type: 'api_error', message: 'boom' } }, headers: { 'stripe-should-retry': 'true' } }));
    const webhook = failing();
    await expect(gateway(webhook.httpClient, WEBHOOK_BUDGET).customer('cus_P01')).rejects.toBeInstanceOf(StripeGatewayError);
    expect(webhook.seen).toHaveLength(1);
    const reconcile = failing();
    await expect(gateway(reconcile.httpClient, RECONCILE_BUDGET).customer('cus_P01')).rejects.toBeInstanceOf(StripeGatewayError);
    expect(reconcile.seen).toHaveLength(3);
  }, 15_000);

  it('reduces failures to code, type, request id and transient, with nothing from the request', async () => {
    const transient = fakeStripe(() => ({ status: 503, body: { error: { type: 'api_error', message: 'boom' } } }));
    const err = await gateway(transient.httpClient).customer('cus_P01').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StripeGatewayError);
    expect(err).toMatchObject({ transient: true, requestId: 'req_1' });
    expect(JSON.stringify(err)).not.toContain(KEY);
    expect((err as Error).message).not.toContain(KEY);

    // MUT-360 review: a revoked or under-scoped key is fixable and must not be acknowledged: Stripe has to redeliver.
    const revoked = fakeStripe(() => ({ status: 401, body: { error: { type: 'invalid_request_error', message: 'Invalid API Key provided' } } }));
    expect(await gateway(revoked.httpClient).customer('cus_P01').catch((e: unknown) => e)).toMatchObject({ transient: true });
    const scoped = fakeStripe(() => ({ status: 403, body: { error: { type: 'invalid_request_error', message: 'The provided key does not have the required permissions' } } }));
    expect(await gateway(scoped.httpClient).customer('cus_P01').catch((e: unknown) => e)).toMatchObject({ transient: true });

    const missing = fakeStripe(() => ({ status: 404, body: { error: { type: 'invalid_request_error', code: 'resource_missing', message: 'No such customer' } } }));
    expect(await gateway(missing.httpClient).customer('cus_GONE').catch((e: unknown) => e)).toMatchObject({ code: 'resource_missing', transient: false });
  });

  it('verifies a signature made with the endpoint secret and refuses any other', () => {
    const { httpClient } = fakeStripe(() => ({ status: 200, body: {} }));
    const g = gateway(httpClient);
    const payload = JSON.stringify({ id: 'evt_1', object: 'event', type: 'customer.updated', livemode: false, data: { object: { id: 'cus_P01' } } });
    const signer = new Stripe(KEY);
    const good = signer.webhooks.generateTestHeaderString({ payload, secret: WHSEC });
    expect(g.verifyEvent(payload, good)).toMatchObject({ id: 'evt_1', type: 'customer.updated' });
    const bad = signer.webhooks.generateTestHeaderString({ payload, secret: 'whsec_someone_else' });
    expect(() => g.verifyEvent(payload, bad)).toThrow(InvalidStripeSignature);
    expect(() => g.verifyEvent(payload, '')).toThrow(InvalidStripeSignature);
    const old = signer.webhooks.generateTestHeaderString({ payload, secret: WHSEC, timestamp: Math.floor(Date.now() / 1000) - 3600 });
    expect(() => g.verifyEvent(payload, old)).toThrow(InvalidStripeSignature);
  });

  it('knows a live key from a test key', () => {
    const { httpClient } = fakeStripe(() => ({ status: 200, body: {} }));
    expect(gateway(httpClient).livemode).toBe(false);
    expect(createStripeGateway({ secretKey: 'rk_live_x', webhookSecret: WHSEC, ...WEBHOOK_BUDGET, now: () => NOW, httpClient }).livemode).toBe(true);
  });
});
