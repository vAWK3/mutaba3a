import { createHash } from 'node:crypto';
import Stripe from 'stripe';
import { OFFER_METADATA_KEY, type SubscriptionState } from '../checkout.js';
import type { CouponFact } from '../offer.js';
import type { RenewalFacts } from '../renewal-mail.js';
import { STRIPE_API_VERSION, StripeGatewayError, toGatewayError } from './gateway.js';
import { periodEndOf, stateOf } from './mirror.js';

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
  /** MUT-525 (OV-4): the price's product, so the launch coupon can be checked to be restricted to it. */
  productId: string;
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
  /** MUT-533 (D5): `flow: 'card'` opens straight on the card form and redirects to `returnUrl` once the card is saved. */
  createPortalSession(input: { customer: string; returnUrl: string; flow?: 'card' }): Promise<{ url: string }>;
  /** Stripe tax IDs on the customer plus our invoice tax number, for the operator's country check (D9, review D3). */
  businessTaxIdCount(customer: string): Promise<number>;
  /** Review D3: prints the number a business typed on Checkout on every invoice the customer gets. */
  setInvoiceTaxNumber(customer: string, value: string): Promise<void>;
  /**
   * MUT-525 (D6): the coupon behind an offer, null when Stripe has none by that id or it is no longer valid. Cached
   * for `couponTtlMs` (a failure for CATALOG_FAILURE_TTL_MS); `fresh` skips the cache (Checkout) and refreshes it.
   */
  couponById(id: string, options?: { fresh?: boolean }): Promise<CouponFact | null>;
  /** MUT-525 (DD8): what the renewal notice needs of a subscription; null when Stripe no longer has it. */
  renewalOf(subscriptionId: string): Promise<RenewalFacts | null>;
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
  /** MUT-525 (R6): how long a coupon read is reused. CATALOG_TTL_MS by default; the QA harness's API uses 0. */
  couponTtlMs?: number;
}

const LOOKUP_PAGE = 10;
const SUBSCRIPTIONS_PAGE = 20;
const OPEN_SESSIONS_PAGE = 10;
const SELLABLE_TIER = 'freelancer';

type CatalogEntry = { at: number; prices: Map<string, PriceFact> } | { at: number; failure: StripeGatewayError };
type CouponEntry = { at: number; coupon: CouponFact | null } | { at: number; failure: StripeGatewayError };

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
  const coupons = new Map<string, CouponEntry>();
  const couponTtl = options.couponTtlMs ?? CATALOG_TTL_MS;

  async function readCoupon(id: string): Promise<CouponFact | null> {
    const at = options.now().getTime();
    try {
      const found = await wrapped(() => stripe.coupons.retrieve(id, { expand: ['applies_to', 'currency_options'] }));
      const coupon = found.valid ? couponFactOf(found) : null;
      coupons.set(id, { at, coupon });
      return coupon;
    } catch (err) {
      const failure = err instanceof StripeGatewayError ? err : toGatewayError(err);
      if (failure.code === 'resource_missing') {
        coupons.set(id, { at, coupon: null });
        return null;
      }
      coupons.set(id, { at, failure });
      throw failure;
    }
  }

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
        return currentPeriodEnd ? [{ status: sub.status, currentPeriodEnd, offerId: sub.metadata?.[OFFER_METADATA_KEY] ?? null }] : [];
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
    async createPortalSession({ customer, returnUrl, flow }) {
      const flowData = flow === 'card' ? { flow_data: { type: 'payment_method_update' as const, after_completion: { type: 'redirect' as const, redirect: { return_url: returnUrl } } } } : {};
      const session = await wrapped(() => stripe.billingPortal.sessions.create({ customer, return_url: returnUrl, locale: 'auto', ...flowData }));
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
    async renewalOf(subscriptionId) {
      try {
        const sub = await wrapped(() => stripe.subscriptions.retrieve(subscriptionId));
        return renewalFactsOf(sub);
      } catch (err) {
        if (err instanceof StripeGatewayError && err.code === 'resource_missing') return null;
        throw err;
      }
    },
    async couponById(id, { fresh = false } = {}) {
      const hit = fresh ? undefined : coupons.get(id);
      const age = hit ? options.now().getTime() - hit.at : Number.POSITIVE_INFINITY;
      if (hit && 'coupon' in hit && age < couponTtl) return hit.coupon;
      if (hit && 'failure' in hit && age < Math.min(couponTtl, CATALOG_FAILURE_TTL_MS)) throw hit.failure;
      return readCoupon(id);
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
  return { id: price.id, currency: price.currency.toUpperCase(), unitAmount: price.unit_amount, interval, productId: product!.id };
}

/**
 * The first paid period starts at the trial's end, or at the subscription's start with no trial; the current period
 * is that one exactly when its start is that moment. The price is the subscription's own (what the renewal charges).
 */
function renewalFactsOf(sub: Stripe.Subscription): RenewalFacts | null {
  const item = sub.items.data[0];
  const state = stateOf(sub);
  if (!item || !state.currentPeriodEnd || typeof item.price.unit_amount !== 'number') return null;
  const periodStart = Math.max(...sub.items.data.map((i) => i.current_period_start));
  return {
    status: state.status,
    cancelAtPeriodEnd: state.cancelAtPeriodEnd,
    currentPeriodEnd: state.currentPeriodEnd,
    firstPaidPeriod: periodStart === (sub.trial_end ?? sub.start_date),
    unitAmount: item.price.unit_amount,
    currency: item.price.currency.toUpperCase(),
    lookupKey: item.price.lookup_key ?? null,
  };
}

function couponFactOf(coupon: Stripe.Coupon): CouponFact {
  return {
    id: coupon.id,
    valid: coupon.valid,
    percentOff: coupon.percent_off ?? null,
    amountOff: coupon.amount_off ?? null,
    amountOffIn: { ILS: amountOffIn(coupon, 'ils'), USD: amountOffIn(coupon, 'usd') },
    duration: coupon.duration,
    durationInMonths: coupon.duration_in_months ?? null,
    redeemBy: typeof coupon.redeem_by === 'number' ? new Date(coupon.redeem_by * 1000) : null,
    appliesToProducts: coupon.applies_to?.products ? [...coupon.applies_to.products] : null,
  };
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

/** MUT-534 (D8): an amount-off coupon's amount in one currency: its own, else its currency option; null for none. */
function amountOffIn(coupon: Stripe.Coupon, currency: 'ils' | 'usd'): number | null {
  if (coupon.amount_off == null) return null;
  if (coupon.currency === currency) return coupon.amount_off;
  return coupon.currency_options?.[currency]?.amount_off ?? null;
}
