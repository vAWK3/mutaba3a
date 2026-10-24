import type Stripe from 'stripe';
import countriesFile from './billing-countries.json' with { type: 'json' };
import { periodOver, type Entitlement } from './entitlement.js';

/**
 * MUT-362 (plan §2.3, eng review D5/D6): who may start a Stripe Checkout, and with exactly which parameters. Pure: the
 * route gathers the person's subscriptions, their owned profiles' entitlements, the country rules and the price
 * catalog; this decides. The customer is added by the route (CheckoutGateway.findOrCreateCustomer, eng review D3).
 */

export type BillingCurrency = 'ILS' | 'USD';
export type BillingInterval = 'month' | 'year';
export type Buyer = 'person' | 'business';

/** The GA list prices by Stripe lookup key (billing-spike.md §5.1). The amounts live in Stripe, never here. */
export const GA_PRICE_LOOKUP_KEYS: Readonly<Record<BillingCurrency, Readonly<Record<BillingInterval, string>>>> = {
  ILS: { month: 'freelancer_list_monthly_ils', year: 'freelancer_list_yearly_ils' },
  USD: { month: 'freelancer_list_monthly_usd', year: 'freelancer_list_yearly_usd' },
};

export interface CatalogPrice {
  id: string;
  /** Minor units, as Stripe stores them. */
  unitAmount: number;
}

/** A currency is sellable only with both its prices; otherwise null (PRICES_NOT_SET). */
export type Catalog = Record<BillingCurrency, { month: CatalogPrice; year: CatalogPrice } | null>;

/** Every country (MUT-418 D9): `"consumerCountries": "*"`. */
export const EVERY_COUNTRY = '*';

/** `server/src/billing/billing-countries.json` (spike §8 D2; MUT-418: consumers everywhere, Basel 2026-10-23). */
export interface BillingCountries {
  /** Where a person may check out without a tax ID: `"*"` for every country. Empty: every buyer needs one. */
  consumer: typeof EVERY_COUNTRY | readonly string[];
  /** Where Stripe has no tax-ID type, so a business types its number into a Checkout custom field. */
  customTaxId: readonly string[];
}

/** Stripe's minimum is 30 minutes; a forgotten tab can't be paid days later (plan §2.3). */
export const CHECKOUT_SESSION_TTL_SECONDS = 60 * 60;

/** Shown above Stripe's Pay button. Arabic first: Stripe's page has no Arabic (spike §2.4). At most 1200 characters. */
export const CHECKOUT_SUBMIT_MESSAGE = [
  'الأسعار لا تشمل ضريبة القيمة المضافة، وتُضاف حيث يفرضها القانون. يتجدد الاشتراك تلقائيًا، ويمكنك إلغاؤه متى شئت من «إدارة الدفع» في متابعة. إن توقف الدفع تبقى سجلاتك متاحة للقراءة والتنزيل.',
  'Prices exclude VAT; VAT is added where the law requires it. Your plan renews automatically; cancel any time from Manage billing in MTB3A. If payment stops, your records stay readable and downloadable.',
].join('\n\n');

const TAX_NUMBER_FIELD_LABEL = 'Business tax number · الرقم الضريبي';
/** The Checkout custom field a business types its number into; the webhook copies it to the customer's invoices. */
export const BUSINESS_TAX_NUMBER_KEY = 'business_tax_number';
const COUNTRY = /^[A-Z]{2}$/;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** A portal path: `/` or a profile's page. Never an origin, a query or `..`, so the return URL can't leave the portal. */
const RETURN_PATH = new RegExp(`^/(p/${UUID}(/[a-z0-9-]+)*)?$`);

/** Statuses that already bill the person (or are about to): a second Checkout would charge twice. */
const LIVE_STATUSES: ReadonlySet<string> = new Set(['active', 'trialing', 'past_due', 'incomplete']);
/** Everything Stripe still holds open, most current first; `canceled` and `incomplete_expired` are over. */
const OPEN_RANK: ReadonlyMap<string, number> = new Map([
  ['active', 6],
  ['trialing', 5],
  ['past_due', 4],
  ['incomplete', 3],
  ['unpaid', 2],
  ['paused', 1],
]);
/** Stripe's minimum for a subscription's `trial_end` at Checkout. A trial ending sooner is charged at once. */
export const TRIAL_CARRY_MIN_MS = 48 * 60 * 60 * 1000;

export interface SubscriptionState {
  status: string;
  currentPeriodEnd: Date;
}

export type CheckoutRefusal =
  | 'ALREADY_SUBSCRIBED'
  | 'RESUME_IN_PORTAL'
  | 'CONTACT_US'
  | 'NOTHING_TO_COVER'
  | 'COVERED_BY_MALAFAT'
  | 'COVERED_BY_GRANT'
  | 'COUNTRY_NEEDS_BUSINESS'
  | 'PRICES_NOT_SET'
  | 'VALIDATION_FAILED';

export interface CheckoutInput {
  userId: string;
  interval: BillingInterval;
  country: string;
  buyer: Buyer;
  /** The portal origin plus a path that passed `isReturnPath`. */
  returnUrl: string;
  now: Date;
  /** The person's free trial end (review D2): a later one carries into the subscription. Null: no trial. */
  trialEndsAt: Date | null;
}

export interface PersonBilling {
  /** The person's own subscriptions: the mirror's (billing.summaryOf), plus Stripe's own once the customer is known. */
  subscriptions: readonly SubscriptionState[];
  /** The entitlement of each profile the person owns (entitlementsFor over ownedProfilesOf). */
  owned: readonly Entitlement[];
}

export type CheckoutParams = Omit<Stripe.Checkout.SessionCreateParams, 'customer'> &
  Required<Pick<Stripe.Checkout.SessionCreateParams, 'line_items' | 'tax_id_collection' | 'custom_fields' | 'success_url' | 'cancel_url'>>;

export type CheckoutPlan = { ok: false; code: CheckoutRefusal } | { ok: true; currency: BillingCurrency; params: CheckoutParams };

/** Every lookup key the catalog needs, for one `prices.list` call. */
export const ALL_GA_LOOKUP_KEYS: readonly string[] = Object.values(GA_PRICE_LOOKUP_KEYS).flatMap((pair) => [pair.month, pair.year]);

/**
 * The sellable catalog from the prices Stripe returned: a currency needs both its prices, each in that currency and
 * interval. A key put on the wrong price in the dashboard leaves that currency unsellable rather than mischarging.
 */
export function catalogFrom(prices: ReadonlyMap<string, { id: string; currency: string; unitAmount: number; interval: BillingInterval }>): Catalog {
  const pairOf = (currency: BillingCurrency) => {
    const pick = (interval: BillingInterval) => {
      const price = prices.get(GA_PRICE_LOOKUP_KEYS[currency][interval]);
      return price && price.currency === currency && price.interval === interval ? { id: price.id, unitAmount: price.unitAmount } : null;
    };
    const month = pick('month');
    const year = pick('year');
    return month && year ? { month, year } : null;
  };
  return { ILS: pairOf('ILS'), USD: pairOf('USD') };
}

/**
 * D9: Stripe can't hold a billing address to the country the person picked, so a consumer could pay from a country
 * not open to consumers. The operator's flag: a payer billed outside the consumer list with no tax ID on the customer.
 * Null where it can't be told (no country from Stripe yet, or Stripe couldn't be asked).
 */
export function consumerCountryCheck(country: string | null, taxIds: number | null, countries: BillingCountries): { openToConsumers: boolean | null; flagged: boolean | null } {
  if (country === null) return { openToConsumers: null, flagged: null };
  const openToConsumers = isConsumerCountry(countries, country);
  if (openToConsumers) return { openToConsumers, flagged: false };
  return { openToConsumers, flagged: taxIds === null ? null : taxIds === 0 };
}

/** Whether a person (no tax ID) may buy from `country`. */
export function isConsumerCountry(countries: BillingCountries, country: string): boolean {
  return countries.consumer === EVERY_COUNTRY || countries.consumer.includes(country);
}

export function currencyOf(country: string): BillingCurrency {
  return country === 'IL' ? 'ILS' : 'USD';
}

export function isReturnPath(path: string): boolean {
  return RETURN_PATH.test(path);
}

/**
 * The subscription Settings › Billing shows: the most current open one (a live row past its period plus the grace is
 * stale, as the entitlement treats it), else the latest that ended. Never a cancelled row over a live one (review).
 */
export function currentSubscription<T extends SubscriptionState>(subscriptions: readonly T[], now: Date): T | undefined {
  const byEnd = (a: T, b: T) => b.currentPeriodEnd.getTime() - a.currentPeriodEnd.getTime();
  const open = subscriptions.filter((s) => OPEN_RANK.has(s.status) && !(LIVE_STATUSES.has(s.status) && periodOver(s, now)));
  if (open.length > 0) return [...open].sort((a, b) => OPEN_RANK.get(b.status)! - OPEN_RANK.get(a.status)! || byEnd(a, b))[0];
  return [...subscriptions].filter((s) => !OPEN_RANK.has(s.status)).sort(byEnd)[0];
}

export function planCheckout(input: CheckoutInput, person: PersonBilling, countries: BillingCountries, catalog: Catalog): CheckoutPlan {
  const refusal = checkoutRefusalOf(input, person, countries);
  if (refusal) return { ok: false, code: refusal };
  const currency = currencyOf(input.country);
  const prices = catalog[currency];
  if (!prices) return { ok: false, code: 'PRICES_NOT_SET' };
  return { ok: true, currency, params: paramsOf(input, prices[input.interval], countries) };
}

/** Every refusal that needs no price: the route checks these before asking Stripe for the catalog. */
export function checkoutRefusalOf(input: Pick<CheckoutInput, 'country' | 'buyer' | 'now'>, person: PersonBilling, countries: BillingCountries): CheckoutRefusal | null {
  // A live row past its period plus the grace is stale (the mirror stopped): the entitlement has lapsed, so may this.
  const statuses = person.subscriptions.filter((s) => !(LIVE_STATUSES.has(s.status) && periodOver(s, input.now))).map((s) => s.status);
  if (statuses.some((s) => LIVE_STATUSES.has(s))) return 'ALREADY_SUBSCRIBED';
  // Stripe keeps an unpaid subscription and its open invoice, and locks the customer's currency while it exists (D6).
  if (statuses.includes('unpaid')) return 'RESUME_IN_PORTAL';
  if (statuses.includes('paused')) return 'CONTACT_US';
  if (person.owned.length === 0) return 'NOTHING_TO_COVER';
  if (person.owned.every((e) => e.source === 'MALAFAT')) return 'COVERED_BY_MALAFAT';
  // D5: the operator decides when a person under a no-expiry grant starts paying (revoking it shows Subscribe).
  if (person.owned.every((e) => e.source === 'MALAFAT' || (e.source === 'OPERATOR' && e.until === null))) return 'COVERED_BY_GRANT';
  if (!COUNTRY.test(input.country)) return 'VALIDATION_FAILED';
  if (input.buyer === 'person' && !isConsumerCountry(countries, input.country)) return 'COUNTRY_NEEDS_BUSINESS';
  return null;
}

function paramsOf(input: CheckoutInput, price: CatalogPrice, countries: BillingCountries): CheckoutParams {
  // MUT-418 D10: buying "For a business" means proving it is one, in any country: Stripe's tax ID where Stripe has the
  // type, our field where it doesn't. A person (who may buy anywhere under "*") is never asked for either.
  const business = input.buyer === 'business';
  const typedNumber = business && countries.customTaxId.includes(input.country);
  const taxIdRequired = business && !typedNumber;
  const customFields: Stripe.Checkout.SessionCreateParams.CustomField[] = typedNumber
    ? [{ key: BUSINESS_TAX_NUMBER_KEY, label: { type: 'custom', custom: TAX_NUMBER_FIELD_LABEL }, type: 'text', optional: false }]
    : [];
  return {
    mode: 'subscription',
    line_items: [{ price: price.id, quantity: 1 }],
    client_reference_id: input.userId,
    subscription_data: { metadata: { mutaba3a_user_id: input.userId }, ...trialCarriedOver(input) },
    customer_update: { address: 'auto', name: 'auto' },
    automatic_tax: { enabled: true },
    billing_address_collection: 'required',
    tax_id_collection: { enabled: true, required: taxIdRequired ? 'if_supported' : 'never' },
    custom_fields: customFields,
    locale: 'auto',
    custom_text: { submit: { message: CHECKOUT_SUBMIT_MESSAGE } },
    // The charge stays in the price's own currency: a subscription in any other couldn't be mirrored (UNSUPPORTED_CURRENCY).
    adaptive_pricing: { enabled: false },
    expires_at: Math.floor(input.now.getTime() / 1000) + CHECKOUT_SESSION_TTL_SECONDS,
    success_url: `${input.returnUrl}?billing=true&checkout=success`,
    cancel_url: `${input.returnUrl}?billing=true&checkout=cancelled`,
  };
}

/** Review D2: subscribing during the trial keeps the rest of it, so Stripe first charges on the trial's end. */
function trialCarriedOver(input: CheckoutInput): { trial_end?: number } {
  if (!input.trialEndsAt || input.trialEndsAt.getTime() - input.now.getTime() < TRIAL_CARRY_MIN_MS) return {};
  return { trial_end: Math.floor(input.trialEndsAt.getTime() / 1000) };
}

/** Fails fast at boot on a malformed `billing-countries.json` (the `config/hosts.json` rule). */
export function parseBillingCountries(raw: unknown): BillingCountries {
  const value = (raw ?? {}) as Record<string, unknown>;
  const consumer = value.consumerCountries === EVERY_COUNTRY ? EVERY_COUNTRY : codes(value, 'consumerCountries');
  return { consumer, customTaxId: codes(value, 'customTaxIdCountries') };
}

function codes(value: Record<string, unknown>, field: string): string[] {
  const list = value[field];
  if (!Array.isArray(list) || !list.every((c) => typeof c === 'string' && COUNTRY.test(c))) {
    const everywhere = field === 'consumerCountries' ? ` or "${EVERY_COUNTRY}"` : '';
    throw new Error(`billing-countries.json: ${field} must be an array of ISO 3166-1 alpha-2 codes in upper case${everywhere}`);
  }
  if (new Set(list).size !== list.length) throw new Error(`billing-countries.json: ${field} has a duplicate code`);
  return [...(list as string[])];
}

/**
 * The shipped rules, parsed once at import so a bad file stops the server starting. It lives beside this module, not in
 * the repo's `config/`: the API image's build context is `server/` and only `src/` reaches it (server/Dockerfile).
 */
export const BILLING_COUNTRIES: BillingCountries = parseBillingCountries(countriesFile);
