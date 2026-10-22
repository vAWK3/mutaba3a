import Stripe from 'stripe';
import { STRIPE_API_VERSION, StripeGatewayError, toGatewayError } from './gateway.js';

/**
 * MUT-362 (plan §2.2, eng review D1–D3, ADR-169): the server's write door to Stripe, apart from MUT-360's read-only
 * `StripeGateway` so that port's contract stays as reviewed. It finds or creates the person's customer, opens Checkout
 * and Customer Portal sessions, and reads the GA prices by lookup key. Built from the same restricted key, which gains
 * Write on Customers, Checkout Sessions and Customer portal (D2).
 */

export interface PriceFact {
  id: string;
  /** ISO 4217 in upper case, as the rest of the server spells currencies. */
  currency: string;
  unitAmount: number;
  interval: 'month' | 'year';
}

export interface CheckoutPerson {
  userId: string;
  email: string;
  name: string;
}

export interface CheckoutGateway {
  /** Active recurring prices by lookup key, cached per instance for CATALOG_TTL_MS. Missing keys are simply absent. */
  pricesByLookupKey(keys: readonly string[]): Promise<Map<string, PriceFact>>;
  /** The customer whose metadata names this person (listed by exact email), else a new one (D3). */
  findOrCreateCustomer(person: CheckoutPerson): Promise<string>;
  createCheckoutSession(params: Stripe.Checkout.SessionCreateParams): Promise<{ url: string }>;
  createPortalSession(input: { customer: string; returnUrl: string }): Promise<{ url: string }>;
}

/** A person is waiting: one retry, which the SDK makes safe with the same idempotency key. */
export const CHECKOUT_BUDGET = { timeoutMs: 8_000, maxNetworkRetries: 1 } as const;
/** A price changed in the dashboard shows within ten minutes, or at once on a new revision. */
export const CATALOG_TTL_MS = 10 * 60 * 1000;

export interface CheckoutGatewayOptions {
  secretKey: string;
  timeoutMs: number;
  maxNetworkRetries: number;
  now: () => Date;
  httpClient?: Stripe.HttpClient;
}

const LOOKUP_PAGE = 10;

export function createCheckoutGateway(options: CheckoutGatewayOptions): CheckoutGateway {
  const stripe = new Stripe(options.secretKey, {
    apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion,
    timeout: options.timeoutMs,
    maxNetworkRetries: options.maxNetworkRetries,
    telemetry: false,
    ...(options.httpClient ? { httpClient: options.httpClient } : {}),
  });
  const cache = new Map<string, { at: number; prices: Map<string, PriceFact> }>();

  return {
    async pricesByLookupKey(keys) {
      const cacheKey = [...keys].sort().join(',');
      const now = options.now().getTime();
      const hit = cache.get(cacheKey);
      if (hit && now - hit.at < CATALOG_TTL_MS) return hit.prices;
      const page = await wrapped(() => stripe.prices.list({ lookup_keys: [...keys], active: true, limit: LOOKUP_PAGE }));
      const prices = new Map<string, PriceFact>();
      for (const price of page.data) {
        const fact = priceFactOf(price);
        if (fact && price.lookup_key) prices.set(price.lookup_key, fact);
      }
      cache.set(cacheKey, { at: now, prices });
      return prices;
    },
    async findOrCreateCustomer(person) {
      // List, not Search: Search is eventually consistent, so a customer made seconds ago could be missed.
      const listed = await wrapped(() => stripe.customers.list({ email: person.email, limit: 100 }));
      const mine = listed.data.find((c) => c.metadata?.['mutaba3a_user_id'] === person.userId);
      if (mine) return mine.id;
      const created = await wrapped(() =>
        stripe.customers.create(
          { email: person.email, name: person.name, metadata: { mutaba3a_user_id: person.userId } },
          // Two tabs (or a double press) within Stripe's 24 h key window get the same customer back.
          { idempotencyKey: `mut362-customer-${person.userId}` },
        ),
      );
      return created.id;
    },
    async createCheckoutSession(params) {
      const session = await wrapped(() => stripe.checkout.sessions.create(params));
      return { url: urlOf(session.url) };
    },
    async createPortalSession({ customer, returnUrl }) {
      const session = await wrapped(() => stripe.billingPortal.sessions.create({ customer, return_url: returnUrl, locale: 'auto' }));
      return { url: urlOf(session.url) };
    },
  };
}

function priceFactOf(price: Stripe.Price): PriceFact | null {
  // Stripe's interval type is open-ended (`OtherString`); only a monthly or yearly price is one we sell.
  const interval = price.recurring?.interval === 'month' ? 'month' : price.recurring?.interval === 'year' ? 'year' : null;
  if (!interval || typeof price.unit_amount !== 'number' || price.unit_amount <= 0) return null;
  return { id: price.id, currency: price.currency.toUpperCase(), unitAmount: price.unit_amount, interval };
}

/** A session Stripe made without a URL can't be redirected to; treat it as Stripe failing, never as an empty redirect. */
function urlOf(url: string | null): string {
  if (!url) throw new StripeGatewayError({ code: 'missing_url', type: 'UnexpectedResponse', requestId: null, transient: true });
  return url;
}

async function wrapped<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    throw toGatewayError(err);
  }
}
