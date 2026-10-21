import Stripe from 'stripe';
import { InvalidStripeSignature, StripeGatewayError, type Fetched, type StripeGateway } from '../gateway.js';

/**
 * MUT-360: Stripe in memory for sync and route tests. Holds the current state of customers, subscriptions and
 * products (what a re-fetch returns), signs payloads with the real SDK so routes verify real signatures, and can be
 * told to fail the next calls.
 */
export const FAKE_WEBHOOK_SECRET = 'whsec_mut360_fake_endpoint';
const signer = new Stripe('sk_test_mut360_fake', { telemetry: false });

export class FakeStripeGateway implements StripeGateway {
  readonly livemode = false;
  readonly customers = new Map<string, Stripe.Customer | Stripe.DeletedCustomer>();
  readonly subscriptions = new Map<string, Stripe.Subscription>();
  readonly products = new Map<string, Stripe.Product>();
  /** Calls made, e.g. `subscription:sub_1`, for asserting what was re-fetched. */
  readonly calls: string[] = [];
  private failures: StripeGatewayError[] = [];

  constructor(private readonly now: () => Date) {}

  /** The next `count` calls throw (a transient Stripe failure unless told otherwise). */
  failNext(count = 1, transient = true): void {
    for (let i = 0; i < count; i++) this.failures.push(new StripeGatewayError({ code: null, type: transient ? 'StripeAPIError' : 'StripeInvalidRequestError', requestId: 'req_fake', transient }));
  }

  /** A raw body and a Stripe-Signature header for it, signed with the fake endpoint's secret (or another). */
  sign(event: Record<string, unknown>, secret = FAKE_WEBHOOK_SECRET): { raw: string; signature: string } {
    const raw = JSON.stringify({ object: 'event', livemode: false, created: Math.floor(Date.now() / 1000), ...event });
    return { raw, signature: signer.webhooks.generateTestHeaderString({ payload: raw, secret }) };
  }

  verifyEvent(raw: string, signature: string): Stripe.Event {
    try {
      return signer.webhooks.constructEvent(raw, signature, FAKE_WEBHOOK_SECRET);
    } catch {
      throw new InvalidStripeSignature();
    }
  }

  async subscription(id: string): Promise<Fetched<Stripe.Subscription>> {
    const fetchedAt = this.call(`subscription:${id}`);
    const sub = this.subscriptions.get(id);
    if (!sub) throw new StripeGatewayError({ code: 'resource_missing', type: 'StripeInvalidRequestError', requestId: 'req_fake', transient: false });
    return { value: this.expand(sub, true), fetchedAt };
  }

  async customer(id: string): Promise<Fetched<Stripe.Customer | Stripe.DeletedCustomer>> {
    const fetchedAt = this.call(`customer:${id}`);
    const customer = this.customers.get(id);
    if (!customer) throw new StripeGatewayError({ code: 'resource_missing', type: 'StripeInvalidRequestError', requestId: 'req_fake', transient: false });
    return { value: structuredClone(customer), fetchedAt };
  }

  async *listSubscriptions(): AsyncIterable<Fetched<Stripe.Subscription>> {
    const fetchedAt = this.call('listSubscriptions');
    for (const sub of this.subscriptions.values()) yield { value: this.expand(sub, false), fetchedAt };
  }

  async listProducts(): Promise<Map<string, Stripe.Product>> {
    this.call('listProducts');
    return new Map([...this.products].map(([id, p]) => [id, structuredClone(p)]));
  }

  private call(name: string): Date {
    this.calls.push(name);
    const failure = this.failures.shift();
    if (failure) throw failure;
    return this.now();
  }

  /** As Stripe returns it: the customer expanded; products expanded on a retrieve, ids on a list. */
  private expand(sub: Stripe.Subscription, products: boolean): Stripe.Subscription {
    const copy = structuredClone(sub);
    const customerId = typeof copy.customer === 'string' ? copy.customer : copy.customer.id;
    const customer = this.customers.get(customerId);
    if (customer) copy.customer = structuredClone(customer);
    for (const item of copy.items.data) {
      const id = typeof item.price.product === 'string' ? item.price.product : item.price.product.id;
      const product = this.products.get(id);
      item.price.product = products && product ? structuredClone(product) : id;
    }
    return copy;
  }
}

/** Builders for the objects tests put in the fake. */
export const stripeObjects = {
  product(id: string, tier: string | null): Stripe.Product {
    return { id, object: 'product', active: true, name: id, metadata: tier ? { tier } : {} } as unknown as Stripe.Product;
  },
  customer(id: string, metadata: Record<string, string> = {}, country: string | null = 'IL'): Stripe.Customer {
    return { id, object: 'customer', address: country ? { country } : null, metadata, livemode: false } as unknown as Stripe.Customer;
  },
  subscription(fields: { id: string; customer: string; product: string; status?: string; currency?: string; periodEnd?: Date; lookupKey?: string; metadata?: Record<string, string>; cancelAtPeriodEnd?: boolean }): Stripe.Subscription {
    const end = Math.floor((fields.periodEnd ?? new Date('2026-12-01T00:00:00Z')).getTime() / 1000);
    return {
      id: fields.id,
      object: 'subscription',
      status: fields.status ?? 'active',
      cancel_at_period_end: fields.cancelAtPeriodEnd ?? false,
      currency: fields.currency ?? 'ils',
      customer: fields.customer,
      livemode: false,
      metadata: fields.metadata ?? {},
      items: {
        object: 'list',
        has_more: false,
        data: [{ id: `si_${fields.id}`, object: 'subscription_item', current_period_end: end, price: { id: `price_${fields.id}`, lookup_key: fields.lookupKey ?? 'freelancer_founder_monthly_ils', product: fields.product } }],
      },
    } as unknown as Stripe.Subscription;
  },
};
