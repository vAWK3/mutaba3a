import type { AuditEventInput, BillingSubscriptionRecord, JsonObject, SubscriptionAuditContext } from './ports.js';

/**
 * MUT-360: `billing.subscription_changed`, built by both stores inside the write's transaction, after the
 * newer-read compare, so `from` is the row that was actually replaced. `stripeUpdatedAt` changes on every read and is
 * not a change; the fields below are what coverage and the operator care about.
 */
type Mirrored = Pick<
  BillingSubscriptionRecord,
  'billingAccountId' | 'tier' | 'organizationId' | 'status' | 'currentPeriodEnd' | 'cancelAtPeriodEnd' | 'priceLookupKey' | 'founderUntil'
>;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function mirrored(sub: Mirrored): JsonObject {
  return {
    billingAccountId: sub.billingAccountId,
    tier: sub.tier,
    organizationId: sub.organizationId,
    status: sub.status,
    currentPeriodEnd: iso(sub.currentPeriodEnd),
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    priceLookupKey: sub.priceLookupKey,
    founderUntil: iso(sub.founderUntil),
  };
}

export function subscriptionChanged(before: Mirrored, after: Mirrored): boolean {
  return JSON.stringify(mirrored(before)) !== JSON.stringify(mirrored(after));
}

/** One row per profile in `context.profileIds`, de-duplicated; none when the subscription reaches no profile yet. */
export function subscriptionChangeAudit(before: Mirrored | null, after: BillingSubscriptionRecord, context: SubscriptionAuditContext): AuditEventInput[] {
  const metadata: JsonObject = {
    stripeSubscriptionId: after.stripeSubscriptionId,
    source: context.source,
    eventId: context.eventId,
    from: before ? mirrored(before) : null,
    to: mirrored(after),
  };
  return [...new Set(context.profileIds)].map((organizationId) => ({
    organizationId,
    actorType: 'SYSTEM',
    actorId: null,
    action: 'billing.subscription_changed',
    entityType: 'billing_subscription',
    entityId: after.id,
    metadata,
    requestId: context.requestId,
  }));
}
