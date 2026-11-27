import offersFile from './offers.json' with { type: 'json' };
import { CHECKOUT_SESSION_TTL_SECONDS, type BillingCurrency, type BillingInterval, type Catalog, type PlanCatalogs, type SubscriptionState } from './checkout.js';
import { PLAN_NAMES, type LegacyPlanName, type PlanName } from './plans.js';

/**
 * MUT-525 (plan D1–D4, eng review R1/R6/OV-6, D12, ADR-237): the launch offer. Stripe holds the campaign: a coupon
 * whose percent, duration, products and `redeem_by` are the whole of it. The code names coupon ids only
 * (`offers.json`), so nothing here is an amount or a date. Pure: the route reads the coupon and the person's
 * subscriptions; this decides.
 *
 * MUT-703 (ADR-340): every entry names the plans it covers (`plans`), and an offer is looked up by (kind, plan,
 * interval). The legacy Freelancer entries keep their ids and coupons; the plans on sale (Solo, Business, Firm) share
 * one coupon per kind, made only by the catalog script (scripts/stripe-plans.ts `COUPON_SPEC`).
 */

/**
 * MUT-532: `launch` is MUT-525's offer at Checkout; `stay` is the cancel flow's (D11). MUT-534 (D9): `comeback` is the
 * first invoice back after a paid lapse. The file's default is `launch`.
 */
export type OfferKind = 'launch' | 'stay' | 'comeback';
/** MUT-703: a plan an offer may cover: one on sale, or the legacy Freelancer plan (never both in one entry). */
export type OfferPlan = PlanName | LegacyPlanName;
export const LEGACY_OFFER_PLAN: LegacyPlanName = 'freelancer';

interface OfferEntryBase {
  /** A stable campaign name, for analytics and the subscription's `mutaba3a_offer` metadata. */
  id: string;
  /** MUT-703: the plans whose products the coupon covers (`tier: "freelancer"` in the file is `["freelancer"]`). */
  plans: readonly OfferPlan[];
}
/** A launch offer (yearly) or the stay offer (monthly): each is for one interval. */
export interface IntervalOfferEntry extends OfferEntryBase {
  kind: 'launch' | 'stay';
  couponId: string;
  interval: BillingInterval;
}
/**
 * MUT-534 (D9): the legacy come-back offer takes the same amount off whichever interval the person comes back on. One
 * coupon per currency: Stripe's Checkout refuses an amount-off coupon whose own currency isn't the price's.
 */
export interface LegacyComebackEntry extends OfferEntryBase {
  kind: 'comeback';
  couponIds: Record<BillingCurrency, string>;
}
/**
 * MUT-703 (§13 Q1, Q4): the plans' come-back offer, a percent off, so one coupon serves both currencies and every plan.
 * `interval` limits it (null: both).
 */
export interface PercentComebackEntry extends OfferEntryBase {
  kind: 'comeback';
  couponId: string;
  interval: BillingInterval | null;
}
export type ComebackOfferEntry = LegacyComebackEntry | PercentComebackEntry;
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

/** MUT-703: the catalogs a coupon's products are read from: the legacy Freelancer one and each plan on sale's. */
export interface OfferCatalogs {
  legacy: Catalog;
  plans: PlanCatalogs | null;
}

/** R1: a Checkout stays payable for its TTL, so the offer ends that long before the coupon's own `redeem_by`. */
export const OFFER_END_MARGIN_MS = CHECKOUT_SESSION_TTL_SECONDS * 1000;
/** D5's spike (ADR-237): a `once` coupon survives a carried trial and discounts the first paid invoice only. */
const OFFER_DURATION = 'once';
const OFFER_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const COUPON_ID = /^[A-Za-z0-9_-]{1,64}$/;
const OFFER_PLANS: readonly string[] = [...PLAN_NAMES, LEGACY_OFFER_PLAN];

/** MUT-703: an entry's plans: `plans`, or the legacy `tier: "freelancer"`; all on sale or all legacy, no repeats. */
function plansOf(entry: Record<string, unknown>, i: number): OfferPlan[] {
  if (entry['plans'] === undefined) {
    if (entry['tier'] === LEGACY_OFFER_PLAN) return [LEGACY_OFFER_PLAN];
    throw new Error(`offers.json: offer ${i} needs plans (or the legacy tier "freelancer")`);
  }
  if (entry['tier'] !== undefined) throw new Error(`offers.json: offer ${i} names plans and a tier; keep plans`);
  const plans = entry['plans'];
  if (!Array.isArray(plans) || plans.length === 0) throw new Error(`offers.json: offer ${i} plans must be a non-empty list`);
  for (const plan of plans) if (typeof plan !== 'string' || !OFFER_PLANS.includes(plan)) throw new Error(`offers.json: offer ${i} plans: "${String(plan)}" is not a plan`);
  if (new Set(plans).size !== plans.length) throw new Error(`offers.json: offer ${i} plans repeat a plan`);
  // A coupon's products are fixed when Stripe makes it: one coupon can't be the legacy plan's and a plan on sale's.
  if (plans.includes(LEGACY_OFFER_PLAN) && plans.length > 1) throw new Error(`offers.json: offer ${i} plans mix the legacy freelancer plan with plans on sale`);
  return plans as OfferPlan[];
}

/** Fails fast at boot on a malformed `offers.json` (the `billing-countries.json` rule). */
export function parseOffers(raw: unknown): OfferEntry[] {
  if (!Array.isArray(raw)) throw new Error('offers.json: must be an array of offers');
  const entries = raw.map((value, i): OfferEntry => {
    const entry = (value ?? {}) as Record<string, unknown>;
    const field = (name: string, ok: (v: unknown) => boolean, rule: string) => {
      if (!ok(entry[name])) throw new Error(`offers.json: offer ${i} ${name} ${rule}`);
      return entry[name] as string;
    };
    const kind = (entry['kind'] === undefined ? 'launch' : field('kind', (v) => v === 'launch' || v === 'stay' || v === 'comeback', 'must be "launch", "stay" or "comeback"')) as OfferKind;
    const id = field('id', (v) => typeof v === 'string' && OFFER_ID.test(v), 'must be lower-case letters, digits and dashes');
    const plans = plansOf(entry, i);
    if (kind === 'comeback') {
      if (entry['couponIds'] !== undefined) {
        // MUT-534 (D9): one amount off whichever interval the person comes back on; an interval would mean nothing.
        if (entry['interval'] !== undefined) throw new Error(`offers.json: offer ${i}: a come-back offer with couponIds has no interval`);
        const ids = (entry['couponIds'] ?? {}) as Record<string, unknown>;
        if (!(['ILS', 'USD'] as const).every((c) => typeof ids[c] === 'string' && COUPON_ID.test(ids[c] as string))) {
          throw new Error(`offers.json: offer ${i} couponIds must name a Stripe coupon for ILS and for USD`);
        }
        return { id, kind, couponIds: { ILS: ids['ILS'] as string, USD: ids['USD'] as string }, plans } satisfies LegacyComebackEntry;
      }
      const couponId = field('couponId', (v) => typeof v === 'string' && COUPON_ID.test(v), 'must be a Stripe coupon id (or couponIds per currency)');
      const interval = entry['interval'] === undefined ? null : (field('interval', (v) => v === 'month' || v === 'year', 'must be "month" or "year"') as BillingInterval);
      return { id, kind, couponId, interval, plans } satisfies PercentComebackEntry;
    }
    const couponId = field('couponId', (v) => typeof v === 'string' && COUPON_ID.test(v), 'must be a Stripe coupon id');
    const interval = field('interval', (v) => v === 'month' || v === 'year', 'must be "month" or "year"') as BillingInterval;
    // MUT-532 (D10/D11): a stay coupon on a yearly plan would halve a renewal; it is monthly only.
    if (kind === 'stay' && interval !== 'month') throw new Error(`offers.json: offer ${i} interval must be "month" for a stay offer`);
    return { id, couponId, kind, interval, plans } satisfies IntervalOfferEntry;
  });
  if (new Set(entries.map((e) => e.id)).size !== entries.length) throw new Error('offers.json: an offer id is a duplicate');
  return entries;
}

/** The shipped offers, parsed once at import so a bad file stops the server starting. */
export const OFFERS: readonly OfferEntry[] = parseOffers(offersFile);

/**
 * R6: a non-production server may name its own coupons (BILLING_OFFER_COUPON_ID, MUT-532's BILLING_STAY_COUPON_ID,
 * MUT-534's BILLING_COMEBACK_COUPON_ID_*; each refused on a live key environment), so each QA run owns its coupons. Each
 * replaces the coupon of its kind's entries, keeping their ids and plans (MUT-703: the come-back pair replaces the legacy
 * per-currency coupons only).
 */
export function offersFor(overrides: { launch?: string | undefined; stay?: string | undefined; comeback?: Record<BillingCurrency, string> | undefined }): readonly OfferEntry[] {
  if (!overrides.launch && !overrides.stay && !overrides.comeback) return OFFERS;
  return OFFERS.map((entry): OfferEntry => {
    if (entry.kind === 'launch' && overrides.launch) return { ...entry, couponId: overrides.launch };
    if (entry.kind === 'stay' && overrides.stay) return { ...entry, couponId: overrides.stay };
    if (entry.kind === 'comeback' && 'couponIds' in entry && overrides.comeback) return { ...entry, couponIds: overrides.comeback };
    return entry;
  });
}

/** MUT-703: the entries of a kind covering a plan (and an interval, where the entry names one), in file order. */
export function entriesFor(entries: readonly OfferEntry[], kind: OfferKind, plan: OfferPlan, interval?: BillingInterval): OfferEntry[] {
  return entries.filter((e) => {
    if (e.kind !== kind || !e.plans.includes(plan)) return false;
    if (interval === undefined) return true;
    if ('interval' in e) return e.interval === null || e.interval === interval;
    return true;
  });
}

/** MUT-703: the first entry of a kind covering a plan (and interval); null with none. */
export function entryFor(entries: readonly OfferEntry[], kind: OfferKind, plan: OfferPlan, interval?: BillingInterval): OfferEntry | null {
  return entriesFor(entries, kind, plan, interval)[0] ?? null;
}

/** MUT-532 (D11), MUT-703: the cancel flow's stay offer entry for a plan, if the list has one. */
export function stayEntryFor(entries: readonly OfferEntry[], plan: OfferPlan): IntervalOfferEntry | null {
  return (entryFor(entries, 'stay', plan, 'month') as IntervalOfferEntry | null) ?? null;
}

/** MUT-534 (D9), MUT-703: the come-back offer entry for a plan, if the list has one. */
export function comebackEntryFor(entries: readonly OfferEntry[], plan: OfferPlan): ComebackOfferEntry | null {
  return (entryFor(entries, 'comeback', plan) as ComebackOfferEntry | null) ?? null;
}

/** MUT-703 (§3.1): every come-back entry's id, old and new: someone who used one can't take another. */
export function comebackIdsOf(entries: readonly OfferEntry[]): ReadonlySet<string> {
  return new Set(entries.filter((e) => e.kind === 'comeback').map((e) => e.id));
}

/** MUT-703 (§5): the offer a running discount's coupon belongs to (a plan change's `offerEnds`); null when it is none of ours. */
export function offerOfCoupon(entries: readonly OfferEntry[], couponId: string): { id: string; kind: OfferKind } | null {
  const entry = entries.find((e) => ('couponIds' in e ? Object.values(e.couponIds).includes(couponId) : e.couponId === couponId));
  return entry ? { id: entry.id, kind: entry.kind } : null;
}

/** Every product the catalog sells. */
export function productIdsOf(catalog: Catalog): Set<string> {
  return new Set(Object.values(catalog).flatMap((pair) => (pair ? [pair.month.productId, pair.year.productId] : [])));
}

/** MUT-703: the catalog a plan is sold from: the legacy one for Freelancer, the plan's own otherwise. */
export function catalogFor(catalogs: OfferCatalogs, plan: OfferPlan): Catalog {
  if (plan === LEGACY_OFFER_PLAN) return catalogs.legacy;
  return catalogs.plans?.[plan] ?? { ILS: null, USD: null };
}

/** MUT-703 (§3.2): the products of exactly these plans, the coupon's `applies_to` must sit inside. */
export function productsOf(plans: readonly OfferPlan[], catalogs: OfferCatalogs): Set<string> {
  return new Set(plans.flatMap((plan) => [...productIdsOf(catalogFor(catalogs, plan))]));
}

/**
 * MUT-703 (§3.2): a coupon may make an offer on a plan only if its products are non-empty, all inside the entry's
 * products, and include the product of the plan sold or held (else Stripe would silently not discount the line).
 */
export function couponCovers(coupon: CouponFact, entryProducts: ReadonlySet<string>, sold: ReadonlySet<string>): boolean {
  const products = coupon.appliesToProducts;
  if (!products || products.length === 0 || !products.every((p) => entryProducts.has(p))) return false;
  return products.some((p) => sold.has(p));
}

/**
 * The offer a coupon makes, or null when it isn't one as D1 shapes it: valid, a percentage, `once`, a `redeem_by`
 * (OV-6), restricted to the entry's products and covering the plan sold (MUT-703), and still at least a Checkout's TTL
 * away from its end (R1).
 */
export function offerFromCoupon(entry: IntervalOfferEntry, coupon: CouponFact | null, entryProducts: ReadonlySet<string>, now: Date, sold: ReadonlySet<string> = entryProducts): Offer | null {
  if (!coupon || !coupon.valid || coupon.duration !== OFFER_DURATION || !coupon.redeemBy) return null;
  const percent = coupon.percentOff;
  if (percent === null || !(percent > 0 && percent <= 100)) return null;
  if (!couponCovers(coupon, entryProducts, sold)) return null;
  const endsAt = new Date(coupon.redeemBy.getTime() - OFFER_END_MARGIN_MS);
  if (now.getTime() >= endsAt.getTime()) return null;
  return { id: entry.id, couponId: entry.couponId, percentOff: percent, interval: entry.interval, endsAt };
}

/**
 * D12, MUT-703: for a plan and an interval, the first launch entry whose coupon is an offer on that plan. An interval
 * or plan no entry has reads no coupon (R9d).
 */
export async function resolveOffer(
  entries: readonly OfferEntry[],
  plan: OfferPlan,
  interval: BillingInterval,
  readCoupon: (couponId: string) => Promise<CouponFact | null>,
  catalogs: OfferCatalogs,
  now: Date,
): Promise<Offer | null> {
  const sold = productIdsOf(catalogFor(catalogs, plan));
  if (sold.size === 0) return null;
  for (const entry of entriesFor(entries, 'launch', plan, interval) as IntervalOfferEntry[]) {
    const offer = offerFromCoupon(entry, await readCoupon(entry.couponId), productsOf(entry.plans, catalogs), now, sold);
    if (offer) return offer;
  }
  return null;
}

/** MUT-534, MUT-703 (§13 Q6): a subscription that never took money and never will. */
const NEVER_PAID_STATUSES: ReadonlySet<string> = new Set(['incomplete', 'incomplete_expired']);

/**
 * MUT-703 (§13 Q6): whether a subscription took money (or still may: a running one counts). One that never paid, or a
 * trial cancelled at or before its end (the card-up-front Solo trial), doesn't use the launch offer up.
 */
export function tookMoney(subscription: SubscriptionState): boolean {
  if (NEVER_PAID_STATUSES.has(subscription.status)) return false;
  const { trialEnd, endedAt } = subscription;
  if (subscription.status === 'canceled' && trialEnd && endedAt && endedAt.getTime() <= trialEnd.getTime()) return false;
  return true;
}

/** D2, MUT-703 (§13 Q6): someone who never had a subscription that took money, buying the offer's interval (D3). */
export function offerEligible(offer: Offer | null, subscriptions: readonly SubscriptionState[], interval: BillingInterval): boolean {
  return offer !== null && offer.interval === interval && !subscriptions.some(tookMoney);
}

/** D4: Stripe rounds the discount to the minor unit (half up); the first period is what is left. */
export function firstYearOf(unitAmount: number, percentOff: number): number {
  return unitAmount - Math.round((unitAmount * percentOff) / 100);
}

/** GET /v1/billing `offer` (§2): the amounts per currency, so no client does the arithmetic (ADR-004). */
export function offerView(offer: Offer, eligible: boolean, catalog: Catalog) {
  return {
    id: offer.id,
    percentOff: offer.percentOff,
    endsAt: offer.endsAt.toISOString(),
    interval: offer.interval,
    eligible,
    firstYear: firstAmountsOf(offer, catalog),
  };
}

/** MUT-703: the first period after the offer per currency, null where the catalog doesn't sell it. */
export function firstAmountsOf(offer: Offer, catalog: Catalog): Record<BillingCurrency, number | null> {
  const first = (currency: BillingCurrency) => {
    const pair = catalog[currency];
    return pair ? firstYearOf(pair[offer.interval].unitAmount, offer.percentOff) : null;
  };
  return { ILS: first('ILS'), USD: first('USD') };
}
