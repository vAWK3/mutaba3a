import { createHash } from 'node:crypto';
import Stripe from 'stripe';
import type { SubscriptionState } from '../checkout.js';
import { STRIPE_API_VERSION, StripeGatewayError, toGatewayError } from './gateway.js';
import { periodEndOf } from './mirror.js';

/**
 * MUT-362 (plan §2.2, eng review D1–D3, ADR-170): the server's write door to Stripe, apart from MUT-360's read-only
 * `StripeGateway` so that port's contract stays as reviewed. It finds or creates the person's customer, checks Stripe
 * itself before a Checkout (review: the mirror alone can be late), opens Checkout and Customer Portal sessions, reads
 * the GA prices by lookup key, and prints a Checkout tax number on the customer's invoices. Built from the same
 * restricted key, which gains Write on Customers, Checkout Sessions and Customer portal (D2).
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
  /** Sellable prices by lookup key, cached per instance for CATALOG_TTL_MS (a failure for CATALOG_FAILURE_TTL_MS). */
  pricesByLookupKey(keys: readonly string[]): Promise<Map<string, PriceFact>>;
  /** The customer whose metadata names this person (listed by exact email), else a new one (D3). */
  findOrCreateCustomer(person: CheckoutPerson): Promise<string>;
  /** Every subscription Stripe holds for the customer, ended ones included (review: no double charge). */
  subscriptionsOf(customer: string): Promise<SubscriptionState[]>;
  /** Expires the customer's open Checkout sessions, so only the newest can be paid; returns how many. */
  expireOpenCheckouts(customer: string): Promise<number>;
  createCheckoutSession(params: Stripe.Checkout.SessionCreateParams): Promise<{ url: string }>;
  createPortalSession(input: { customer: string; returnUrl: string }): Promise<{ url: string }>;
  /** Stripe tax IDs on the customer plus our invoice tax number, for the operator's country check (D9, review D3). */
  businessTaxIdCount(customer: string): Promise<number>;
  /** Review D3: prints the number a business typed on Checkout on every invoice the customer gets. */
  setInvoiceTaxNumber(customer: string, value: string): Promise<void>;
}

/** A person is waiting: one retry, which the SDK makes safe with the same idempotency key. */
export const CHECKOUT_BUDGET = { timeoutMs: 8_000, maxNetworkRetries: 1 } as const;
/** A price changed in the dashboard shows within ten minutes, or at once on a new revision. */
export const CATALOG_TTL_MS = 10 * 60 * 1000;
/** A failed lookup answers again for a minute: a person polling during a Stripe outage must not pile calls up. */
export const CATALOG_FAILURE_TTL_MS = 60 * 1000;
/** The invoice field a Checkout business tax number goes into (Stripe allows 40 characters for the name). */
export const INVOICE_TAX_NUMBER_FIELD = 'Business tax number';

export interface CheckoutGatewayOptions {
  secretKey: string;
  timeoutMs: number;
  maxNetworkRetries: number;
  now: () => Date;
  httpClient?: Stripe.HttpClient;
}

const LOOKUP_PAGE = 10;
const SUBSCRIPTIONS_PAGE = 20;
const OPEN_SESSIONS_PAGE = 10;
const SELLABLE_TIER = 'freelancer';

type CatalogEntry = { at: number; prices: Map<string, PriceFact> } | { at: number; failure: StripeGatewayError };

export function createCheckoutGateway(options: CheckoutGatewayOptions): CheckoutGateway {
  const stripe = new Stripe(options.secretKey, {
    apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion,
    timeout: options.timeoutMs,
    maxNetworkRetries: options.maxNetworkRetries,
    telemetry: false,
    ...(options.httpClient ? { httpClient: options.httpClient } : {}),
  });
  const cache = new Map<string, CatalogEntry>();
  const inFlight = new Map<string, Promise<Map<string, PriceFact>>>();

  async function lookUp(cacheKey: string, keys: readonly string[]): Promise<Map<string, PriceFact>> {
    try {
      const page = await wrapped(() => stripe.prices.list({ lookup_keys: [...keys], active: true, limit: LOOKUP_PAGE, expand: ['data.product'] }));
      const prices = new Map<string, PriceFact>();
      for (const price of page.data) {
        const fact = sellableFactOf(price);
        if (fact && price.lookup_key) prices.set(price.lookup_key, fact);
      }
      cache.set(cacheKey, { at: options.now().getTime(), prices });
      return prices;
    } catch (err) {
      const failure = err instanceof StripeGatewayError ? err : toGatewayError(err);
      cache.set(cacheKey, { at: options.now().getTime(), failure });
      throw failure;
    }
  }

  return {
    async pricesByLookupKey(keys) {
      const cacheKey = [...keys].sort().join(',');
      const hit = cache.get(cacheKey);
      const age = hit ? options.now().getTime() - hit.at : Number.POSITIVE_INFINITY;
      if (hit && 'prices' in hit && age < CATALOG_TTL_MS) return hit.prices;
      if (hit && 'failure' in hit && age < CATALOG_FAILURE_TTL_MS) throw hit.failure;
      const pending = inFlight.get(cacheKey) ?? lookUp(cacheKey, keys).finally(() => inFlight.delete(cacheKey));
      inFlight.set(cacheKey, pending);
      return pending;
    },
    async findOrCreateCustomer(person) {
      // List, not Search: Search is eventually consistent, so a customer made seconds ago could be missed.
      const listed = await wrapped(() => stripe.customers.list({ email: person.email, limit: 100 }));
      const mine = listed.data.find((c) => c.metadata?.['mutaba3a_user_id'] === person.userId);
      if (mine) return mine.id;
      const created = await wrapped(() =>
        stripe.customers.create(
          { email: person.email, name: person.name, metadata: { mutaba3a_user_id: person.userId } },
          // Two tabs (or a double press) within Stripe's 24 h key window get the same customer back. The key carries the
          // parameters' hash: Stripe refuses a reused key with new ones, which a changed email or name would be.
          { idempotencyKey: `mut362-customer-${person.userId}-${digestOf(person.email, person.name)}` },
        ),
      );
      return created.id;
    },
    async subscriptionsOf(customer) {
      const page = await wrapped(() => stripe.subscriptions.list({ customer, status: 'all', limit: SUBSCRIPTIONS_PAGE }));
      return page.data.flatMap((sub) => {
        const currentPeriodEnd = periodEndOf(sub);
        return currentPeriodEnd ? [{ status: sub.status, currentPeriodEnd }] : [];
      });
    },
    async expireOpenCheckouts(customer) {
      const page = await wrapped(() => stripe.checkout.sessions.list({ customer, status: 'open', limit: OPEN_SESSIONS_PAGE }));
      for (const session of page.data) await wrapped(() => stripe.checkout.sessions.expire(session.id));
      return page.data.length;
    },
    async createCheckoutSession(params) {
      const session = await wrapped(() => stripe.checkout.sessions.create(params));
      return { url: urlOf(session.url) };
    },
    async createPortalSession({ customer, returnUrl }) {
      const session = await wrapped(() => stripe.billingPortal.sessions.create({ customer, return_url: returnUrl, locale: 'auto' }));
      return { url: urlOf(session.url) };
    },
    async businessTaxIdCount(customer) {
      const [taxIds, found] = await Promise.all([wrapped(() => stripe.customers.listTaxIds(customer, { limit: 10 })), wrapped(() => stripe.customers.retrieve(customer))]);
      const fields = 'deleted' in found ? [] : (found.invoice_settings?.custom_fields ?? []);
      return taxIds.data.length + (fields.some((f) => f.name === INVOICE_TAX_NUMBER_FIELD && f.value.trim() !== '') ? 1 : 0);
    },
    async setInvoiceTaxNumber(customer, value) {
      await wrapped(() => stripe.customers.update(customer, { invoice_settings: { custom_fields: [{ name: INVOICE_TAX_NUMBER_FIELD, value }] } }));
    },
  };
}

/**
 * Only a price the mirror and our copy can stand behind (review): a monthly or yearly one (Stripe's interval type is
 * open-ended), on a product tagged `tier: freelancer` (else mirrorOf refuses the paid subscription as UNKNOWN_TIER),
 * VAT-exclusive (we promise "Prices exclude VAT"), with an amount.
 */
function sellableFactOf(price: Stripe.Price): PriceFact | null {
  const interval = price.recurring?.interval === 'month' ? 'month' : price.recurring?.interval === 'year' ? 'year' : null;
  if (!interval || price.recurring?.interval_count !== 1) return null;
  if (typeof price.unit_amount !== 'number' || price.unit_amount <= 0) return null;
  if (price.tax_behavior !== 'exclusive') return null;
  const product = typeof price.product === 'object' && !('deleted' in price.product && price.product.deleted) ? (price.product as Stripe.Product) : null;
  if ((product?.metadata?.['tier'] ?? '').trim().toLowerCase() !== SELLABLE_TIER) return null;
  return { id: price.id, currency: price.currency.toUpperCase(), unitAmount: price.unit_amount, interval };
}

function digestOf(...parts: string[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 12);
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
