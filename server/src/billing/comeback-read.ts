import type { Logger } from '../logger.js';
import { profileOwnerOf } from '../personal-profile.js';
import type { LedgerStore } from '../repositories/ports.js';
import { ALL_GA_LOOKUP_KEYS, catalogFrom, planCatalogsFrom } from './checkout.js';
import { comebackOfferOf, percentComebackOfferOf, type ComebackFacts, type ComebackOffer } from './comeback.js';
import { ALL_PLAN_LOOKUP_KEYS, type PlanName } from './plans.js';
import type { CheckoutGateway } from './stripe/checkout-gateway.js';
import { StripeGatewayError } from './stripe/gateway.js';
import { entitlementsFor, memberProfilesForBilling } from './coverage.js';
import { profilePlanSubscriptions } from './entitlement.js';
import { comebackEntryFor, comebackIdsOf, LEGACY_OFFER_PLAN, OFFERS, type OfferEntry } from './offer.js';

/** What the come-back facts read: the person's billing rows, their profiles and those profiles' coverage. */
export type ComebackStore = Pick<LedgerStore, 'billing' | 'memberships' | 'organizations' | 'integrations'>;

/**
 * MUT-534 (D13): one person's come-back facts, for the daily job, GET /v1/billing and Checkout alike: their mirrored
 * subscriptions, their retention events, and whether Malafat or an operator grant covers one of their own profiles (the
 * trial mail's `covered`).
 */
export async function comebackFactsOf(
  store: ComebackStore,
  userId: string,
  now: Date,
  offers: readonly OfferEntry[] = OFFERS,
  known?: { subscriptions: ComebackFacts['subscriptions'] },
): Promise<ComebackFacts> {
  // Review: a caller that already read the person's subscriptions (GET /v1/billing) passes them in.
  const [subscriptions, events, profiles] = await Promise.all([
    // MUT-565: the come-back offer is the Freelancer plan's; an Accountant plan ending (or running) never counts.
    known ? Promise.resolve(profilePlanSubscriptions(known.subscriptions)) : store.billing.summaryOf(userId).then((s) => profilePlanSubscriptions(s.subscriptions)),
    store.billing.retentionEventsOf(userId),
    memberProfilesForBilling(store, userId),
  ]);
  const own = profiles.filter((p) => profileOwnerOf(p.organization) === userId);
  const entitlements = own.length > 0 ? await entitlementsFor(store, own, now) : new Map();
  const covered = own.some((p) => {
    const source = entitlements.get(p.organization.id)?.source;
    return source === 'MALAFAT' || source === 'OPERATOR';
  });
  // MUT-703 (§3.1): every come-back entry's id, legacy and plans alike: one come-back per person, ever.
  return { subscriptions, events, covered, ownsProfile: own.length > 0, comebackOfferIds: comebackIdsOf(offers) };
}

/**
 * MUT-534 (D8): the running come-back offer, from the coupon (cached) and the catalog. Any Stripe failure, a missing
 * permission included, is no offer, warned: a promotion never stops anything else (ADR-237 D5). MUT-703: with `plan`,
 * the plans' percent come-back on that plan; without, the legacy Freelancer one.
 */
export async function comebackOfferOrNothing(checkout: CheckoutGateway, offers: readonly OfferEntry[], logger: Pick<Logger, 'warn'>, options: { fresh?: boolean; plan?: PlanName | null } = {}): Promise<ComebackOffer | null> {
  const plan = options.plan ?? null;
  const entry = comebackEntryFor(offers, plan ?? LEGACY_OFFER_PLAN);
  if (!entry) return null;
  try {
    if ('couponId' in entry) {
      if (!plan) return null;
      const [plans, coupon] = await Promise.all([checkout.pricesByLookupKey(ALL_PLAN_LOOKUP_KEYS).then(planCatalogsFrom), checkout.couponById(entry.couponId, { fresh: options.fresh ?? false })]);
      const offer = percentComebackOfferOf(entry, coupon, { legacy: { ILS: null, USD: null }, plans }, plan);
      if (!offer) logger.warn({ couponId: entry.couponId, plan }, 'the plans’ come-back coupon is missing or not shaped as a percent off once on the plans’ products; no come-back offer');
      return offer;
    }
    // An amount-off entry is priced on the legacy catalog only.
    if (plan) return null;
    const catalog = catalogFrom(await checkout.pricesByLookupKey(ALL_GA_LOOKUP_KEYS));
    const read = (id: string) => checkout.couponById(id, { fresh: options.fresh ?? false });
    const [ils, usd] = await Promise.all([read(entry.couponIds.ILS), read(entry.couponIds.USD)]);
    const offer = comebackOfferOf(entry, { ILS: ils, USD: usd }, catalog);
    if (!offer || offer.couponIds.ILS === null || offer.couponIds.USD === null) {
      logger.warn({ couponIds: entry.couponIds }, 'a come-back coupon is missing or not shaped as an amount off once on the Freelancer product; that currency has no come-back offer');
    }
    return offer;
  } catch (err) {
    if (!(err instanceof StripeGatewayError)) throw err;
    logger.warn({ code: err.code, type: err.type, stripeRequestId: err.requestId }, 'come-back offer unavailable; no come-back offer');
    return null;
  }
}
