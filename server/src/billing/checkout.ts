import type Stripe from 'stripe';
import countriesFile from './billing-countries.json' with { type: 'json' };
import { grantIsLive, periodOver, type BillingTier, type Entitlement, type GrantFact } from './entitlement.js';
import { formatMinor } from './money.js';
import { ARABIC_LOCALE } from '../dates.js';

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

/**
 * MUT-565 (ADR-251): the Accountant plan's list prices, monthly only at launch (Question 2). The amounts live in Stripe
 * (placeholder ₪99 / $25 until Basel sets the final price); a key on a product not tagged `tier: accountant` leaves
 * the plan unsellable (PRICES_NOT_SET), never mischarges.
 */
export const ACCOUNTANT_PRICE_LOOKUP_KEYS: Readonly<Record<BillingCurrency, { month: string }>> = {
  ILS: { month: 'accountant_list_monthly_ils' },
  USD: { month: 'accountant_list_monthly_usd' },
};
export const ALL_ACCOUNTANT_LOOKUP_KEYS: readonly string[] = Object.values(ACCOUNTANT_PRICE_LOOKUP_KEYS).map((k) => k.month);
/** MUT-565 review: the Checkout Session metadata naming its plan; absent is the Freelancer plan (sessions made before). */
export const CHECKOUT_PLAN_METADATA_KEY = 'mutaba3a_plan';
/** Which plan a Checkout is for (CheckoutSessionRequest.plan; absent is freelancer). */
export type CheckoutPlanName = 'freelancer' | 'accountant';
/** The Stripe product tier a lookup key must sit on: `accountant_*` keys on the Accountant product, every other on Freelancer. */
export function expectedTierOfLookupKey(key: string): 'freelancer' | 'accountant' {
  return key.startsWith('accountant_') ? 'accountant' : 'freelancer';
}

export interface CatalogPrice {
  id: string;
  /** Minor units, as Stripe stores them. */
  unitAmount: number;
  /** MUT-525 (OV-4): the price's product, so an offer's coupon can be checked to be the Freelancer one's. */
  productId: string;
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
/**
 * A portal path: `/` or a profile's page; MUT-565: or the accountant invite page, or the client books (one of them).
 * Never an origin, a query or `..`, so the return URL can't leave the portal.
 */
const RETURN_PATH = new RegExp(`^/((p/${UUID}(/[a-z0-9-]+)*)|accountant-invite|client-books(/${UUID})?)?$`);

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
  /** MUT-565: the plan it is for; Stripe's own list reads it off the price's lookup key. Absent or null: a profile plan. */
  tier?: BillingTier | null;
  status: string;
  currentPeriodEnd: Date;
  /** MUT-534 (R7): the offer its Checkout carried (`metadata.mutaba3a_offer`), from Stripe's own list; absent from the mirror's. */
  offerId?: string | null;
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
  /** MUT-525: the launch offer this Checkout carries (the route decided it applies), else null or absent. */
  offer?: AppliedOffer | null;
}

/** MUT-525: what an offer adds to a Checkout: its coupon, its name in the metadata, and the pay-page line (R8). */
export interface AppliedOffer {
  id: string;
  couponId: string;
  /** Minor units of the price's own currency: the first period after the discount, and the list price after it. */
  firstAmount: number;
  listAmount: number;
  /** MUT-534: `comeback` takes an amount off the first month or year; absent is MUT-525's launch offer (a first year). */
  kind?: 'launch' | 'comeback';
  interval?: BillingInterval;
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
export function catalogFrom(prices: ReadonlyMap<string, { id: string; currency: string; unitAmount: number; interval: BillingInterval; productId: string }>): Catalog {
  const pairOf = (currency: BillingCurrency) => {
    const pick = (interval: BillingInterval) => {
      const price = prices.get(GA_PRICE_LOOKUP_KEYS[currency][interval]);
      return price && price.currency === currency && price.interval === interval ? { id: price.id, unitAmount: price.unitAmount, productId: price.productId } : null;
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
  return { ok: true, currency, params: paramsOf(input, currency, prices[input.interval], countries) };
}

/** MUT-565: the Accountant plan's sellable catalog: a currency needs its monthly price, in that currency and interval. */
export type AccountantCatalog = Record<BillingCurrency, { month: CatalogPrice } | null>;

export function accountantCatalogFrom(prices: ReadonlyMap<string, { id: string; currency: string; unitAmount: number; interval: BillingInterval; productId: string }>): AccountantCatalog {
  const of = (currency: BillingCurrency) => {
    const price = prices.get(ACCOUNTANT_PRICE_LOOKUP_KEYS[currency].month);
    return price && price.currency === currency && price.interval === 'month' ? { month: { id: price.id, unitAmount: price.unitAmount, productId: price.productId } } : null;
  };
  return { ILS: of('ILS'), USD: of('USD') };
}

/** MUT-565: what the Accountant plan's Checkout refusals read: the person's ACCOUNTANT subscriptions and grants only. */
export interface AccountantPersonBilling {
  subscriptions: readonly SubscriptionState[];
  grants: readonly Pick<GrantFact, 'tier' | 'userId' | 'organizationId' | 'expiresAt' | 'revokedAt'>[];
}

/**
 * MUT-565 (ADR-251, P7): the Accountant plan's refusals. Only that plan's subscriptions count (a Freelancer payer may
 * buy it, and the reverse); a no-expiry ACCOUNTANT grant means there is nothing to pay. No profile rules: the plan
 * covers client books, never the person's own profiles. Monthly only. Country rules as for the Freelancer plan.
 */
export function accountantCheckoutRefusalOf(input: Pick<CheckoutInput, 'country' | 'buyer' | 'now' | 'interval'>, person: AccountantPersonBilling, countries: BillingCountries): CheckoutRefusal | null {
  if (input.interval !== 'month') return 'VALIDATION_FAILED';
  const statuses = person.subscriptions.filter((s) => s.tier === 'ACCOUNTANT' && !(LIVE_STATUSES.has(s.status) && periodOver(s, input.now))).map((s) => s.status);
  if (statuses.some((s) => LIVE_STATUSES.has(s))) return 'ALREADY_SUBSCRIBED';
  if (statuses.includes('unpaid')) return 'RESUME_IN_PORTAL';
  if (statuses.includes('paused')) return 'CONTACT_US';
  if (person.grants.some((g) => g.tier === 'ACCOUNTANT' && g.organizationId === null && g.expiresAt === null && grantIsLive(g, input.now))) return 'COVERED_BY_GRANT';
  if (!COUNTRY.test(input.country)) return 'VALIDATION_FAILED';
  if (input.buyer === 'person' && !isConsumerCountry(countries, input.country)) return 'COUNTRY_NEEDS_BUSINESS';
  return null;
}

/** MUT-565: the Accountant plan's Checkout: the same parameters as the Freelancer plan's, with no trial and no offer. */
export function planAccountantCheckout(input: CheckoutInput, person: AccountantPersonBilling, countries: BillingCountries, catalog: AccountantCatalog): CheckoutPlan {
  const refusal = accountantCheckoutRefusalOf(input, person, countries);
  if (refusal) return { ok: false, code: refusal };
  const currency = currencyOf(input.country);
  const prices = catalog[currency];
  if (!prices) return { ok: false, code: 'PRICES_NOT_SET' };
  // Review: the session names its plan, so expiring open Checkouts touches only this plan's (`expireOpenCheckouts`).
  return { ok: true, currency, params: { ...paramsOf({ ...input, trialEndsAt: null, offer: null }, currency, prices.month, countries), metadata: { [CHECKOUT_PLAN_METADATA_KEY]: 'accountant' } } };
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

function paramsOf(input: CheckoutInput, currency: BillingCurrency, price: CatalogPrice, countries: BillingCountries): CheckoutParams {
  // MUT-418 D10: buying "For a business" means proving it is one, in any country: Stripe's tax ID where Stripe has the
  // type, our field where it doesn't. A person (who may buy anywhere under "*") is never asked for either.
  const business = input.buyer === 'business';
  const typedNumber = business && countries.customTaxId.includes(input.country);
  const taxIdRequired = business && !typedNumber;
  const customFields: Stripe.Checkout.SessionCreateParams.CustomField[] = typedNumber
    ? [{ key: BUSINESS_TAX_NUMBER_KEY, label: { type: 'custom', custom: TAX_NUMBER_FIELD_LABEL }, type: 'text', optional: false }]
    : [];
  const offer = input.offer ?? null;
  const trial = trialCarriedOver(input);
  return {
    mode: 'subscription',
    line_items: [{ price: price.id, quantity: 1 }],
    client_reference_id: input.userId,
    ...(offer ? { discounts: [{ coupon: offer.couponId }] } : {}),
    subscription_data: { metadata: { mutaba3a_user_id: input.userId, ...(offer ? { [OFFER_METADATA_KEY]: offer.id } : {}) }, ...trial },
    customer_update: { address: 'auto', name: 'auto' },
    automatic_tax: { enabled: true },
    billing_address_collection: 'required',
    tax_id_collection: { enabled: true, required: taxIdRequired ? 'if_supported' : 'never' },
    custom_fields: customFields,
    locale: 'auto',
    custom_text: { submit: { message: offer ? offerSubmitMessage(offer, currency, renewsOnOf(input.now, trial.trial_end)) : CHECKOUT_SUBMIT_MESSAGE } },
    // The charge stays in the price's own currency: a subscription in any other couldn't be mirrored (UNSUPPORTED_CURRENCY).
    adaptive_pricing: { enabled: false },
    expires_at: Math.floor(input.now.getTime() / 1000) + CHECKOUT_SESSION_TTL_SECONDS,
    success_url: `${input.returnUrl}?billing=true&checkout=success`,
    cancel_url: `${input.returnUrl}?billing=true&checkout=cancelled`,
  };
}

/** MUT-525: the subscription metadata naming the offer a Checkout carried; the webhook mirrors it (`offerId`). */
export const OFFER_METADATA_KEY = 'mutaba3a_offer';

/** The first paid year starts at the carried trial's end, else now; the list price is charged a year later. */
export function renewsOnOf(now: Date, trialEndSeconds: number | undefined): Date {
  const start = trialEndSeconds === undefined ? new Date(now) : new Date(trialEndSeconds * 1000);
  start.setUTCFullYear(start.getUTCFullYear() + 1);
  return start;
}

const ISOLATE = (text: string) => `\u2068${text}\u2069`;

/** A pay-page date (DD12a): a long date on the Jerusalem calendar, Levantine months and Western digits in Arabic (MUT-587). */
export function payPageDay(at: Date, locale: 'ar' | 'en'): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? ARABIC_LOCALE : 'en-US', { dateStyle: 'long', timeZone: 'Asia/Jerusalem' }).format(at);
}

/**
 * R8, DD12a: an offer Checkout states, in Arabic and English above Pay, the first year's price, the price it renews
 * at and from when. Arabic first (Stripe's page has none of its own); amounts and dates are bidi-isolated.
 */
export function offerSubmitMessage(offer: AppliedOffer, currency: BillingCurrency, renewsOn: Date): string {
  const price = ISOLATE(formatMinor(offer.firstAmount, currency));
  const list = ISOLATE(formatMinor(offer.listAmount, currency));
  const [arNote, enNote] = CHECKOUT_SUBMIT_MESSAGE.split('\n\n');
  // MUT-534 (plan §6, approved): the come-back line names the first month or year and the price after it, no date.
  if (offer.kind === 'comeback') {
    const yearly = offer.interval === 'year';
    return [
      yearly ? `عرض العودة: ${price} لسنتك الأولى، ثم ${list} سنويًا.` : `عرض العودة: ${price} لشهرك الأول، ثم ${list} شهريًا.`,
      arNote,
      yearly ? `Welcome-back offer: ${price} for your first year, then ${list} a year.` : `Welcome-back offer: ${price} for your first month, then ${list} a month.`,
      enNote,
    ].join('\n\n');
  }
  return [
    `عرض الإطلاق: ${price} عن سنتك الأولى، ثم يتجدد بسعر ${list} سنويًا ابتداءً من ${ISOLATE(payPageDay(renewsOn, 'ar'))}.`,
    arNote,
    `Launch offer: ${price} for your first year. It then renews at ${list} a year from ${ISOLATE(payPageDay(renewsOn, 'en'))}.`,
    enNote,
  ].join('\n\n');
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
