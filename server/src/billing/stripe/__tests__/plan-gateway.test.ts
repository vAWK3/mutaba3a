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
  billing_cycle_anchor: 1_784_000_000,
  automatic_tax: { enabled: true },
  schedule: null,
  metadata: {},
  items: {
    object: 'list',
    data: [
      {
        id: 'si_1',
        current_period_start: 1_790_000_000,
        current_period_end: 1_792_000_000,
        price: { id: 'price_m', lookup_key: 'freelancer_list_monthly_ils', currency: 'ils', unit_amount: 2900, product: 'prod_F', tax_behavior: 'exclusive' },
      },
    ],
  },
  ...over,
});
const SWITCH = { subscriptionId: 'sub_1', customer: 'cus_1', itemId: 'si_1', yearlyPriceId: 'price_y', prorationDate: PRORATION };

describe('PlanGateway.planOf', () => {
  it('reads the item, discount, pause and cancel state Stripe holds now', async () => {
    const discounts = [{ id: 'di_1', object: 'discount', source: { type: 'coupon', coupon: 'mtb3a_stay_monthly_50' } }];
    const pause = { behavior: 'void', resumes_at: 1_795_000_000 };
    const { gateway, seen } = gatewayWith(() => ({ status: 200, body: subscription({ discounts, pause_collection: pause, metadata: { mutaba3a_pause_from: '2026-09-21T08:53:20.000Z' } }) }));
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
      billingCycleAnchor: new Date(1_784_000_000 * 1000),
      price: { id: 'price_m', currency: 'ils', productId: 'prod_F', unitAmount: 2900, taxBehavior: 'exclusive' },
      couponIds: ['mtb3a_stay_monthly_50'],
      pause: { from: new Date('2026-09-21T08:53:20.000Z'), resumesAt: new Date(1_795_000_000 * 1000) },
      automaticTax: true,
      managedBySchedule: false,
    });
    expect(seen.map(route)).toEqual(['GET /v1/subscriptions/sub_1']);
    expect([seen[0]!.query.get('expand[0]'), seen[0]!.query.get('expand[1]')]).toEqual(['test_clock', 'discounts']);
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

/** MUT-532 (plan §2.2, D6–D8, D11; spike: mut-532-pause-spike-result.md). */
describe('PlanGateway.schedulePause (D6)', () => {
  it('voids collection until resumes_at and names its own start in the metadata, with an idempotency key', async () => {
    const { gateway, seen } = gatewayWith(() => ({ status: 200, body: subscription() }));
    const from = new Date('2026-12-02T13:00:00.000Z');
    const resumesAt = new Date('2027-02-02T12:00:00.000Z');
    await gateway.schedulePause({ subscriptionId: 'sub_1', from, resumesAt, months: 2 });
    const call = seen[0]!;
    expect(route(call)).toBe('POST /v1/subscriptions/sub_1');
    expect(call.form.get('pause_collection[behavior]')).toBe('void');
    expect(call.form.get('pause_collection[resumes_at]')).toBe(String(resumesAt.getTime() / 1000));
    expect(call.form.get('metadata[mutaba3a_pause_from]')).toBe('2026-12-02T13:00:00.000Z');
    expect(call.form.get('metadata[mutaba3a_pause_months]')).toBe('2');
    expect(call.headers.get('idempotency-key')).toBe(`mut532-pause-sub_1-${resumesAt.getTime() / 1000}`);
  });
});

describe('PlanGateway.endPause (D7)', () => {
  it('before it starts: clears the pause and its metadata, and charges nothing', async () => {
    const { gateway, seen } = gatewayWith(() => ({ status: 200, body: subscription() }));
    expect(await gateway.endPause({ subscriptionId: 'sub_1', mode: 'undo' })).toEqual({ outcome: 'undone' });
    expect(seen.map(route)).toEqual(['POST /v1/subscriptions/sub_1']);
    expect(seen[0]!.form.get('pause_collection')).toBe('');
    expect(seen[0]!.form.get('metadata[mutaba3a_pause_from]')).toBe('');
    expect(seen[0]!.form.get('metadata[mutaba3a_pause_months]')).toBe('');
    expect(seen[0]!.form.has('billing_cycle_anchor[type]')).toBe(false);
  });

  it('Resume now: restarts the cycle today, then charges the month as its own invoice on the subscription (the spike)', async () => {
    const restarted = subscription({ items: { object: 'list', data: [{ id: 'si_1', current_period_start: 1_796_000_000, current_period_end: 1_798_600_000, price: subscription().items.data[0]!.price }] } });
    const { gateway, seen } = gatewayWith((request) => {
      if (request.path === '/v1/subscriptions/sub_1') return { status: 200, body: restarted };
      if (request.path === '/v1/invoiceitems') return { status: 200, body: { id: 'ii_1', object: 'invoiceitem' } };
      if (request.path === '/v1/invoices') return { status: 200, body: { id: 'in_resume', object: 'invoice', status: 'draft' } };
      if (request.path === '/v1/invoices/in_resume/finalize') return { status: 200, body: { id: 'in_resume', object: 'invoice', status: 'open' } };
      return { status: 200, body: { id: 'in_resume', object: 'invoice', status: 'paid', amount_paid: 2900 } };
    });
    expect(await gateway.endPause({ subscriptionId: 'sub_1', mode: 'now' })).toEqual({ outcome: 'charged' });
    expect(seen.map(route)).toEqual(['POST /v1/subscriptions/sub_1', 'POST /v1/invoiceitems', 'POST /v1/invoices', 'POST /v1/invoices/in_resume/finalize', 'POST /v1/invoices/in_resume/pay']);
    const [restart, item, invoice] = seen;
    expect(restart!.form.get('pause_collection')).toBe('');
    expect(restart!.form.get('billing_cycle_anchor[type]')).toBe('now');
    expect(restart!.form.get('proration_behavior')).toBe('none');
    expect(item!.form.get('customer')).toBe('cus_1');
    expect(item!.form.get('subscription')).toBe('sub_1');
    expect(item!.form.get('price_data[currency]')).toBe('ils');
    expect(item!.form.get('price_data[product]')).toBe('prod_F');
    expect(item!.form.get('price_data[unit_amount]')).toBe('2900');
    expect(item!.form.get('price_data[tax_behavior]')).toBe('exclusive');
    expect(item!.form.get('period[start]')).toBe('1796000000');
    expect(item!.form.get('period[end]')).toBe('1798600000');
    expect(invoice!.form.get('subscription')).toBe('sub_1');
    expect(invoice!.form.get('auto_advance')).toBe('true');
    expect(invoice!.form.get('automatic_tax[enabled]')).toBe('true');
    expect(restart!.headers.get('idempotency-key')).toMatch(/^mut532-resume-sub_1-\d+$/);
    expect(item!.headers.get('idempotency-key')).toBe(restart!.headers.get('idempotency-key')!.replace('resume', 'resume-item'));
  });

  it('Resume now with a declined card: the plan is restarted and Stripe retries the invoice (past_due, GRACE)', async () => {
    const restarted = subscription();
    const { gateway } = gatewayWith((request) => {
      if (request.path === '/v1/subscriptions/sub_1') return { status: 200, body: restarted };
      if (request.path === '/v1/invoices/in_resume/pay') return { status: 402, body: { error: { type: 'card_error', code: 'card_declined' } } };
      if (request.path === '/v1/invoices/in_resume') return { status: 200, body: { id: 'in_resume', object: 'invoice', status: 'open', payments: list([]) } };
      return { status: 200, body: { id: request.path === '/v1/invoiceitems' ? 'ii_1' : 'in_resume', object: 'invoice', status: 'open' } };
    });
    expect(await gateway.endPause({ subscriptionId: 'sub_1', mode: 'now' })).toEqual({ outcome: 'payment-failed' });
  });
});

describe('PlanGateway cancel and keep (D8)', () => {
  it('cancels at the period end with Stripe\'s feedback and the comment', async () => {
    const { gateway, seen } = gatewayWith(() => ({ status: 200, body: subscription({ cancel_at_period_end: true }) }));
    expect(await gateway.cancelAtPeriodEnd({ subscriptionId: 'sub_1', feedback: 'too_expensive', comment: 'Too much for now' })).toEqual({ endsOn: new Date(1_792_000_000 * 1000) });
    const call = seen[0]!;
    expect(call.form.get('cancel_at_period_end')).toBe('true');
    expect(call.form.get('cancellation_details[feedback]')).toBe('too_expensive');
    expect(call.form.get('cancellation_details[comment]')).toBe('Too much for now');
    expect(call.headers.get('idempotency-key')).toMatch(/^mut532-cancel-sub_1-\d+$/);
  });

  it('sends no comment when there is none', async () => {
    const { gateway, seen } = gatewayWith(() => ({ status: 200, body: subscription({ cancel_at_period_end: true }) }));
    await gateway.cancelAtPeriodEnd({ subscriptionId: 'sub_1', feedback: 'other', comment: null });
    expect(seen[0]!.form.has('cancellation_details[comment]')).toBe(false);
  });

  it('Keep my plan clears the cancel, the portal\'s cancel_at form included (one call clears both: the probe)', async () => {
    const { gateway, seen } = gatewayWith(() => ({ status: 200, body: subscription() }));
    await gateway.keepPlan('sub_1');
    expect(seen[0]!.form.get('cancel_at_period_end')).toBe('false');
  });
});

describe('PlanGateway.applyCoupon (D11)', () => {
  it('puts the coupon on the subscription, once, with an idempotency key', async () => {
    const { gateway, seen } = gatewayWith(() => ({ status: 200, body: subscription() }));
    await gateway.applyCoupon('sub_1', 'mtb3a_stay_monthly_50');
    expect(seen[0]!.form.get('discounts[0][coupon]')).toBe('mtb3a_stay_monthly_50');
    expect(seen[0]!.headers.get('idempotency-key')).toBe('mut532-stay-sub_1-mtb3a_stay_monthly_50');
  });
});

describe('PlanGateway.failedPaymentOf (MUT-533 D2)', () => {
  const openInvoice = (id: string, created: number, over: Record<string, unknown> = {}) => ({
    id,
    object: 'invoice',
    status: 'open',
    created,
    attempted: true,
    attempt_count: 2,
    next_payment_attempt: 1_792_500_000,
    status_transitions: { finalized_at: created + 3600 },
    ...over,
  });
  const withIntent = (id: string, status: string) => ({ id, object: 'invoice', payments: list([{ payment: { payment_intent: { id: 'pi_1', object: 'payment_intent', status } } }]) });

  it('the oldest open invoice a payment was attempted on is the episode; its first attempt is when it was finalized', async () => {
    const { gateway, seen } = gatewayWith((request) => {
      if (request.path === '/v1/subscriptions/sub_1') return { status: 200, body: subscription({ status: 'past_due' }) };
      if (request.path === '/v1/invoices') return { status: 200, body: list([openInvoice('in_new', 1_792_000_000), openInvoice('in_old', 1_789_000_000), openInvoice('in_draft', 1_788_000_000, { attempted: false })]) };
      return { status: 200, body: withIntent('in_old', 'requires_payment_method') };
    });
    expect(await gateway.failedPaymentOf('sub_1')).toEqual({
      status: 'past_due',
      episode: { invoiceId: 'in_old', attemptCount: 2, nextPaymentAttempt: new Date(1_792_500_000_000), firstFailedAt: new Date(1_789_003_600_000), needsAuthentication: false },
    });
    expect(seen.map(route)).toEqual(['GET /v1/subscriptions/sub_1', 'GET /v1/invoices', 'GET /v1/invoices/in_old']);
    expect(seen[1]!.query.get('subscription')).toBe('sub_1');
    expect(seen[1]!.query.get('status')).toBe('open');
    // R1: Stripe refuses more than 4 levels; the intent is read from the invoice, never from the subscription.
    const expand = seen[2]!.query.get('expand[0]')!;
    expect(expand).toBe('payments.data.payment.payment_intent');
    expect(expand.split('.').length).toBeLessThanOrEqual(4);
  });

  it('a payment the bank wants confirmed (3-D Secure) says so; no retry is booked for it', async () => {
    const { gateway } = gatewayWith((request) => {
      if (request.path === '/v1/subscriptions/sub_1') return { status: 200, body: subscription({ status: 'past_due' }) };
      if (request.path === '/v1/invoices') return { status: 200, body: list([openInvoice('in_9', 1_789_000_000, { attempt_count: 0, next_payment_attempt: null })]) };
      return { status: 200, body: withIntent('in_9', 'requires_action') };
    });
    expect((await gateway.failedPaymentOf('sub_1'))?.episode).toMatchObject({ invoiceId: 'in_9', needsAuthentication: true, nextPaymentAttempt: null });
  });

  it('a subscription no longer past_due costs one read; no open attempted invoice is no episode', async () => {
    const active = gatewayWith(() => ({ status: 200, body: subscription({ status: 'active' }) }));
    expect(await active.gateway.failedPaymentOf('sub_1')).toEqual({ status: 'active', episode: null });
    expect(active.seen).toHaveLength(1);
    const settled = gatewayWith((request) => (request.path === '/v1/invoices' ? { status: 200, body: list([]) } : { status: 200, body: subscription({ status: 'past_due' }) }));
    expect(await settled.gateway.failedPaymentOf('sub_1')).toEqual({ status: 'past_due', episode: null });
  });

  it('a subscription Stripe no longer has is null', async () => {
    const { gateway } = gatewayWith(() => ({ status: 404, body: { error: { type: 'invalid_request_error', code: 'resource_missing', message: 'No such subscription' } } }));
    expect(await gateway.failedPaymentOf('sub_1')).toBeNull();
  });
});
