import pino from 'pino';
import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { MemoryLedgerStore } from '../../../repositories/memory.js';
import { StripeGatewayError } from '../gateway.js';
import { createTaxFollowsAddress, IsraelVatRateMissing, type TaxFollowsAddress } from '../retax.js';
import { createStripeSync } from '../sync.js';
import { FakePlanGateway, FakeStripeGateway, stripeObjects } from './fake.js';

/** MUT-750 (ADR-290, slice A): the tax follows a billing address that moves into or out of Israel. */
const NOW = new Date('2026-11-27T09:00:00.000Z');
let n = 0;

describe('createTaxFollowsAddress', () => {
  function withPlan(over: { taxRateIds?: string[]; automaticTax?: boolean } = {}) {
    return new FakePlanGateway().withPlan('sub_1', 'cus_1', { taxRateIds: over.taxRateIds ?? [], automaticTax: over.automaticTax ?? true });
  }

  it('into Israel: the VAT rate on the item, Stripe Tax off', async () => {
    const plan = withPlan();
    const retax = createTaxFollowsAddress({ plan, israelVatRateId: async () => 'txr_il' });
    expect(await retax.retax({ subscriptionId: 'sub_1', country: 'IL' })).toBe('changed');
    expect(plan.retaxes).toEqual([{ subscriptionId: 'sub_1', itemId: plan.plans.get('sub_1')!.itemId, country: 'IL', taxRates: ['txr_il'], automaticTax: false }]);
  });

  it('out of Israel: no rate, Stripe Tax on', async () => {
    const plan = withPlan({ taxRateIds: ['txr_il'], automaticTax: false });
    const retax = createTaxFollowsAddress({ plan, israelVatRateId: async () => 'txr_il' });
    expect(await retax.retax({ subscriptionId: 'sub_1', country: 'JO' })).toBe('changed');
    expect(plan.retaxes[0]).toMatchObject({ country: 'JO', taxRates: [], automaticTax: true });
  });

  it('an item that already matches is left alone', async () => {
    const plan = withPlan({ taxRateIds: ['txr_il'], automaticTax: false });
    const retax = createTaxFollowsAddress({ plan, israelVatRateId: async () => 'txr_il' });
    expect(await retax.retax({ subscriptionId: 'sub_1', country: 'IL' })).toBe('unchanged');
    expect(plan.retaxes).toEqual([]);
  });

  it('Israel with no VAT rate in Stripe refuses (never taxed wrongly)', async () => {
    const plan = withPlan();
    const retax = createTaxFollowsAddress({ plan, israelVatRateId: async () => null });
    await expect(retax.retax({ subscriptionId: 'sub_1', country: 'IL' })).rejects.toBeInstanceOf(IsraelVatRateMissing);
    expect(plan.retaxes).toEqual([]);
  });
});

describe('customer.updated re-taxes plan subscriptions when the address crosses Israel', () => {
  function harness(retax: TaxFollowsAddress) {
    const store = new MemoryLedgerStore();
    const stripe = new FakeStripeGateway(() => NOW);
    stripe.products.set('prod_S', stripeObjects.product('prod_S', 'solo'));
    stripe.products.set('prod_F', stripeObjects.product('prod_F', 'freelancer'));
    const sync = createStripeSync({ store, webhookGateway: stripe, reconcileGateway: stripe, taxFollowsAddress: retax, logger: pino({ level: 'silent' }), now: () => NOW });
    const event = (type: string, object: Record<string, unknown>) => ({ id: `evt_750_${n++}`, object: 'event', type, livemode: false, created: 0, data: { object } }) as unknown as Stripe.Event;
    return { store, stripe, sync, event };
  }

  async function subscribed(h: ReturnType<typeof harness>, product: string, country: string) {
    const { user } = await h.store.users.create({ email: `r-${n++}@studio.ps`, displayName: 'Rana', passwordHash: 'x', locale: 'en', personal: { name: 'Personal', slug: `p-750-${n++}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at: NOW });
    h.stripe.customers.set('cus_1', stripeObjects.customer('cus_1', { mutaba3a_user_id: user.id }, country));
    h.stripe.subscriptions.set('sub_1', stripeObjects.subscription({ id: 'sub_1', customer: 'cus_1', product, currency: 'ils' }));
    await h.sync.handleEvent(h.event('customer.subscription.created', { id: 'sub_1' }), null);
    return user.id;
  }

  const recorder = () => {
    const calls: Array<{ subscriptionId: string; country: string | null }> = [];
    let fail: Error | null = null;
    const retax: TaxFollowsAddress = {
      async retax(input) {
        if (fail) throw fail;
        calls.push(input);
        return 'changed';
      },
    };
    return { calls, retax, failWith: (err: Error | null) => (fail = err) };
  };

  it('IL → JO and JO → IL call retax once each; the same country does nothing', async () => {
    const r = recorder();
    const h = harness(r.retax);
    const userId = await subscribed(h, 'prod_S', 'IL');
    h.stripe.customers.set('cus_1', stripeObjects.customer('cus_1', { mutaba3a_user_id: userId }, 'IL'));
    await h.sync.handleEvent(h.event('customer.updated', { id: 'cus_1' }), null);
    expect(r.calls).toEqual([]);
    h.stripe.customers.set('cus_1', stripeObjects.customer('cus_1', { mutaba3a_user_id: userId }, 'JO'));
    expect(await h.sync.handleEvent(h.event('customer.updated', { id: 'cus_1' }), null)).toMatchObject({ result: 'processed' });
    expect(r.calls).toEqual([{ subscriptionId: 'sub_1', country: 'JO' }]);
    h.stripe.customers.set('cus_1', stripeObjects.customer('cus_1', { mutaba3a_user_id: userId }, 'IL'));
    await h.sync.handleEvent(h.event('customer.updated', { id: 'cus_1' }), null);
    expect(r.calls.at(-1)).toEqual({ subscriptionId: 'sub_1', country: 'IL' });
    expect(r.calls).toHaveLength(2);
  });

  it('the legacy Freelancer plan keeps Stripe Tax (plan Q2): never re-taxed', async () => {
    const r = recorder();
    const h = harness(r.retax);
    const userId = await subscribed(h, 'prod_F', 'IL');
    h.stripe.customers.set('cus_1', stripeObjects.customer('cus_1', { mutaba3a_user_id: userId }, 'JO'));
    await h.sync.handleEvent(h.event('customer.updated', { id: 'cus_1' }), null);
    expect(r.calls).toEqual([]);
  });

  it('a failed re-tax is an error and leaves the old country, so the redelivery tries again', async () => {
    const r = recorder();
    const h = harness(r.retax);
    const userId = await subscribed(h, 'prod_S', 'IL');
    h.stripe.customers.set('cus_1', stripeObjects.customer('cus_1', { mutaba3a_user_id: userId }, 'JO'));
    // Transient: 500, so Stripe redelivers.
    r.failWith(new StripeGatewayError({ code: null, type: 'StripeAPIError', requestId: 'req_1', transient: true }));
    expect(await h.sync.handleEvent(h.event('customer.updated', { id: 'cus_1' }), null)).toMatchObject({ status: 500, result: 'error' });
    expect((await h.store.billing.getAccount('cus_1'))?.country).toBe('IL');
    // Refused: recorded for the operator (the event stays unprocessed for a resend), country still not saved.
    r.failWith(new StripeGatewayError({ code: 'resource_missing', type: 'StripeInvalidRequestError', requestId: 'req_2', transient: false }));
    expect(await h.sync.handleEvent(h.event('customer.updated', { id: 'cus_1' }), null)).toMatchObject({ status: 200, result: 'error', codes: ['STRIPE_RETAX_FAILED'] });
    expect((await h.store.billing.getAccount('cus_1'))?.country).toBe('IL');
    r.failWith(null);
    await h.sync.handleEvent(h.event('customer.updated', { id: 'cus_1' }), null);
    expect(r.calls).toEqual([{ subscriptionId: 'sub_1', country: 'JO' }]);
    expect((await h.store.billing.getAccount('cus_1'))?.country).toBe('JO');
  });
});
