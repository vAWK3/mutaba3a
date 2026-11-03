import offersFile from './offers.json' with { type: 'json' };
import { CHECKOUT_SESSION_TTL_SECONDS, type BillingCurrency, type BillingInterval, type Catalog, type SubscriptionState } from './checkout.js';

/**
 * MUT-525 (plan D1–D4, eng review R1/R6/OV-6, D12, ADR-237): the launch offer. Stripe holds the campaign: a coupon
 * whose percent, duration, products and `redeem_by` are the whole of it. The code names coupon ids only
 * (`offers.json`), so starting a campaign is a dashboard coupon, ending it early is deleting the coupon, and nothing
 * here is an amount or a date. Pure: the route reads the coupon and the person's subscriptions; this decides.
 */

/**
 * MUT-532: `launch` is MUT-525's offer at Checkout; `stay` is the cancel flow's (D11). MUT-534 (D9): `comeback` is the
 * first invoice back after a paid lapse, either interval. The file's default is `launch`.
 */
export type OfferKind = 'launch' | 'stay' | 'comeback';

interface OfferEntryBase {
  /** A stable campaign name, for analytics and the subscription's `mutaba3a_offer` metadata. */
  id: string;
  tier: 'freelancer';
}
/** A launch offer (yearly) or the stay offer (monthly): each is for one interval. */
export interface IntervalOfferEntry extends OfferEntryBase {
  kind: 'launch' | 'stay';
  couponId: string;
  interval: BillingInterval;
}
/**
 * MUT-534 (D9): the come-back offer takes the same amount off whichever interval the person comes back on. One coupon
 * per currency: Stripe's Checkout refuses an amount-off coupon whose own currency isn't the price's, currency options
 * or not (QA, 2026-11-03).
 */
export interface ComebackOfferEntry extends OfferEntryBase {
  kind: 'comeback';
  couponIds: Record<BillingCurrency, string>;
}
export type OfferEntry = IntervalOfferEntry | ComebackOfferEntry;

/** What the gateway reads of a Stripe coupon (`applies_to` expanded). */
export interface CouponFact {
  id: string;
  valid: boolean;
  percentOff: number | null;
  amountOff: number | null;
  duration: string;
  /** MUT-534 (D8): an amount-off coupon's amount per currency, its own `currency` and its `currency_options`. */
  amountOffIn: { ILS: number | null; USD: number | null };
  /** MUT-532: how many invoices a `repeating` coupon discounts; null for any other duration. */
  durationInMonths: number | null;
  redeemBy: Date | null;
  /** Null: the coupon applies to any product. */
  appliesToProducts: string[] | null;
}

export interface Offer {
  id: string;
  couponId: string;
  percentOff: number;
  interval: BillingInterval;
  /** The last moment a new Checkout gets the coupon, shown everywhere as the offer's end: redeem_by − 1 h (R1). */
  endsAt: Date;
}

/** R1: a Checkout stays payable for its TTL, so the offer ends that long before the coupon's own `redeem_by`. */
export const OFFER_END_MARGIN_MS = CHECKOUT_SESSION_TTL_SECONDS * 1000;
/** D5's spike (ADR-237): a `once` coupon survives a carried trial and discounts the first paid invoice only. */
const OFFER_DURATION = 'once';
const OFFER_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const COUPON_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Fails fast at boot on a malformed `offers.json` (the `billing-countries.json` rule). */
export function parseOffers(raw: unknown): OfferEntry[] {
  if (!Array.isArray(raw)) throw new Error('offers.json: must be an array of offers');
  const entries = raw.map((value, i) => {
    const entry = (value ?? {}) as Record<string, unknown>;
    const field = (name: string, ok: (v: unknown) => boolean, rule: string) => {
      if (!ok(entry[name])) throw new Error(`offers.json: offer ${i} ${name} ${rule}`);
      return entry[name] as string;
    };
    const kind = (entry['kind'] === undefined ? 'launch' : field('kind', (v) => v === 'launch' || v === 'stay' || v === 'comeback', 'must be "launch", "stay" or "comeback"')) as OfferKind;
    const base = {
      id: field('id', (v) => typeof v === 'string' && OFFER_ID.test(v), 'must be lower-case letters, digits and dashes'),
      tier: field('tier', (v) => v === 'freelancer', 'must be "freelancer"') as 'freelancer',
    };
    if (kind === 'comeback') {
      // MUT-534 (D9): one amount off whichever interval the person comes back on; an interval would mean nothing.
      if (entry['interval'] !== undefined) throw new Error(`offers.json: offer ${i}: a come-back offer has no interval`);
      const ids = (entry['couponIds'] ?? {}) as Record<string, unknown>;
      if (!(['ILS', 'USD'] as const).every((c) => typeof ids[c] === 'string' && COUPON_ID.test(ids[c] as string))) {
        throw new Error(`offers.json: offer ${i} couponIds must name a Stripe coupon for ILS and for USD`);
      }
      return { id: base.id, kind, couponIds: { ILS: ids['ILS'] as string, USD: ids['USD'] as string }, tier: base.tier } satisfies ComebackOfferEntry;
    }
    const couponId = field('couponId', (v) => typeof v === 'string' && COUPON_ID.test(v), 'must be a Stripe coupon id');
    const interval = field('interval', (v) => v === 'month' || v === 'year', 'must be "month" or "year"') as BillingInterval;
    // MUT-532 (D10/D11): a stay coupon on a yearly plan would halve a renewal; it is monthly only.
    if (kind === 'stay' && interval !== 'month') throw new Error(`offers.json: offer ${i} interval must be "month" for a stay offer`);
    return { id: base.id, couponId, kind, interval, tier: base.tier } satisfies IntervalOfferEntry;
  });
  if (new Set(entries.map((e) => e.id)).size !== entries.length) throw new Error('offers.json: an offer id is a duplicate');
  return entries;
}

/** The shipped offers, parsed once at import so a bad file stops the server starting. */
export const OFFERS: readonly OfferEntry[] = parseOffers(offersFile);

/**
 * R6: a non-production server may name its own coupons (BILLING_OFFER_COUPON_ID, MUT-532's BILLING_STAY_COUPON_ID,
 * MUT-534's BILLING_COMEBACK_COUPON_ID; each refused on a live key environment), so each QA run owns its coupons. Each
 * replaces its kind's entries with one, under that kind's first name: a yearly launch offer, a monthly stay offer, a
 * come-back offer.
 */
export function offersFor(overrides: { launch?: string | undefined; stay?: string | undefined; comeback?: Record<BillingCurrency, string> | undefined }): readonly OfferEntry[] {
  if (!overrides.launch && !overrides.stay && !overrides.comeback) return OFFERS;
  const nameOf = (kind: OfferKind, fallback: string) => OFFERS.find((e) => e.kind === kind)?.id ?? fallback;
  const ofKind = (kind: OfferKind) => OFFERS.filter((e) => e.kind === kind);
  const launch: OfferEntry[] = overrides.launch ? [{ id: nameOf('launch', 'launch-2026'), couponId: overrides.launch, kind: 'launch', interval: 'year', tier: 'freelancer' }] : ofKind('launch');
  const stay: OfferEntry[] = overrides.stay ? [{ id: nameOf('stay', 'stay-2026'), couponId: overrides.stay, kind: 'stay', interval: 'month', tier: 'freelancer' }] : ofKind('stay');
  const comeback: OfferEntry[] = overrides.comeback ? [{ id: nameOf('comeback', 'comeback-2026'), couponIds: overrides.comeback, kind: 'comeback', tier: 'freelancer' }] : ofKind('comeback');
  return [...launch, ...stay, ...comeback];
}

/** MUT-532 (D11): the cancel flow's stay offer entry, if the list has one. */
export function stayEntryOf(entries: readonly OfferEntry[]): IntervalOfferEntry | null {
  return entries.find((e): e is IntervalOfferEntry => e.kind === 'stay') ?? null;
}

/** MUT-534 (D9): the come-back offer entry, if the list has one. */
export function comebackEntryOf(entries: readonly OfferEntry[]): ComebackOfferEntry | null {
  return entries.find((e): e is ComebackOfferEntry => e.kind === 'comeback') ?? null;
}

/** Every product the catalog sells: the coupon must be restricted to these (D1, D3). */
export function productIdsOf(catalog: Catalog): Set<string> {
  return new Set(Object.values(catalog).flatMap((pair) => (pair ? [pair.month.productId, pair.year.productId] : [])));
}

/**
 * The offer a coupon makes, or null when it isn't one as D1 shapes it: valid, a percentage, `once`, a `redeem_by`
 * (OV-6), restricted to the Freelancer products only, and still at least a Checkout's TTL away from its end (R1).
 */
export function offerFromCoupon(entry: IntervalOfferEntry, coupon: CouponFact | null, freelancerProducts: ReadonlySet<string>, now: Date): Offer | null {
  if (!coupon || !coupon.valid || coupon.duration !== OFFER_DURATION || !coupon.redeemBy) return null;
  const percent = coupon.percentOff;
  if (percent === null || !(percent > 0 && percent <= 100)) return null;
  const products = coupon.appliesToProducts;
  if (!products || products.length === 0 || !products.every((p) => freelancerProducts.has(p))) return null;
  const endsAt = new Date(coupon.redeemBy.getTime() - OFFER_END_MARGIN_MS);
  if (now.getTime() >= endsAt.getTime()) return null;
  return { id: entry.id, couponId: entry.couponId, percentOff: percent, interval: entry.interval, endsAt };
}

/** D12: for an interval, the first entry whose coupon is an offer. An interval no entry has reads no coupon (R9d). */
export async function resolveOffer(
  entries: readonly OfferEntry[],
  interval: BillingInterval,
  readCoupon: (couponId: string) => Promise<CouponFact | null>,
  freelancerProducts: ReadonlySet<string>,
  now: Date,
): Promise<Offer | null> {
  for (const entry of entries.filter((e): e is IntervalOfferEntry => e.kind === 'launch' && e.interval === interval)) {
    const offer = offerFromCoupon(entry, await readCoupon(entry.couponId), freelancerProducts, now);
    if (offer) return offer;
  }
  return null;
}

/** D2: someone who never had a subscription, in any status, buying the offer's interval (D3). */
export function offerEligible(offer: Offer | null, subscriptions: readonly SubscriptionState[], interval: BillingInterval): boolean {
  return offer !== null && offer.interval === interval && subscriptions.length === 0;
}

/** D4: Stripe rounds the discount to the minor unit (half up); the first year is what is left. */
export function firstYearOf(unitAmount: number, percentOff: number): number {
  return unitAmount - Math.round((unitAmount * percentOff) / 100);
}

/** GET /v1/billing `offer` (§2): the amounts per currency, so no client does the arithmetic (ADR-004). */
export function offerView(offer: Offer, eligible: boolean, catalog: Catalog) {
  const first = (currency: BillingCurrency) => {
    const pair = catalog[currency];
    return pair ? firstYearOf(pair[offer.interval].unitAmount, offer.percentOff) : null;
  };
  return {
    id: offer.id,
    percentOff: offer.percentOff,
    endsAt: offer.endsAt.toISOString(),
    interval: offer.interval,
    eligible,
    firstYear: { ILS: first('ILS'), USD: first('USD') },
  };
}
