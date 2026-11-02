import type { BillingEntitlement, BillingOffer, BillingOverview, BillingYearlySwitch } from '../api/client';
import type { Language } from '../../lib/i18n/types';
import { formatInstant, todayInZone } from '../format/dates';

/**
 * MUT-362 (plan §2.7, design review DR1–DR12): what the Billing drawer shows. One panel (status chip + headline, DR1),
 * its one action, whether Subscribe is "open soon" (DR4/DR5), and the Subscribe step's small rules. Pure, so every
 * branch is a unit test; the drawer only renders.
 */

/** MUT-533 (D5): `updateCard` is a past-due plan's way to Stripe's card form, the link the failed-card mail leads to. */
export type BillingAction = 'subscribe' | 'manage' | 'updateCard' | 'payInPortal' | 'contactUs';

export type BillingPanel =
  | { kind: 'active'; renewsAt: string; interval: 'month' | 'year' | null }
  /** MUT-418: a card added during the free trial: Stripe's `trialing`, first charged on the trial's end. */
  | { kind: 'activeTrial'; firstChargeAt: string }
  | { kind: 'pending' }
  | { kind: 'ending'; endsAt: string }
  /** MUT-532: a pause booked from the paid period's end; billing restarts on its own on `until` (null: no end set). */
  | { kind: 'pauseScheduled'; from: string; until: string | null }
  /** MUT-532: the pause runs: the records are read-only, never locked, until `until`. */
  | { kind: 'paused'; until: string | null }
  | { kind: 'grace' }
  | { kind: 'unpaid' }
  | { kind: 'needsHelp' }
  | { kind: 'lapsed' }
  | { kind: 'trial'; endsAt: string; daysLeft: number }
  | { kind: 'trialEnded'; lockAt: string | null }
  | { kind: 'locked' }
  | { kind: 'coveredByGrant'; until: string | null }
  | { kind: 'coveredByMalafat' }
  | { kind: 'ownedByOthers' }
  | { kind: 'none' };

export interface BillingView {
  panel: BillingPanel;
  action: BillingAction | null;
  /** Subscribe can't open yet: no Stripe on this server, or no complete price pair (design review DR4/DR5). */
  openSoon: boolean;
}

/** What the drawer needs of each /v1/me profile. */
export interface BillingProfile {
  id: string;
  name: string;
  /** A payment of this person's would cover it: GET /v1/billing `coveredProfileIds` (review D4), not /v1/me `owned`. */
  owned: boolean;
  billing: BillingEntitlement | null | undefined;
}

export type CheckoutRoute = 'card' | 'card-tax-id' | 'card-tax-number' | 'contact-us';
export type YearlySaving = { kind: 'monthsFree'; months: number } | { kind: 'save'; amount: number };
type Subscription = NonNullable<BillingOverview['subscription']>;

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS_A_YEAR = 12;
/** Stripe's minimum for a carried-over trial (server/src/billing/checkout.ts TRIAL_CARRY_MIN_MS): sooner is charged at once. */
const TRIAL_CARRY_MIN_MS = 48 * 60 * 60 * 1000;
/** Paid statuses: the return-from-Checkout poll ends on one. `incomplete` is still waiting on the first payment. */
const CONFIRMED_STATUSES: ReadonlySet<string> = new Set(['active', 'trialing', 'past_due']);

export function isConfirmed(subscription: BillingOverview['subscription']): boolean {
  return subscription !== null && CONFIRMED_STATUSES.has(subscription.status);
}

/** Review D2: subscribing during the trial keeps the rest of it, so the first charge falls on its end (the server's rule). */
export function firstChargeOf(billing: BillingOverview, now: Date): string | null {
  const endsAt = billing.trial?.endsAt;
  if (!endsAt || new Date(endsAt).getTime() - now.getTime() < TRIAL_CARRY_MIN_MS) return null;
  return endsAt;
}

/** Subscribe can open: Stripe is configured on this server and at least one currency has its price pair (DR4/DR5). */
export function isSellable(billing: Pick<BillingOverview, 'configured' | 'catalog'>): boolean {
  return billing.configured && (billing.catalog.ILS !== null || billing.catalog.USD !== null);
}

export function billingViewOf(billing: BillingOverview, profiles: readonly BillingProfile[], now: Date): BillingView {
  const fromSubscription = billing.subscription ? subscriptionPanel(billing.subscription, now) : null;
  const { panel, action } = fromSubscription ?? profilePanel(profiles, billing, now);
  return { panel, action, openSoon: action === 'subscribe' && !isSellable(billing) };
}

/** The subscription decides while it exists; a cancelled or abandoned one hands over to the profiles. */
function subscriptionPanel(sub: Subscription, now: Date): { panel: BillingPanel; action: BillingAction | null } | null {
  switch (sub.status) {
    case 'incomplete':
      return { panel: { kind: 'pending' }, action: 'manage' };
    case 'active':
    case 'trialing': {
      if (sub.cancelAtPeriodEnd) return { panel: { kind: 'ending', endsAt: sub.currentPeriodEnd }, action: 'manage' };
      // MUT-532: Stripe keeps a paused plan `active`; the mirror's pause says which side of its start we are on.
      const pause = pauseOf(sub);
      if (pause && now < new Date(pause.from)) return { panel: { kind: 'pauseScheduled', from: pause.from, until: pause.until }, action: 'manage' };
      if (pause && (pause.until === null || now < new Date(pause.until))) return { panel: { kind: 'paused', until: pause.until }, action: 'manage' };
      // MUT-418: a card added in the trial keeps the rest of it; Stripe's first charge is the trial's end (the period end).
      if (sub.status === 'trialing') return { panel: { kind: 'activeTrial', firstChargeAt: sub.currentPeriodEnd }, action: 'manage' };
      return { panel: { kind: 'active', renewsAt: sub.currentPeriodEnd, interval: sub.interval }, action: 'manage' };
    }
    case 'past_due':
      return { panel: { kind: 'grace' }, action: 'updateCard' };
    case 'unpaid':
      return { panel: { kind: 'unpaid' }, action: 'payInPortal' };
    case 'paused':
      return { panel: { kind: 'needsHelp' }, action: 'contactUs' };
    default:
      return null;
  }
}

function profilePanel(profiles: readonly BillingProfile[], billing: BillingOverview, now: Date): { panel: BillingPanel; action: BillingAction | null } {
  const owned = profiles.filter((p) => p.owned && p.billing).map((p) => p.billing!);
  if (owned.length === 0) return { panel: { kind: 'ownedByOthers' }, action: null };
  const paying = owned.filter((e) => e.source !== 'MALAFAT');
  if (paying.length === 0) return { panel: { kind: 'coveredByMalafat' }, action: null };
  // Eng review D5: a grant with no end means the operator decides when this person starts paying.
  if (paying.every((e) => e.source === 'OPERATOR' && e.until === null)) return { panel: { kind: 'coveredByGrant', until: null }, action: null };
  const e = paying.find((x) => x.source === 'OPERATOR') ?? paying.find((x) => x.source === 'TRIAL') ?? paying[0]!;
  switch (e.source) {
    case 'OPERATOR':
      return { panel: { kind: 'coveredByGrant', until: e.until }, action: 'subscribe' };
    case 'TRIAL': {
      if (e.state === 'LOCKED') return { panel: { kind: 'locked' }, action: 'subscribe' };
      if (e.state === 'READ_ONLY') return { panel: { kind: 'trialEnded', lockAt: e.until }, action: 'subscribe' };
      const endsAt = billing.trial?.endsAt ?? e.until ?? now.toISOString();
      return { panel: { kind: 'trial', endsAt, daysLeft: daysLeft(endsAt, now) }, action: 'subscribe' };
    }
    case 'STRIPE':
      // Paid but no subscription row to show (review): still the Customer Portal, never a second Subscribe.
      if (e.state === 'ACTIVE') return { panel: { kind: 'active', renewsAt: e.until ?? now.toISOString(), interval: null }, action: 'manage' };
      if (e.state === 'GRACE') return { panel: { kind: 'grace' }, action: 'updateCard' };
      return { panel: { kind: e.state === 'READ_ONLY' ? 'lapsed' : 'none' }, action: 'subscribe' };
    default:
      return { panel: { kind: 'none' }, action: 'subscribe' };
  }
}

/** MUT-532: the subscription's pause; a server older than MUT-532 sends none. */
export function pauseOf(sub: Pick<Subscription, 'pause'>): { from: string; until: string | null } | null {
  return sub.pause ?? null;
}

/**
 * MUT-532 (D8): Cancel plan opens MTB3A's own flow on a plan that renews at a list price and isn't pausing. A founder
 * price runs on a subscription schedule, which Stripe won't cancel this way (the server refuses it too).
 */
export function canCancelOf(billing: Pick<BillingOverview, 'subscription'>): boolean {
  const sub = billing.subscription;
  return sub !== null && (sub.status === 'active' || sub.status === 'trialing') && !sub.cancelAtPeriodEnd && pauseOf(sub) === null && sub.renewsAtListPrice;
}

/** MUT-532 (D8): Keep my plan undoes a cancel at the period end, ours or the Customer Portal's. */
export function canKeepOf(billing: Pick<BillingOverview, 'subscription'>): boolean {
  const sub = billing.subscription;
  return sub !== null && (sub.status === 'active' || sub.status === 'trialing') && sub.cancelAtPeriodEnd && sub.renewsAtListPrice;
}

/** MUT-532 (D7): what Resume now charges today: a month at the catalog's price in the plan's currency. */
export function monthPriceOf(billing: Pick<BillingOverview, 'subscription' | 'catalog'>): { minor: number; currency: 'ILS' | 'USD' } | null {
  const currency = billing.subscription?.currency;
  if (currency !== 'ILS' && currency !== 'USD') return null;
  const pair = billing.catalog[currency];
  return pair ? { minor: pair.month, currency } : null;
}

/** DR3: the per-profile list earns its place only when the profiles' billing differs. */
export function profilesListOf(profiles: readonly BillingProfile[]): BillingProfile[] {
  const withBilling = profiles.filter((p) => p.billing);
  const keys = new Set(withBilling.map((p) => `${p.billing!.state}|${p.billing!.source}`));
  return keys.size > 1 ? withBilling : [];
}

/** Whole days until `iso`, rounded up (a trial ending in two hours has one day left), never negative. */
export function daysLeft(iso: string, now: Date): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now.getTime()) / DAY_MS));
}

/** Plan §2.3, mirrored for the step's wording: the server is still the one that decides. */
export function checkoutRouteOf(country: string | null, buyer: 'person' | 'business', countries: BillingOverview['countries']): CheckoutRoute | null {
  if (!country) return null;
  // MUT-418 (D11): `consumerEverywhere` is billing-countries.json's "*"; an older server sends no field.
  const consumer = countries.consumerEverywhere === true || countries.consumer.includes(country);
  if (buyer === 'person') return consumer ? 'card' : 'contact-us';
  // MUT-418 D10: a business proves it is one in every country (the server's rule).
  return countries.customTaxId.includes(country) ? 'card-tax-number' : 'card-tax-id';
}

export function currencyOfCountry(country: string): 'ILS' | 'USD' {
  return country === 'IL' ? 'ILS' : 'USD';
}

/** DR7: the Yearly note from the two real prices; null when a year saves nothing. */
export function yearlySavingOf(pair: { month: number; year: number }): YearlySaving | null {
  const saved = pair.month * MONTHS_A_YEAR - pair.year;
  if (saved <= 0) return null;
  return saved % pair.month === 0 ? { kind: 'monthsFree', months: saved / pair.month } : { kind: 'save', amount: saved };
}

/**
 * MUT-525 (R5, DD10a): the launch offer as the Subscribe step shows it in one currency. Every amount is the server's
 * (the list price from the catalog, the first year from `offer.firstYear`): the portal never computes the discount.
 */
export interface OfferView {
  id: string;
  percentOff: number;
  /** The list yearly price, minor units. */
  list: number;
  /** The first year's price, minor units. */
  firstYear: number;
  endsAt: string;
  /** When the list price is first charged: a year after the first charge (the server's `renewsOnOf`). */
  renewsOn: string;
  /** The carried trial's end, when the first charge waits for it; null when it is taken at Checkout. */
  firstChargeAt: string | null;
  /** DD10d: today is the offer's last calendar day in Jerusalem. */
  endsToday: boolean;
}

/** The offer's days are Jerusalem calendar days (DD7, DD10d): its end, as the coupon's runbook sets it, and the pay page's dates. */
export const OFFER_TIME_ZONE = 'Asia/Jerusalem';

/** This person's offer, before a currency is chosen: eligible, yearly, and takeable in at least one sold currency. */
/**
 * MUT-531 (AC2): the "switch to yearly" line, shown only on an active monthly plan the server says may switch. The
 * generated type is `BillingYearlySwitch | unknown` (a nullable union); a server older than MUT-531 sends nothing.
 */
export function yearlySwitchLineOf(billing: Pick<BillingOverview, 'yearlySwitch' | 'subscription'>): BillingYearlySwitch | null {
  const line = (billing.yearlySwitch ?? null) as BillingYearlySwitch | null;
  const sub = billing.subscription;
  if (!line || !sub || sub.status !== 'active' || sub.cancelAtPeriodEnd || sub.interval !== 'month' || pauseOf(sub) !== null) return null;
  return line;
}

export function eligibleOfferOf(billing: Pick<BillingOverview, 'offer' | 'catalog'>): BillingOffer | null {
  // The generated type is `BillingOffer | unknown` (a nullable union); a server older than MUT-525 sends nothing.
  const offer = (billing.offer ?? null) as BillingOffer | null;
  if (!offer?.eligible || offer.interval !== 'year') return null;
  const takeable = (['ILS', 'USD'] as const).some((c) => offer.firstYear[c] !== null && billing.catalog[c] !== null);
  return takeable ? offer : null;
}

/** The offer in `currency`, or null: not eligible, not yearly, no currency yet, or no first-year amount in it. */
export function offerFor(billing: BillingOverview, currency: 'ILS' | 'USD' | null, now: Date): OfferView | null {
  const offer = eligibleOfferOf(billing);
  if (!offer || !currency) return null;
  const list = billing.catalog[currency]?.year;
  const firstYear = offer.firstYear[currency];
  if (list === undefined || firstYear === null) return null;
  const firstChargeAt = firstChargeOf(billing, now);
  return {
    id: offer.id,
    percentOff: offer.percentOff,
    list,
    firstYear,
    endsAt: offer.endsAt,
    renewsOn: aYearAfter(firstChargeAt ?? now.toISOString()),
    firstChargeAt,
    endsToday: offerEndsToday(offer.endsAt, now),
  };
}

/** DD10d: the offer's end falls on today's Jerusalem calendar day. */
export function offerEndsToday(endsAt: string, now: Date): boolean {
  return todayInZone(OFFER_TIME_ZONE, now) === todayInZone(OFFER_TIME_ZONE, new Date(endsAt));
}

/** An offer date (its end, a first charge, a renewal) as a Jerusalem calendar day, the pay page's and the mails' rule. */
export function offerDay(iso: string, language: Language): string {
  return formatInstant(iso, language, OFFER_TIME_ZONE);
}

/** D10: the analytics contract's enum value for an offer id (snake_case: `launch-2026` → `launch_2026`). */
export function offerAnalyticsName(id: string): string {
  return id.replace(/-/g, '_');
}

/** DD3: what a list-price subscription renews at (the catalog's price for its interval and currency); null keeps today's copy. */
export function renewalPriceOf(billing: BillingOverview): { minor: number; currency: 'ILS' | 'USD' } | null {
  const sub = billing.subscription;
  if (!sub?.renewsAtListPrice || sub.cancelAtPeriodEnd || !sub.interval) return null;
  if (sub.currency !== 'ILS' && sub.currency !== 'USD') return null;
  const pair = billing.catalog[sub.currency];
  return pair ? { minor: pair[sub.interval], currency: sub.currency } : null;
}

/** The server's `renewsOnOf`: the same instant a calendar year later (UTC). */
function aYearAfter(iso: string): string {
  const at = new Date(iso);
  at.setUTCFullYear(at.getUTCFullYear() + 1);
  return at.toISOString();
}
