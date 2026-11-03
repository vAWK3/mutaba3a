import type Stripe from 'stripe';
import type { BillingTier } from '../entitlement.js';

/**
 * MUT-360 (§2.2, ADR-165): one Stripe subscription → the fields `billing_subscriptions` mirrors. Pure; the sync
 * service does the I/O. Nothing is guessed: a subscription whose tier can't be read is not written at all, and the
 * reason is recorded for the operator.
 */

/** The subscription can't be mirrored; the sync records the code and writes nothing. */
export type MirrorError = 'UNKNOWN_TIER' | 'UNSUPPORTED_CURRENCY' | 'NO_PERIOD';
/** Mirrored, with something the operator should look at. */
export type MirrorNote = 'FIRM_WITHOUT_ORG' | 'UNKNOWN_ORG' | 'PAUSE_NOT_OURS';

export interface MirrorFields {
  tier: BillingTier;
  organizationId: string | null;
  status: string;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  priceLookupKey: string | null;
  /** D4: MUT-363 reads the subscription schedule and fills it. */
  founderUntil: null;
  /** MUT-525: the offer the Checkout carried (`metadata.mutaba3a_offer`); anything not shaped like an offer id is null. */
  offerId: string | null;
  /** MUT-532: when a pause takes effect (`pauseOf`); null with no pause set. */
  pausedFrom: Date | null;
  /** MUT-532: when Stripe resumes collecting; null with no pause set, or a pause with no end. */
  pauseResumesAt: Date | null;
  /**
   * MUT-534 (D10): when Stripe ended it (`ended_at`); null while it runs. After failed retries this is weeks before the
   * period end, so a lapse is timed from here, never from `currentPeriodEnd`.
   */
  endedAt: Date | null;
  /** The account's currency (billing_accounts.currency): ILS for Israel, USD elsewhere. */
  currency: 'ILS' | 'USD';
}

const TIERS: Record<string, BillingTier> = { freelancer: 'FREELANCER', firm: 'FIRM' };
const LOOKUP_KEY_MAX = 100;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** offers.json's id rule, and billing_subscriptions.offerId's VarChar(40). */
const OFFER_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** `products`: by id, for list results, which can't expand `price.product` (five levels; Stripe allows four). */
export function mirrorOf(sub: Stripe.Subscription, products: ReadonlyMap<string, Stripe.Product>): { ok: MirrorFields; notes: MirrorNote[] } | { error: MirrorError } {
  const tiered = sub.items.data.flatMap((item) => {
    const tier = tierOf(item.price.product, products);
    return tier ? [{ item, tier }] : [];
  });
  const tiers = new Set(tiered.map((t) => t.tier));
  if (tiers.size !== 1) return { error: 'UNKNOWN_TIER' };
  const [{ item: tieredItem, tier }] = tiered as [{ item: Stripe.SubscriptionItem; tier: BillingTier }];

  const currency = sub.currency.toUpperCase();
  if (currency !== 'ILS' && currency !== 'USD') return { error: 'UNSUPPORTED_CURRENCY' };

  const periodEnd = periodEndOf(sub);
  if (periodEnd === null) return { error: 'NO_PERIOD' };

  const notes: MirrorNote[] = [];
  const orgMeta = sub.metadata?.['mutaba3a_organization_id'] ?? null;
  const organizationId = orgMeta !== null && UUID_RE.test(orgMeta) ? orgMeta.toLowerCase() : null;
  if (orgMeta !== null && organizationId === null) notes.push('UNKNOWN_ORG');
  if (tier === 'FIRM' && organizationId === null && orgMeta === null) notes.push('FIRM_WITHOUT_ORG');
  const pause = pauseOf(sub);
  if (pause.notOurs) notes.push('PAUSE_NOT_OURS');

  return {
    ok: {
      tier,
      organizationId,
      status: sub.status,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: endsByPeriodEnd(sub, periodEnd),
      // billing_subscriptions.priceLookupKey is VarChar(100); Stripe allows 200. Our keys are short; never let a long one
      // turn the event into a database error Stripe retries for days.
      priceLookupKey: tieredItem.price.lookup_key?.slice(0, LOOKUP_KEY_MAX) ?? null,
      founderUntil: null,
      offerId: offerIdOf(sub.metadata?.['mutaba3a_offer']),
      pausedFrom: pause.pausedFrom,
      pauseResumesAt: pause.pauseResumesAt,
      endedAt: typeof sub.ended_at === 'number' ? new Date(sub.ended_at * 1000) : null,
      currency,
    },
    notes,
  };
}

/** MUT-532: the metadata an MTB3A pause writes beside `pause_collection` (plan-gateway.ts `schedulePause`). */
export const PAUSE_FROM_METADATA = 'mutaba3a_pause_from';
export const PAUSE_MONTHS_METADATA = 'mutaba3a_pause_months';

/**
 * MUT-532 (§2.3, R4): a pause is Stripe's `pause_collection`, which leaves the status `active`. MTB3A's own starts at
 * the paid period's end (its metadata) and has a `resumes_at`. Anything else (set in the dashboard, no or bad metadata,
 * no end) reads as paused from the start, flagged for the operator, so a pause is never silently ACTIVE. Stripe leaves
 * the metadata behind when it resumes: without `pause_collection` there is no pause.
 */
export function pauseOf(sub: Stripe.Subscription): { pausedFrom: Date | null; pauseResumesAt: Date | null; notOurs: boolean } {
  const pause = sub.pause_collection ?? null;
  if (pause === null) return { pausedFrom: null, pauseResumesAt: null, notOurs: false };
  const resumesAt = typeof pause.resumes_at === 'number' ? new Date(pause.resumes_at * 1000) : null;
  const raw = sub.metadata?.[PAUSE_FROM_METADATA];
  const parsed = raw && ISO_INSTANT_RE.test(raw) ? new Date(raw) : null;
  const from = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
  const ours = from !== null && resumesAt !== null && from < resumesAt;
  // No end: paused from its own start if it names one, else from the start; either way until someone resumes it.
  const pausedFrom = ours || (from !== null && resumesAt === null) ? from : new Date(0);
  return { pausedFrom, pauseResumesAt: resumesAt, notOurs: !ours };
}

const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

function offerIdOf(value: string | undefined): string | null {
  return value !== undefined && OFFER_ID_RE.test(value) ? value : null;
}

function tierOf(product: string | Stripe.Product | Stripe.DeletedProduct, products: ReadonlyMap<string, Stripe.Product>): BillingTier | null {
  const resolved = typeof product === 'string' ? products.get(product) : product;
  if (!resolved || 'deleted' in resolved) return null;
  return TIERS[(resolved.metadata?.['tier'] ?? '').trim().toLowerCase()] ?? null;
}

/** What Stripe says about a subscription's state, readable even when its tier isn't (MUT-360 review: never freeze it). */
export function stateOf(sub: Stripe.Subscription): { status: string; cancelAtPeriodEnd: boolean; currentPeriodEnd: Date | null } {
  const periodEnd = periodEndOf(sub);
  return { status: sub.status, cancelAtPeriodEnd: endsByPeriodEnd(sub, periodEnd), currentPeriodEnd: periodEnd };
}

/**
 * Cancelled to end with this period. Since 2026-02-25.clover the Customer Portal sets `cancel_at` to the period end and
 * leaves `cancel_at_period_end` false (seen in MUT-362's release-QA), so either counts. A `cancel_at` past this period
 * renews once more first. One set earlier (only from the dashboard) still reads as the period end, the date we show.
 */
function endsByPeriodEnd(sub: Stripe.Subscription, periodEnd: Date | null): boolean {
  if (sub.cancel_at_period_end) return true;
  const cancelAt = sub.cancel_at ?? null;
  return cancelAt !== null && periodEnd !== null && cancelAt * 1000 <= periodEnd.getTime();
}

/** Since 2025-03-31.basil the period lives on each item; the latest end is when the subscription runs out. */
export function periodEndOf(sub: Stripe.Subscription): Date | null {
  const ends = sub.items.data.map((item) => item.current_period_end).filter((end): end is number => typeof end === 'number');
  const legacy = (sub as unknown as { current_period_end?: number }).current_period_end;
  const end = ends.length > 0 ? Math.max(...ends) : typeof legacy === 'number' ? legacy : null;
  return end === null ? null : new Date(end * 1000);
}

/** The subscription an invoice belongs to, in the pinned version's shape or the older top-level one (OV-5). */
export function subscriptionIdOfInvoice(invoice: Stripe.Invoice): string | null {
  const modern = invoice.parent?.subscription_details?.subscription ?? null;
  const legacy = (invoice as unknown as { subscription?: string | { id: string } | null }).subscription ?? null;
  const found = modern ?? legacy;
  if (found === null) return null;
  return typeof found === 'string' ? found : found.id;
}

export function customerIdOf(customer: string | Stripe.Customer | Stripe.DeletedCustomer): string {
  return typeof customer === 'string' ? customer : customer.id;
}
