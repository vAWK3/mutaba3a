import { describe, expect, it } from 'vitest';
import { createAccountStripeGateway } from '../account-gateway.js';
import { CHECKOUT_BUDGET } from '../checkout-gateway.js';
import { STRIPE_API_VERSION, StripeGatewayError } from '../gateway.js';
import { fakeStripe, type SeenRequest } from './fake-http.js';

/**
 * MUT-333 (D1, R5–R7): closing an account's calls to Stripe, under the real SDK and a fake fetch. Pinned: whose
 * customers are found, what is read live, what each write sends, and that a missing object counts as done.
 */
const KEY = 'rk_test_mut333_fixture_key';
const PERSON = { userId: '11111111-1111-4111-8111-111111111111', email: 'nour@studio.ps' };
const list = (data: unknown[]) => ({ object: 'list', has_more: false, data });
const missing = { status: 404, body: { error: { type: 'invalid_request_error', code: 'resource_missing', message: 'No such customer' } } };
const route = (s: SeenRequest) => `${s.method} ${s.path}`;

function gatewayWith(respond: Parameters<typeof fakeStripe>[0]) {
  const fake = fakeStripe(respond);
  return { ...fake, gateway: createAccountStripeGateway({ secretKey: KEY, ...CHECKOUT_BUDGET, httpClient: fake.httpClient }) };
}

describe('AccountStripeGateway (MUT-333)', () => {
  it('finds only the customers whose metadata names this person, by exact email (R5)', async () => {
    const { seen, gateway } = gatewayWith(() => ({
      status: 200,
      body: list([
        { id: 'cus_MINE', object: 'customer', email: PERSON.email, metadata: { mutaba3a_user_id: PERSON.userId } },
        { id: 'cus_SOMEONE', object: 'customer', email: PERSON.email, metadata: { mutaba3a_user_id: '99999999-9999-4999-8999-999999999999' } },
        { id: 'cus_NOBODY', object: 'customer', email: PERSON.email, metadata: {} },
        { id: 'cus_MINE_TOO', object: 'customer', email: PERSON.email, metadata: { mutaba3a_user_id: PERSON.userId } },
      ]),
    }));
    expect(await gateway.customersOf(PERSON)).toEqual(['cus_MINE', 'cus_MINE_TOO']);
    expect(seen.map(route)).toEqual(['GET /v1/customers']);
    expect(seen[0]!.query.get('email')).toBe(PERSON.email);
    expect(seen[0]!.headers.get('stripe-version')).toBe(STRIPE_API_VERSION);
  });

  it('reads the customer’s subscriptions live, with whether each already ends (R6)', async () => {
    const { seen, gateway } = gatewayWith(() => ({
      status: 200,
      body: list([
        { id: 'sub_1', object: 'subscription', status: 'active', cancel_at_period_end: false, cancel_at: null },
        { id: 'sub_2', object: 'subscription', status: 'active', cancel_at_period_end: false, cancel_at: 1796083200 },
      ]),
    }));
    expect(await gateway.liveSubscriptionsOf('cus_MINE')).toEqual([
      { id: 'sub_1', status: 'active', cancelAtPeriodEnd: false, cancelAt: null },
      { id: 'sub_2', status: 'active', cancelAtPeriodEnd: false, cancelAt: new Date(1796083200 * 1000) },
    ]);
    expect(seen[0]!.query.get('customer')).toBe('cus_MINE');
    expect(seen[0]!.query.get('status')).toBe('all');
  });

  it('sets and clears cancel_at_period_end, and cancels a failing subscription at once (D1, R7)', async () => {
    const { seen, gateway } = gatewayWith(() => ({ status: 200, body: { id: 'sub_1', object: 'subscription' } }));
    await gateway.setCancelAtPeriodEnd('sub_1', true);
    await gateway.setCancelAtPeriodEnd('sub_1', false);
    await gateway.cancelNow('sub_2');
    expect(seen.map(route)).toEqual(['POST /v1/subscriptions/sub_1', 'POST /v1/subscriptions/sub_1', 'DELETE /v1/subscriptions/sub_2']);
    expect(seen[0]!.form.get('cancel_at_period_end')).toBe('true');
    expect(seen[1]!.form.get('cancel_at_period_end')).toBe('false');
  });

  it('expires every open checkout of the customer (R5)', async () => {
    const { seen, gateway } = gatewayWith((request) =>
      request.method === 'GET' ? { status: 200, body: list([{ id: 'cs_1', object: 'checkout.session' }, { id: 'cs_2', object: 'checkout.session' }]) } : { status: 200, body: { id: 'cs', object: 'checkout.session' } },
    );
    expect(await gateway.expireOpenCheckouts('cus_MINE')).toBe(2);
    expect(seen.map(route)).toEqual(['GET /v1/checkout/sessions', 'POST /v1/checkout/sessions/cs_1/expire', 'POST /v1/checkout/sessions/cs_2/expire']);
    expect(seen[0]!.query.get('status')).toBe('open');
  });

  it('deletes a customer, and counts one Stripe no longer has as deleted', async () => {
    const { seen, gateway } = gatewayWith((_request, call) => (call === 1 ? { status: 200, body: { id: 'cus_A', object: 'customer', deleted: true } } : missing));
    await gateway.deleteCustomer('cus_A');
    await gateway.deleteCustomer('cus_GONE');
    expect(seen.map(route)).toEqual(['DELETE /v1/customers/cus_A', 'DELETE /v1/customers/cus_GONE']);
  });

  it('lets any other failure through as a StripeGatewayError, never the SDK’s error', async () => {
    const { gateway } = gatewayWith(() => ({ status: 500, body: { error: { type: 'api_error', message: 'boom' } } }));
    await expect(gateway.deleteCustomer('cus_A')).rejects.toBeInstanceOf(StripeGatewayError);
    await expect(gateway.setCancelAtPeriodEnd('sub_1', true)).rejects.toBeInstanceOf(StripeGatewayError);
  });
});
