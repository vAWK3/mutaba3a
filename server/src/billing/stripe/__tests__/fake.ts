import Stripe from 'stripe';
import type { LiveSubscription } from '../../../accounts/closure.js';
import type { AccountStripeGateway } from '../account-gateway.js';
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

  /** A transient API error by default; with a code, Stripe's invalid-request error (with `param` when it names one). */
  failNext(code: string | null = null, param: string | null = code === 'resource_missing' ? 'customer' : null): void {
    this.failures.push(new StripeGatewayError({ code, type: code === null ? 'StripeAPIError' : 'StripeInvalidRequestError', requestId: 'req_fake', transient: code === null, param }));
  }

  /** The next call fails as a key without the right permission would (a deploy that skipped D2). */
  failPermissionNext(): void {
    this.failures.push(new StripeGatewayError({ code: null, type: 'StripePermissionError', requestId: 'req_fake', transient: true }));
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
    this.openCheckouts.set(String(params.customer), (this.openCheckouts.get(String(params.customer)) ?? 0) + 1);
    return { url: `https://checkout.stripe.com/c/pay/cs_test_${this.checkoutSessions.length}` };
  }

  async createPortalSession(input: { customer: string; returnUrl: string }): Promise<{ url: string }> {
    this.take(`portal:${input.customer}`);
    this.portalSessions.push(input);
    return { url: `https://billing.stripe.com/p/session/test_${this.portalSessions.length}` };
  }

  /** Stripe's own subscriptions per customer (review: Checkout asks Stripe, not only the mirror). */
  readonly stripeSubscriptions = new Map<string, { status: string; currentPeriodEnd: Date }[]>();
  /** Open Checkout sessions per customer, and the ones expired. */
  readonly openCheckouts = new Map<string, number>();
  expiredCheckouts = 0;

  async subscriptionsOf(customer: string): Promise<{ status: string; currentPeriodEnd: Date }[]> {
    this.take(`subscriptions:${customer}`);
    return this.stripeSubscriptions.get(customer) ?? [];
  }

  async expireOpenCheckouts(customer: string): Promise<number> {
    this.take(`expire:${customer}`);
    const open = this.openCheckouts.get(customer) ?? 0;
    this.openCheckouts.set(customer, 0);
    this.expiredCheckouts += open;
    return open;
  }

  /** Tax IDs per customer (MUT-362 D9); unknown customers have none. */
  readonly taxIds = new Map<string, number>();
  /** Invoice tax numbers per customer (review D3). */
  readonly taxNumbers = new Map<string, string>();

  async businessTaxIdCount(customer: string): Promise<number> {
    this.take(`taxIds:${customer}`);
    return (this.taxIds.get(customer) ?? 0) + (this.taxNumbers.has(customer) ? 1 : 0);
  }

  async setInvoiceTaxNumber(customer: string, value: string): Promise<void> {
    this.take(`taxNumber:${customer}`);
    this.taxNumbers.set(customer, value);
  }

  private take(call: string): void {
    this.calls.push(call);
    const failure = this.failures.shift();
    if (failure) throw failure;
  }
}

/**
 * MUT-333: Stripe as closing an account sees it, in memory. Customers name their person; subscriptions carry their
 * own ending state, so a test can check what close, keep and purge did to them. `failOn` fails a named operation.
 */
export class FakeAccountStripeGateway implements AccountStripeGateway {
  readonly customers = new Map<string, { email: string; userId: string; deleted: boolean; openCheckouts: number }>();
  readonly subscriptions = new Map<string, LiveSubscription & { customer: string }>();
  readonly calls: string[] = [];
  private readonly failing = new Map<string, number>();

  customer(id: string, person: { email: string; userId: string }, openCheckouts = 0): this {
    this.customers.set(id, { ...person, deleted: false, openCheckouts });
    return this;
  }

  subscription(id: string, customer: string, status: string, ending: { cancelAtPeriodEnd?: boolean; cancelAt?: Date | null } = {}): this {
    this.subscriptions.set(id, { id, customer, status, cancelAtPeriodEnd: ending.cancelAtPeriodEnd ?? false, cancelAt: ending.cancelAt ?? null });
    return this;
  }

  /** The next `times` calls of `operation` (e.g. `setCancelAtPeriodEnd:sub_2`, or just `deleteCustomer`) fail transiently. */
  failOn(operation: string, times = 1): void {
    this.failing.set(operation, times);
  }

  private call(operation: string, target: string): void {
    this.calls.push(`${operation}:${target}`);
    for (const key of [`${operation}:${target}`, operation]) {
      const left = this.failing.get(key) ?? 0;
      if (left > 0) {
        this.failing.set(key, left - 1);
        throw new StripeGatewayError({ code: null, type: 'StripeAPIError', requestId: 'req_fake', transient: true });
      }
    }
  }

  async customersOf(person: { userId: string; email: string }): Promise<string[]> {
    this.call('customersOf', person.email);
    return [...this.customers].filter(([, c]) => !c.deleted && c.email === person.email && c.userId === person.userId).map(([id]) => id);
  }

  async liveSubscriptionsOf(customer: string): Promise<LiveSubscription[]> {
    this.call('liveSubscriptionsOf', customer);
    return [...this.subscriptions.values()].filter((s) => s.customer === customer).map(({ id, status, cancelAtPeriodEnd, cancelAt }) => ({ id, status, cancelAtPeriodEnd, cancelAt }));
  }

  async setCancelAtPeriodEnd(subscriptionId: string, value: boolean): Promise<void> {
    this.call('setCancelAtPeriodEnd', subscriptionId);
    const sub = this.subscriptions.get(subscriptionId);
    if (sub) sub.cancelAtPeriodEnd = value;
  }

  async cancelNow(subscriptionId: string): Promise<void> {
    this.call('cancelNow', subscriptionId);
    const sub = this.subscriptions.get(subscriptionId);
    if (sub) sub.status = 'canceled';
  }

  async expireOpenCheckouts(customer: string): Promise<number> {
    this.call('expireOpenCheckouts', customer);
    const c = this.customers.get(customer);
    const count = c?.openCheckouts ?? 0;
    if (c) c.openCheckouts = 0;
    return count;
  }

  async deleteCustomer(customer: string): Promise<void> {
    this.call('deleteCustomer', customer);
    const c = this.customers.get(customer);
    if (c) c.deleted = true;
    for (const sub of this.subscriptions.values()) if (sub.customer === customer) sub.status = 'canceled';
  }
}
