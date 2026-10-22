import type { BillingEntitlement, BillingOverview } from '../api/client';

/**
 * MUT-362 (plan §2.7, design review DR1–DR12): what the Billing drawer shows. One panel (status chip + headline, DR1),
 * its one action, whether Subscribe is "open soon" (DR4/DR5), and the Subscribe step's small rules. Pure, so every
 * branch is a unit test; the drawer only renders.
 */

export type BillingAction = 'subscribe' | 'manage' | 'payInPortal' | 'contactUs';

export type BillingPanel =
  | { kind: 'active'; renewsAt: string; interval: 'month' | 'year' | null }
  | { kind: 'ending'; endsAt: string }
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
  owned: boolean;
  billing: BillingEntitlement | null | undefined;
}

export type CheckoutRoute = 'card' | 'card-tax-id' | 'card-tax-number' | 'contact-us';
export type YearlySaving = { kind: 'monthsFree'; months: number } | { kind: 'save'; amount: number };
type Subscription = NonNullable<BillingOverview['subscription']>;

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS_A_YEAR = 12;

export function billingViewOf(billing: BillingOverview, profiles: readonly BillingProfile[], now: Date): BillingView {
  const fromSubscription = billing.subscription ? subscriptionPanel(billing.subscription) : null;
  const { panel, action } = fromSubscription ?? profilePanel(profiles, billing, now);
  const sellable = billing.configured && (billing.catalog.ILS !== null || billing.catalog.USD !== null);
  return { panel, action, openSoon: action === 'subscribe' && !sellable };
}

/** The subscription decides while it exists; a cancelled or abandoned one hands over to the profiles. */
function subscriptionPanel(sub: Subscription): { panel: BillingPanel; action: BillingAction | null } | null {
  switch (sub.status) {
    case 'active':
    case 'trialing':
    case 'incomplete':
      return sub.cancelAtPeriodEnd
        ? { panel: { kind: 'ending', endsAt: sub.currentPeriodEnd }, action: 'manage' }
        : { panel: { kind: 'active', renewsAt: sub.currentPeriodEnd, interval: sub.interval }, action: 'manage' };
    case 'past_due':
      return { panel: { kind: 'grace' }, action: 'manage' };
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
      return { panel: { kind: e.state === 'READ_ONLY' ? 'lapsed' : 'none' }, action: 'subscribe' };
    default:
      return { panel: { kind: 'none' }, action: 'subscribe' };
  }
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
  const consumer = countries.consumer.includes(country);
  if (buyer === 'person') return consumer ? 'card' : 'contact-us';
  if (countries.customTaxId.includes(country)) return 'card-tax-number';
  return consumer ? 'card' : 'card-tax-id';
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
