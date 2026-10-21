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
export type MirrorNote = 'FIRM_WITHOUT_ORG' | 'UNKNOWN_ORG';

export interface MirrorFields {
  tier: BillingTier;
  organizationId: string | null;
  status: string;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  priceLookupKey: string | null;
  /** D4: MUT-363 reads the subscription schedule and fills it. */
  founderUntil: null;
  /** The account's currency (billing_accounts.currency): ILS for Israel, USD elsewhere. */
  currency: 'ILS' | 'USD';
}

const TIERS: Record<string, BillingTier> = { freelancer: 'FREELANCER', firm: 'FIRM' };
const LOOKUP_KEY_MAX = 100;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  return {
    ok: {
      tier,
      organizationId,
      status: sub.status,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      // billing_subscriptions.priceLookupKey is VarChar(100); Stripe allows 200. Our keys are short; never let a long one
      // turn the event into a database error Stripe retries for days.
      priceLookupKey: tieredItem.price.lookup_key?.slice(0, LOOKUP_KEY_MAX) ?? null,
      founderUntil: null,
      currency,
    },
    notes,
  };
}

function tierOf(product: string | Stripe.Product | Stripe.DeletedProduct, products: ReadonlyMap<string, Stripe.Product>): BillingTier | null {
  const resolved = typeof product === 'string' ? products.get(product) : product;
  if (!resolved || 'deleted' in resolved) return null;
  return TIERS[(resolved.metadata?.['tier'] ?? '').trim().toLowerCase()] ?? null;
}

/** Since 2025-03-31.basil the period lives on each item; the latest end is when the subscription runs out. */
function periodEndOf(sub: Stripe.Subscription): Date | null {
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
