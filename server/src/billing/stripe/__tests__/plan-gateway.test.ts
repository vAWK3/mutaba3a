import { describe, expect, it } from 'vitest';
import { CATALOG_FAILURE_TTL_MS, CATALOG_TTL_MS, CHECKOUT_BUDGET } from '../checkout-gateway.js';
import { STRIPE_API_VERSION, StripeGatewayError } from '../gateway.js';
import { createPlanGateway } from '../plan-gateway.js';
import { fakeStripe, type SeenRequest } from './fake-http.js';

/**
 * MUT-531 (plan §2.2, D1, D4, R1, R2): the plan door under the real SDK and a fake fetch. Pinned here: the paid-invoice
 * count and its cache, the preview's and the switch's bodies (one proration date, no discount, pending_if_incomplete),
 * and how an unpaid switch invoice is told apart.
 */
const KEY = 'rk_test_mut531_fixture_key';
const T0 = new Date('2026-11-02T09:00:00.000Z');
const PRORATION = new Date('2026-11-02T09:00:00.000Z');
const list = (data: unknown[]) => ({ object: 'list', has_more: false, data });
const invoice = (amountPaid: number) => ({ id: `in_${amountPaid}_${Math.random()}`, object: 'invoice', amount_paid: amountPaid, status: 'paid' });
const route = (s: SeenRequest) => `${s.method} ${s.path}`;

function gatewayWith(respond: Parameters<typeof fakeStripe>[0], clock = { now: T0 }) {
  const fake = fakeStripe(respond);
  return { ...fake, clock, gateway: createPlanGateway({ secretKey: KEY, ...CHECKOUT_BUDGET, now: () => clock.now, httpClient: fake.httpClient }) };
}

const subscription = (over: Record<string, unknown> = {}) => ({
  id: 'sub_1',
  object: 'subscription',
  customer: 'cus_1',
  status: 'active',
  cancel_at_period_end: false,
  cancel_at: null,
  discounts: [],
  pause_collection: null,
  pending_update: null,
  latest_invoice: 'in_latest',
  items: { object: 'list', data: [{ id: 'si_1', current_period_start: 1_790_000_000, current_period_end: 1_792_000_000, price: { id: 'price_m', lookup_key: 'freelancer_list_monthly_ils' } }] },
  ...over,
});
const SWITCH = { subscriptionId: 'sub_1', customer: 'cus_1', itemId: 'si_1', yearlyPriceId: 'price_y', prorationDate: PRORATION };

describe('PlanGateway.planOf', () => {
  it('reads the item, discount, pause and cancel state Stripe holds now', async () => {
    const { gateway, seen } = gatewayWith(() => ({ status: 200, body: subscription({ discounts: ['di_1'], pause_collection: { behavior: 'void', resumes_at: 1_795_000_000 } }) }));
    expect(await gateway.planOf('sub_1')).toEqual({
      id: 'sub_1',
      customer: 'cus_1',
      status: 'active',
      itemId: 'si_1',
      lookupKey: 'freelancer_list_monthly_ils',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: new Date(1_792_000_000 * 1000),
      discounted: true,
      paused: true,
      clockNow: null,
    });
    expect(seen.map(route)).toEqual(['GET /v1/subscriptions/sub_1']);
    expect(seen[0]!.query.get('expand[0]')).toBe('test_clock');
    expect(seen[0]!.headers.get('stripe-version')).toBe(STRIPE_API_VERSION);
  });
});

describe('PlanGateway.planOf on a sandbox test clock', () => {
  it('reads the clock’s frozen time, which the switch prorates at', async () => {
    const { gateway } = gatewayWith(() => ({ status: 200, body: subscription({ test_clock: { id: 'clock_1', object: 'test_helpers.test_clock', frozen_time: 1_790_000_000 } }) }));
    expect((await gateway.planOf('sub_1')).clockNow).toEqual(new Date(1_790_000_000 * 1000));
  });
});

describe('PlanGateway.paidInvoiceCount (R1)', () => {
  it('counts paid invoices that took money, never the ₪0 trial invoice', async () => {
    const { gateway, seen } = gatewayWith(() => ({ status: 200, body: list([invoice(0), invoice(2900)]) }));
    expect(await gateway.paidInvoiceCount('sub_1')).toBe(1);
    expect(seen[0]!.query.get('subscription')).toBe('sub_1');
    expect(seen[0]!.query.get('status')).toBe('paid');
  });

  it('keeps a count of 2 for good, and asks again for a lower one only after the catalog TTL', async () => {
    let answer = [invoice(2900)];
    const { gateway, seen, clock } = gatewayWith(() => ({ status: 200, body: list(answer) }));
    expect(await gateway.paidInvoiceCount('sub_1')).toBe(1);
    clock.now = new Date(T0.getTime() + CATALOG_TTL_MS - 1);
    expect(await gateway.paidInvoiceCount('sub_1')).toBe(1);
    expect(seen).toHaveLength(1);
    answer = [invoice(2900), invoice(2900)];
    clock.now = new Date(T0.getTime() + CATALOG_TTL_MS);
    expect(await gateway.paidInvoiceCount('sub_1')).toBe(2);
    clock.now = new Date(T0.getTime() + 100 * CATALOG_TTL_MS);
    expect(await gateway.paidInvoiceCount('sub_1')).toBe(2);
    expect(seen).toHaveLength(2);
  });

  it('answers a failure again for a minute, and `fresh` always asks Stripe', async () => {
    let fail = true;
    const { gateway, seen, clock } = gatewayWith(() => (fail ? { status: 500, body: { error: { type: 'api_error' } } } : { status: 200, body: list([invoice(2900), invoice(2900)]) }));
    await expect(gateway.paidInvoiceCount('sub_1')).rejects.toBeInstanceOf(StripeGatewayError);
    const failedCalls = seen.length;
    fail = false;
    await expect(gateway.paidInvoiceCount('sub_1')).rejects.toBeInstanceOf(StripeGatewayError);
    expect(seen).toHaveLength(failedCalls);
    expect(await gateway.paidInvoiceCount('sub_1', { fresh: true })).toBe(2);
    clock.now = new Date(T0.getTime() + CATALOG_FAILURE_TTL_MS);
    expect(await gateway.paidInvoiceCount('sub_1')).toBe(2);
  });
});

describe('PlanGateway.previewYearlySwitch (D1)', () => {
  it("previews the item's move to the yearly price at the given proration date, and reads what is due today", async () => {
    // The spike's shape: a credit for the month's unused part, and the year from today to the billing day's anniversary.
    const lines = list([
      { object: 'line_item', amount: -2888, period: { start: 1_793_635_257, end: 1_796_216_577 } },
      { object: 'line_item', amount: 26527, period: { start: 1_793_635_257, end: 1_822_482_177 } },
    ]);
    const { gateway, seen } = gatewayWith(() => ({ status: 200, body: { object: 'invoice', amount_due: 23639, currency: 'ils', lines } }));
    expect(await gateway.previewYearlySwitch(SWITCH)).toEqual({ amountDue: 23639, currency: 'ILS', renewsOn: new Date(1_822_482_177 * 1000) });
    const call = seen[0]!;
    expect(route(call)).toBe('POST /v1/invoices/create_preview');
    expect(call.form.get('customer')).toBe('cus_1');
    expect(call.form.get('subscription')).toBe('sub_1');
    expect(call.form.get('subscription_details[items][0][id]')).toBe('si_1');
    expect(call.form.get('subscription_details[items][0][price]')).toBe('price_y');
    expect(call.form.get('subscription_details[proration_behavior]')).toBe('always_invoice');
    expect(call.form.get('subscription_details[proration_date]')).toBe(String(PRORATION.getTime() / 1000));
  });
});

describe('PlanGateway.switchToYearly (D1, D4, R2)', () => {
  it('moves the item to the yearly price with the previewed proration date, no discount, and an idempotency key', async () => {
    const { gateway, seen } = gatewayWith(() => ({ status: 200, body: subscription({ items: { object: 'list', data: [{ id: 'si_1', current_period_end: 1_823_000_000, price: { id: 'price_y' } }] } }) }));
    expect(await gateway.switchToYearly(SWITCH)).toEqual({ outcome: 'switched', currentPeriodEnd: new Date(1_823_000_000 * 1000) });
    const call = seen[0]!;
    expect(route(call)).toBe('POST /v1/subscriptions/sub_1');
    expect(call.form.get('items[0][id]')).toBe('si_1');
    expect(call.form.get('items[0][price]')).toBe('price_y');
    expect(call.form.get('proration_behavior')).toBe('always_invoice');
    expect(call.form.get('proration_date')).toBe(String(PRORATION.getTime() / 1000));
    expect(call.form.get('payment_behavior')).toBe('pending_if_incomplete');
    expect([...call.form.keys()].some((k) => k.startsWith('discounts') || k.startsWith('coupon') || k.startsWith('promotion'))).toBe(false);
    expect(call.headers.get('idempotency-key')).toBe(`mut531-switch-sub_1-price_y-${PRORATION.getTime() / 1000}`);
  });

  it('a payment waiting for 3-D Secure comes back with Stripe’s invoice page (R2)', async () => {
    const { gateway, seen } = gatewayWith((request) =>
      request.path === '/v1/subscriptions/sub_1'
        ? { status: 200, body: subscription({ pending_update: { expires_at: 1 }, latest_invoice: 'in_9' }) }
        : { status: 200, body: { id: 'in_9', object: 'invoice', hosted_invoice_url: 'https://invoice.stripe.com/i/acct_1/in_9', payments: list([{ payment: { payment_intent: { id: 'pi_1', object: 'payment_intent', status: 'requires_action' } } }]) } },
    );
    expect(await gateway.switchToYearly(SWITCH)).toEqual({ outcome: 'payment-needs-action', hostedInvoiceUrl: 'https://invoice.stripe.com/i/acct_1/in_9' });
    expect(seen[1]!.query.get('expand[0]')).toBe('payments.data.payment.payment_intent');
  });

  it('a declined card leaves the plan monthly and says so', async () => {
    const { gateway } = gatewayWith((request) =>
      request.path === '/v1/subscriptions/sub_1'
        ? { status: 200, body: subscription({ pending_update: { expires_at: 1 }, latest_invoice: 'in_9' }) }
        : { status: 200, body: { id: 'in_9', object: 'invoice', hosted_invoice_url: 'https://invoice.stripe.com/i/x', payments: list([{ payment: { payment_intent: { id: 'pi_1', object: 'payment_intent', status: 'requires_payment_method' } } }]) } },
    );
    expect(await gateway.switchToYearly(SWITCH)).toEqual({ outcome: 'payment-failed' });
  });

  it('a Stripe refusal surfaces as a gateway error, not a switch', async () => {
    const { gateway } = gatewayWith(() => ({ status: 400, body: { error: { type: 'invalid_request_error', code: 'resource_missing', param: 'items[0][price]' } } }));
    await expect(gateway.switchToYearly(SWITCH)).rejects.toMatchObject({ code: 'resource_missing', transient: false });
  });
});
