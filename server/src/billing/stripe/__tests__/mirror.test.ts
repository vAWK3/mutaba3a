import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { customerIdOf, mirrorOf, subscriptionIdOfInvoice } from '../mirror.js';

/** MUT-360 §2.2: one Stripe subscription → the fields billing_subscriptions mirrors. Pure. */
const ORG = '22222222-2222-4222-8222-222222222222';
const product = (id: string, tier?: string) => ({ id, object: 'product', active: true, name: id, metadata: tier ? { tier } : {} }) as unknown as Stripe.Product;
const item = (productOrId: Stripe.Product | string, end: number, lookupKey: string | null = 'freelancer_founder_monthly_ils') =>
  ({ id: `si_${end}`, object: 'subscription_item', current_period_end: end, price: { id: `price_${end}`, lookup_key: lookupKey, product: productOrId } }) as unknown as Stripe.SubscriptionItem;

function subscription(partial: Record<string, unknown> = {}, items: Stripe.SubscriptionItem[] = [item(product('prod_F', 'freelancer'), 1796083200)]): Stripe.Subscription {
  return {
    id: 'sub_1',
    object: 'subscription',
    status: 'active',
    cancel_at_period_end: false,
    currency: 'ils',
    customer: 'cus_1',
    metadata: {},
    items: { object: 'list', has_more: false, data: items },
    ...partial,
  } as unknown as Stripe.Subscription;
}

describe('mirrorOf (MUT-360)', () => {
  it('maps an expanded subscription', () => {
    expect(mirrorOf(subscription(), new Map())).toEqual({
      ok: {
        tier: 'FREELANCER',
        organizationId: null,
        status: 'active',
        currentPeriodEnd: new Date(1796083200 * 1000),
        cancelAtPeriodEnd: false,
        priceLookupKey: 'freelancer_founder_monthly_ils',
        founderUntil: null,
        currency: 'ILS',
      },
      notes: [],
    });
  });

  it('takes the tier from product metadata, never the amount, and resolves an unexpanded product from the list', () => {
    const listed = subscription({}, [item('prod_FIRM', 1796083200, 'firm_founder_monthly_usd')]);
    const products = new Map([['prod_FIRM', product('prod_FIRM', 'firm')]]);
    expect(mirrorOf({ ...listed, metadata: { mutaba3a_organization_id: ORG } }, products)).toMatchObject({ ok: { tier: 'FIRM', priceLookupKey: 'firm_founder_monthly_usd', organizationId: ORG } });
  });

  it('refuses to guess a tier: none, an unknown product, or mixed tiers', () => {
    expect(mirrorOf(subscription({}, [item(product('prod_X'), 1)]), new Map())).toEqual({ error: 'UNKNOWN_TIER' });
    expect(mirrorOf(subscription({}, [item('prod_MISSING', 1)]), new Map())).toEqual({ error: 'UNKNOWN_TIER' });
    expect(mirrorOf(subscription({}, [item(product('prod_A', 'freelancer'), 1), item(product('prod_B', 'firm'), 2)]), new Map())).toEqual({ error: 'UNKNOWN_TIER' });
    // An add-on item with no tier beside a tiered one is fine.
    expect(mirrorOf(subscription({}, [item(product('prod_A', 'Freelancer'), 5), item(product('prod_ADDON'), 9, null)]), new Map())).toMatchObject({ ok: { tier: 'FREELANCER', currentPeriodEnd: new Date(9000) } });
  });

  it('reads the period from the items (latest wins), falling back to a pre-basil top-level field', () => {
    expect(mirrorOf(subscription({}, [item(product('prod_A', 'freelancer'), 100), item(product('prod_B'), 300)]), new Map())).toMatchObject({ ok: { currentPeriodEnd: new Date(300_000) } });
    const legacyItem = { ...item(product('prod_A', 'freelancer'), 0), current_period_end: undefined } as unknown as Stripe.SubscriptionItem;
    expect(mirrorOf(subscription({ current_period_end: 500 }, [legacyItem]), new Map())).toMatchObject({ ok: { currentPeriodEnd: new Date(500_000) } });
    expect(mirrorOf(subscription({}, [legacyItem]), new Map())).toEqual({ error: 'NO_PERIOD' });
  });

  it('keeps an organization id only when it is a UUID, and notes a firm subscription without one', () => {
    expect(mirrorOf(subscription({ metadata: { mutaba3a_organization_id: 'firm-42' } }), new Map())).toMatchObject({ ok: { organizationId: null }, notes: ['UNKNOWN_ORG'] });
    const firm = subscription({}, [item(product('prod_FIRM', 'firm'), 1)]);
    expect(mirrorOf(firm, new Map())).toMatchObject({ ok: { tier: 'FIRM', organizationId: null }, notes: ['FIRM_WITHOUT_ORG'] });
  });

  it('accepts ILS and USD only', () => {
    expect(mirrorOf(subscription({ currency: 'usd' }), new Map())).toMatchObject({ ok: { currency: 'USD' } });
    expect(mirrorOf(subscription({ currency: 'eur' }), new Map())).toEqual({ error: 'UNSUPPORTED_CURRENCY' });
  });

  it('cuts a lookup key to the column’s 100 characters', () => {
    const long = 'k'.repeat(150);
    expect(mirrorOf(subscription({}, [item(product('prod_A', 'freelancer'), 1, long)]), new Map())).toMatchObject({ ok: { priceLookupKey: 'k'.repeat(100) } });
  });

  it('keeps Stripe’s status and cancel-at-period-end as sent', () => {
    expect(mirrorOf(subscription({ status: 'past_due', cancel_at_period_end: true }), new Map())).toMatchObject({ ok: { status: 'past_due', cancelAtPeriodEnd: true } });
  });
});

describe('ids out of payloads', () => {
  it('finds an invoice’s subscription in either API-version shape, or none', () => {
    expect(subscriptionIdOfInvoice({ parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_new' } } } as unknown as Stripe.Invoice)).toBe('sub_new');
    expect(subscriptionIdOfInvoice({ parent: { subscription_details: { subscription: { id: 'sub_obj' } } } } as unknown as Stripe.Invoice)).toBe('sub_obj');
    expect(subscriptionIdOfInvoice({ subscription: 'sub_old' } as unknown as Stripe.Invoice)).toBe('sub_old');
    expect(subscriptionIdOfInvoice({ parent: null } as unknown as Stripe.Invoice)).toBeNull();
  });

  it('finds a customer id whether expanded or not', () => {
    expect(customerIdOf('cus_1')).toBe('cus_1');
    expect(customerIdOf({ id: 'cus_2' } as Stripe.Customer)).toBe('cus_2');
  });
});
