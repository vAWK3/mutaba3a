import type { BillingRetentionEventRecord, BillingTierRecord } from '../repositories/ports.js';
import type { BillingCurrency, Catalog } from './checkout.js';
import { productIdsOf, type ComebackOfferEntry, type CouponFact } from './offer.js';

/**
 * MUT-534 (plan D8–D14, ADR-243): the come-back offer. A person whose paid Freelancer plan ended gets a mail 30 and 90
 * days later: their records are still there, and the first month back is the list price less the coupon's amount
 * (₪9 / $3), or a first year less the same amount. Pure, like the launch and stay offers: the coupon and the catalog
 * hold every amount (ADR-004); these decide its shape, the stage a lapse is in, and who may have it.
 */

/** D8: the coupon takes its amount off the first invoice only. */
const COMEBACK_DURATION = 'once';
const DAY_MS = 24 * 60 * 60 * 1000;

/** D11: each mail has a two-week window, so a missed day catches up; past it, that stage is never sent. */
export const COMEBACK_STAGES = [
  { stage: 'day-30', fromDays: 30, toDays: 44 },
  { stage: 'day-90', fromDays: 90, toDays: 104 },
] as const;
export type ComebackStage = (typeof COMEBACK_STAGES)[number]['stage'];
/** D13: the offer opens 30 days after the lapse, so cancelling and rejoining can't take it. */
export const COMEBACK_AFTER_DAYS = COMEBACK_STAGES[0].fromDays;
/** D13: nobody who took the stay offer in this many months. */
export const STAY_OFFER_BLOCKS_MONTHS = 12;
/** A subscription that never took money and never will: it doesn't use the offer up, and isn't a lapse. */
const NEVER_PAID_STATUSES: ReadonlySet<string> = new Set(['incomplete', 'incomplete_expired']);
/** A subscription that has ended; anything else is running (and Checkout refuses a second one). */
const ENDED_STATUSES: ReadonlySet<string> = new Set(['canceled', 'incomplete_expired']);

type PerCurrency = Record<BillingCurrency, number | null>;

export interface ComebackOffer {
  id: string;
  couponId: string;
  /** Minor units per currency, Stripe's arithmetic (the list price less the amount off); null where it isn't sold. */
  firstMonth: PerCurrency;
  listMonth: PerCurrency;
  firstYear: PerCurrency;
  listYear: PerCurrency;
}

/** D8: valid, `once`, an amount off below the monthly price in each currency it names, Freelancer only. */
export function comebackOfferOf(entry: ComebackOfferEntry, coupon: CouponFact | null, catalog: Catalog): ComebackOffer | null {
  if (!coupon || !coupon.valid || coupon.duration !== COMEBACK_DURATION || coupon.percentOff !== null) return null;
  const products = coupon.appliesToProducts;
  const freelancer = productIdsOf(catalog);
  if (!products || products.length === 0 || !products.every((p) => freelancer.has(p))) return null;
  const currencies = (Object.keys(catalog) as BillingCurrency[]).filter((c) => catalog[c] && coupon.amountOffIn[c] !== null);
  if (currencies.length === 0) return null;
  // An amount that would make the first month free or negative isn't the offer D8 shapes.
  if (currencies.some((c) => coupon.amountOffIn[c]! <= 0 || coupon.amountOffIn[c]! >= catalog[c]!.month.unitAmount)) return null;
  const per = (pick: (c: BillingCurrency) => number): PerCurrency => ({ ILS: currencies.includes('ILS') ? pick('ILS') : null, USD: currencies.includes('USD') ? pick('USD') : null });
  return {
    id: entry.id,
    couponId: entry.couponId,
    firstMonth: per((c) => catalog[c]!.month.unitAmount - coupon.amountOffIn[c]!),
    listMonth: per((c) => catalog[c]!.month.unitAmount),
    firstYear: per((c) => catalog[c]!.year.unitAmount - coupon.amountOffIn[c]!),
    listYear: per((c) => catalog[c]!.year.unitAmount),
  };
}

/** D11: the stage a lapse that ended at `endedAt` is in at `now`, or null between and after the windows. */
export function comebackStageOf(endedAt: Date, now: Date): ComebackStage | null {
  const days = (now.getTime() - endedAt.getTime()) / DAY_MS;
  return COMEBACK_STAGES.find((s) => days >= s.fromDays && days < s.toDays)?.stage ?? null;
}

/** What the rule reads: the person's mirrored subscriptions and retention events, and their coverage. */
export interface ComebackFacts {
  subscriptions: readonly { status: string; tier: BillingTierRecord; endedAt: Date | null; offerId: string | null }[];
  events: readonly Pick<BillingRetentionEventRecord, 'kind' | 'createdAt' | 'reason'>[];
  /** One of their profiles is covered by Malafat or an operator grant. */
  covered: boolean;
  /** The come-back entries' ids (offers.json), as subscriptions carry them in `mutaba3a_offer`. */
  comebackOfferIds: ReadonlySet<string>;
}

export type ComebackRefusal = 'PAYING' | 'NO_LAPSE' | 'TOO_SOON' | 'FIRM' | 'ALREADY_HAD' | 'STAY_OFFER_RECENT' | 'COVERED' | 'NOT_OFFERED';

/**
 * D12, D13: the first refusal that applies. The job (`requireOffered: false`) also checks with Stripe that the lapsed
 * plan took money, then records the stage it mails; GET /v1/billing and Checkout (`requireOffered: true`) need that
 * record, which is what opens the offer.
 */
export function comebackRefusalOf(facts: ComebackFacts, now: Date, options: { requireOffered: boolean }): ComebackRefusal | null {
  const { subscriptions, events } = facts;
  if (subscriptions.some((s) => !ENDED_STATUSES.has(s.status))) return 'PAYING';
  const lapses = subscriptions.filter((s) => s.status === 'canceled' && s.endedAt !== null).sort((a, b) => b.endedAt!.getTime() - a.endedAt!.getTime());
  const latest = lapses[0];
  if (!latest) return 'NO_LAPSE';
  if (latest.tier === 'FIRM') return 'FIRM';
  if (now.getTime() - latest.endedAt!.getTime() < COMEBACK_AFTER_DAYS * DAY_MS) return 'TOO_SOON';
  if (subscriptions.some((s) => s.offerId !== null && facts.comebackOfferIds.has(s.offerId) && !NEVER_PAID_STATUSES.has(s.status))) return 'ALREADY_HAD';
  const staySince = new Date(now);
  staySince.setUTCMonth(staySince.getUTCMonth() - STAY_OFFER_BLOCKS_MONTHS);
  if (events.some((e) => e.kind === 'STAY_OFFER' && e.createdAt > staySince)) return 'STAY_OFFER_RECENT';
  if (facts.covered) return 'COVERED';
  if (options.requireOffered && !events.some((e) => e.kind === 'COMEBACK_OFFERED')) return 'NOT_OFFERED';
  return null;
}
