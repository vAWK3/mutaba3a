import Stripe from 'stripe';
import type { CheckoutGateway, CheckoutPerson, PriceFact } from '../checkout-gateway.js';
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

/**
 * MUT-362: the write door in memory for route tests. Records each call, answers with deterministic URLs, and can be
 * told to fail the next call (transient by default, or with a Stripe code such as `resource_missing`).
 */
export class FakeCheckoutGateway implements CheckoutGateway {
  readonly prices = new Map<string, PriceFact>();
  /** Customers by id, with the person their metadata names. */
  readonly customers = new Map<string, { email: string; userId: string }>();
  readonly checkoutSessions: Stripe.Checkout.SessionCreateParams[] = [];
  readonly portalSessions: { customer: string; returnUrl: string }[] = [];
  readonly calls: string[] = [];
  private failures: StripeGatewayError[] = [];
  private pricesFail = false;

  /** All four GA prices, in their currencies (the founder ratio: a year is 10× a month). */
  withGaPrices(): this {
    const add = (key: string, currency: string, unitAmount: number, interval: 'month' | 'year') => this.prices.set(key, { id: `price_${key}`, currency, unitAmount, interval });
    add('freelancer_list_monthly_ils', 'ILS', 3900, 'month');
    add('freelancer_list_yearly_ils', 'ILS', 39000, 'year');
    add('freelancer_list_monthly_usd', 'USD', 1000, 'month');
    add('freelancer_list_yearly_usd', 'USD', 10000, 'year');
    return this;
  }

  failNext(code: string | null = null): void {
    this.failures.push(new StripeGatewayError({ code, type: code === null ? 'StripeAPIError' : 'StripeInvalidRequestError', requestId: 'req_fake', transient: code === null }));
  }

  /** The next price lookup fails (transiently); `failNext` leaves lookups alone, as the real gateway's cache would. */
  failPricesNext(): void {
    this.pricesFail = true;
  }

  async pricesByLookupKey(keys: readonly string[]): Promise<Map<string, PriceFact>> {
    this.calls.push('prices');
    if (this.pricesFail) {
      this.pricesFail = false;
      throw new StripeGatewayError({ code: null, type: 'StripeAPIError', requestId: 'req_fake', transient: true });
    }
    return new Map(keys.flatMap((k) => (this.prices.has(k) ? [[k, this.prices.get(k)!] as const] : [])));
  }

  async findOrCreateCustomer(person: CheckoutPerson): Promise<string> {
    this.take(`customer:${person.userId}`);
    const existing = [...this.customers.entries()].find(([, c]) => c.userId === person.userId);
    if (existing) return existing[0];
    const id = `cus_new_${this.customers.size + 1}`;
    this.customers.set(id, { email: person.email, userId: person.userId });
    return id;
  }

  async createCheckoutSession(params: Stripe.Checkout.SessionCreateParams): Promise<{ url: string }> {
    this.take(`checkout:${String(params.customer)}`);
    this.checkoutSessions.push(params);
    return { url: `https://checkout.stripe.com/c/pay/cs_test_${this.checkoutSessions.length}` };
  }

  async createPortalSession(input: { customer: string; returnUrl: string }): Promise<{ url: string }> {
    this.take(`portal:${input.customer}`);
    this.portalSessions.push(input);
    return { url: `https://billing.stripe.com/p/session/test_${this.portalSessions.length}` };
  }

  /** Tax IDs per customer (MUT-362 D9); unknown customers have none. */
  readonly taxIds = new Map<string, number>();

  async taxIdCount(customer: string): Promise<number> {
    this.take(`taxIds:${customer}`);
    return this.taxIds.get(customer) ?? 0;
  }

  private take(call: string): void {
    this.calls.push(call);
    const failure = this.failures.shift();
    if (failure) throw failure;
  }
}
