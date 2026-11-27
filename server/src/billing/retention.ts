import type { BillingCurrency, BillingInterval, Catalog, CatalogPrice } from './checkout.js';
import { couponCovers, firstYearOf, productIdsOf, type CouponFact, type OfferPlan } from './offer.js';

/**
 * MUT-531 (plan D2–D4, D13, ADR-238): moving a monthly payer to the yearly price. Pure: the route reads the mirror,
 * the catalog and Stripe's own facts about the subscription; this decides. Nothing here is an amount: the saving is
 * the catalog's twelve months less its year (ADR-004, ADR-170).
 */

/** D2: the switch opens from the 2nd invoice that took money (a ₪0 trial invoice doesn't count). */
export const SWITCH_AFTER_PAID_INVOICES = 2;

/** What the mirror knows of the subscription Billing shows. */
export interface SwitchSubscription {
  status: string;
  priceLookupKey: string | null;
  cancelAtPeriodEnd: boolean;
}

/** What only Stripe knows: paid invoices with money in them, a running discount, a pause. */
export interface PlanFacts {
  paidInvoices: number;
  discounted: boolean;
  paused: boolean;
  /** MUT-703: a MUT-734 plan change waits on a Stripe schedule; a direct update would fight its phases. */
  scheduled?: boolean;
}

export type SwitchRefusal = 'NOT_MONTHLY_LIST' | 'NOT_ACTIVE' | 'CANCELLING' | 'PAUSED' | 'SCHEDULED' | 'DISCOUNTED' | 'TOO_EARLY' | 'NO_PRICE';

export type YearlySwitch =
  | { ok: true; plan: OfferPlan; currency: BillingCurrency; yearly: CatalogPrice; savings: number | null }
  | { ok: false; refusal: SwitchRefusal };

/** MUT-703 (§3.3): a list price of a plan (Solo, Business, Firm or the legacy Freelancer), as its lookup key names it. */
export interface ListPrice {
  plan: OfferPlan;
  interval: BillingInterval;
  currency: BillingCurrency;
}

const LIST_KEY = /^(freelancer|solo|business|firm)_list_(monthly|yearly)_(ils|usd)$/;

/**
 * MUT-703 (§3.3): the plan, interval and currency of a list price; null for a founder or Accountant price and anything
 * else (D5: founders never switch, pause or take the stay offer).
 */
export function listPriceOf(priceLookupKey: string | null): ListPrice | null {
  const match = priceLookupKey === null ? null : LIST_KEY.exec(priceLookupKey);
  if (!match) return null;
  return { plan: match[1] as OfferPlan, interval: match[2] === 'monthly' ? 'month' : 'year', currency: match[3]!.toUpperCase() as BillingCurrency };
}

/** The currency of a monthly list price, any plan's; null for a yearly, founder or unknown price. */
export function listMonthlyCurrencyOf(priceLookupKey: string | null): BillingCurrency | null {
  const list = listPriceOf(priceLookupKey);
  return list?.interval === 'month' ? list.currency : null;
}

/** D3: twelve months less the year, in that currency's minor units; null when the year saves nothing or isn't sold. */
export function yearlySavingsOf(catalog: Catalog, currency: BillingCurrency): number | null {
  const pair = catalog[currency];
  if (!pair) return null;
  const savings = 12 * pair.month.unitAmount - pair.year.unitAmount;
  return savings > 0 ? savings : null;
}

/**
 * D2, D4, D13: the first refusal that applies, else the yearly price of the subscription's own currency. MUT-703:
 * `catalog` is the subscription's own plan's (billing/yearly-switch-line.ts `catalogOfKey`).
 */
export function yearlySwitchOf(subscription: SwitchSubscription, facts: PlanFacts, catalog: Catalog): YearlySwitch {
  const list = listPriceOf(subscription.priceLookupKey);
  if (!list || list.interval !== 'month') return { ok: false, refusal: 'NOT_MONTHLY_LIST' };
  const { plan, currency } = list;
  if (subscription.status !== 'active') return { ok: false, refusal: 'NOT_ACTIVE' };
  if (subscription.cancelAtPeriodEnd) return { ok: false, refusal: 'CANCELLING' };
  if (facts.paused) return { ok: false, refusal: 'PAUSED' };
  if (facts.scheduled) return { ok: false, refusal: 'SCHEDULED' };
  if (facts.discounted) return { ok: false, refusal: 'DISCOUNTED' };
  if (facts.paidInvoices < SWITCH_AFTER_PAID_INVOICES) return { ok: false, refusal: 'TOO_EARLY' };
  const yearly = catalog[currency]?.year;
  if (!yearly) return { ok: false, refusal: 'NO_PRICE' };
  return { ok: true, plan, currency, yearly, savings: yearlySavingsOf(catalog, currency) };
}

/*
 * MUT-532 (plan D6, D7, D10, D11, ADR-240): pause instead of cancel, and the stay offer. Pure, like the switch: the
 * routes read Stripe's live subscription, the person's retention events and the coupon; these decide. Whether a pause
 * is running is the mirror's alone (R5); the events only answer "once a year" and "once ever".
 */

/** D6: how long a pause may be. */
export const PAUSE_MONTH_CHOICES = [1, 2, 3] as const;
export type PauseMonths = (typeof PAUSE_MONTH_CHOICES)[number];
/** D10: a trialist has nothing to pause; one invoice that took money is enough. */
export const PAUSE_AFTER_PAID_INVOICES = 1;
/** D10: one pause in this many months, counted from when the last one started. */
export const PAUSE_ONCE_IN_MONTHS = 12;
/** D6: Stripe resumes this long before the boundary, so the boundary's own invoice is collected (spike a). */
export const PAUSE_RESUME_LEAD_MS = 60 * 60 * 1000;
/** Stripe's `cancellation_details.feedback` values, the reasons the Why? step offers (D8). */
export const CANCELLATION_REASONS = ['too_expensive', 'unused', 'missing_features', 'switched_service', 'too_complex', 'low_quality', 'customer_service', 'other'] as const;
export type CancellationReason = (typeof CANCELLATION_REASONS)[number];
/** Stripe's own limit on `cancellation_details.comment`. */
export const CANCELLATION_COMMENT_MAX = 500;

export type RetentionKind = 'PAUSE' | 'STAY_OFFER' | 'CANCEL' | 'YEARLY_SWITCH' | 'COMEBACK_OFFERED';

/** The subscription Billing shows, as Stripe holds it now. */
export interface RetentionSubject extends SwitchSubscription {
  /** A pause set on it, scheduled or running. */
  paused: boolean;
  discounted: boolean;
  currentPeriodEnd: Date | null;
  billingCycleAnchor: Date | null;
  /** MUT-703: a MUT-734 downgrade waits on a Stripe schedule (absent: none). */
  scheduled?: boolean;
}

/** What the once-rules read of a person's retention events. */
export interface RetentionEventFact {
  kind: RetentionKind;
  startsAt: Date | null;
  endedEarlyAt: Date | null;
}

export interface PauseOption {
  months: PauseMonths;
  /** The paid period's end: nothing changes before it. */
  from: Date;
  /** The cycle boundary billing restarts on, shown as the restart date. */
  until: Date;
  /** Stripe's `pause_collection.resumes_at`: `until` less the lead. */
  resumesAt: Date;
}

export type PauseRefusal = 'NOT_MONTHLY_LIST' | 'NOT_ACTIVE' | 'CANCELLING' | 'PAUSED' | 'SCHEDULED' | 'TOO_EARLY' | 'ONCE_A_YEAR' | 'NO_PERIOD';
export type StayRefusal = 'NOT_MONTHLY_LIST' | 'NOT_ACTIVE' | 'CANCELLING' | 'PAUSED' | 'SCHEDULED' | 'DISCOUNTED' | 'ALREADY_HAD' | 'NO_COUPON' | 'NO_PRICE';

export interface StayOffer {
  couponId: string;
  percentOff: number;
  months: number;
  currency: BillingCurrency;
  /** What each discounted month costs, Stripe's rounding (ADR-004: minor units, with its currency). */
  monthlyAmount: number;
  listAmount: number;
}

/**
 * Stripe's monthly cycle: the anchor's day of the month, clamped to that month's last day, at the anchor's time. The
 * boundary `months` after the first one at or after `from` (Jan 31 → Feb 28 → Mar 31).
 */
export function cycleBoundaryAfter(anchor: Date, from: Date, months: number): Date {
  let k = 0;
  while (boundaryOf(anchor, k) < from) k += 1;
  return boundaryOf(anchor, k + months);
}

function boundaryOf(anchor: Date, monthsOn: number): Date {
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth() + monthsOn;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(anchor.getUTCDate(), lastDay), anchor.getUTCHours(), anchor.getUTCMinutes(), anchor.getUTCSeconds(), anchor.getUTCMilliseconds()));
}

/** When the once-a-year pause counts from: this many calendar months back. */
export function pauseCountsSince(now: Date): Date {
  const since = new Date(now);
  since.setUTCMonth(since.getUTCMonth() - PAUSE_ONCE_IN_MONTHS);
  return since;
}

/** D7: a pause undone before it started never took effect, so it doesn't use the year's pause up. */
export function pauseCounts(event: RetentionEventFact, since: Date): boolean {
  if (event.kind !== 'PAUSE' || event.startsAt === null || event.startsAt <= since) return false;
  return event.endedEarlyAt === null || event.endedEarlyAt > event.startsAt;
}

/** D10: the first refusal that applies, else the three pauses Stripe would make, from the paid period's end. */
export function pauseOptionsOf(subject: RetentionSubject, paidInvoices: number, events: readonly RetentionEventFact[], now: Date): { ok: true; options: PauseOption[] } | { ok: false; refusal: PauseRefusal } {
  const refusal = planRefusal(subject);
  if (refusal) return { ok: false, refusal };
  if (paidInvoices < PAUSE_AFTER_PAID_INVOICES) return { ok: false, refusal: 'TOO_EARLY' };
  const since = pauseCountsSince(now);
  if (events.some((event) => pauseCounts(event, since))) return { ok: false, refusal: 'ONCE_A_YEAR' };
  const { currentPeriodEnd: from, billingCycleAnchor: anchor } = subject;
  if (!from || !anchor) return { ok: false, refusal: 'NO_PERIOD' };
  const options = PAUSE_MONTH_CHOICES.map((months) => {
    const until = cycleBoundaryAfter(anchor, from, months);
    return { months, from, until, resumesAt: new Date(until.getTime() - PAUSE_RESUME_LEAD_MS) };
  });
  return { ok: true, options };
}

/**
 * D11: the first refusal that applies, else the offer the coupon makes on this subscription's own monthly price.
 * MUT-703: `catalog` is the subscription's own plan's; `entryProducts` the stay entry's plans' products (absent: the
 * catalog's own, the legacy Freelancer rule).
 */
export function stayOfferOf(
  subject: RetentionSubject,
  events: readonly RetentionEventFact[],
  coupon: CouponFact | null,
  catalog: Catalog,
  entryProducts: ReadonlySet<string> = productIdsOf(catalog),
): { ok: true; offer: StayOffer } | { ok: false; refusal: StayRefusal } {
  const refusal = planRefusal(subject);
  if (refusal) return { ok: false, refusal };
  if (subject.discounted) return { ok: false, refusal: 'DISCOUNTED' };
  if (events.some((event) => event.kind === 'STAY_OFFER')) return { ok: false, refusal: 'ALREADY_HAD' };
  const currency = listMonthlyCurrencyOf(subject.priceLookupKey)!;
  const month = catalog[currency]?.month;
  if (!month) return { ok: false, refusal: 'NO_PRICE' };
  if (!isStayCoupon(coupon, entryProducts, productIdsOf(catalog))) return { ok: false, refusal: 'NO_COUPON' };
  const percentOff = coupon.percentOff!;
  return {
    ok: true,
    offer: { couponId: coupon.id, percentOff, months: coupon.durationInMonths!, currency, monthlyAmount: firstYearOf(month.unitAmount, percentOff), listAmount: month.unitAmount },
  };
}

/**
 * D11: valid, a percentage, `repeating` for some months, restricted to the entry's products and (MUT-703) covering the
 * plan held.
 */
function isStayCoupon(coupon: CouponFact | null, entryProducts: ReadonlySet<string>, held: ReadonlySet<string>): coupon is CouponFact {
  if (!coupon || !coupon.valid || coupon.duration !== 'repeating') return false;
  if (coupon.durationInMonths === null || coupon.durationInMonths < 1) return false;
  if (coupon.percentOff === null || !(coupon.percentOff > 0 && coupon.percentOff <= 100)) return false;
  return couponCovers(coupon, entryProducts, held);
}

/**
 * What both retention steps need first: a monthly list plan (any plan's, MUT-703) that is active, not cancelling, not
 * paused and not waiting on a scheduled plan change.
 */
function planRefusal(subject: RetentionSubject): 'NOT_MONTHLY_LIST' | 'NOT_ACTIVE' | 'CANCELLING' | 'PAUSED' | 'SCHEDULED' | null {
  if (!listMonthlyCurrencyOf(subject.priceLookupKey)) return 'NOT_MONTHLY_LIST';
  if (subject.status !== 'active') return 'NOT_ACTIVE';
  if (subject.cancelAtPeriodEnd) return 'CANCELLING';
  if (subject.paused) return 'PAUSED';
  if (subject.scheduled) return 'SCHEDULED';
  return null;
}
