import type { Logger } from '../logger.js';
import { profileOwnerOf } from '../personal-profile.js';
import type { LedgerStore } from '../repositories/ports.js';
import { ALL_GA_LOOKUP_KEYS, catalogFrom } from './checkout.js';
import { comebackOfferOf, type ComebackFacts, type ComebackOffer } from './comeback.js';
import type { CheckoutGateway } from './stripe/checkout-gateway.js';
import { StripeGatewayError } from './stripe/gateway.js';
import { entitlementsFor, memberProfilesForBilling } from './coverage.js';
import { comebackEntryOf, OFFERS, type OfferEntry } from './offer.js';

/** What the come-back facts read: the person's billing rows, their profiles and those profiles' coverage. */
export type ComebackStore = Pick<LedgerStore, 'billing' | 'memberships' | 'organizations' | 'integrations'>;

/**
 * MUT-534 (D13): one person's come-back facts, for the daily job, GET /v1/billing and Checkout alike: their mirrored
 * subscriptions, their retention events, and whether Malafat or an operator grant covers one of their own profiles (the
 * trial mail's `covered`).
 */
export async function comebackFactsOf(store: ComebackStore, userId: string, now: Date, offers: readonly OfferEntry[] = OFFERS): Promise<ComebackFacts> {
  const [summary, events, profiles] = await Promise.all([store.billing.summaryOf(userId), store.billing.retentionEventsOf(userId), memberProfilesForBilling(store, userId)]);
  const own = profiles.filter((p) => profileOwnerOf(p.organization) === userId);
  const entitlements = own.length > 0 ? await entitlementsFor(store, own, now) : new Map();
  const covered = own.some((p) => {
    const source = entitlements.get(p.organization.id)?.source;
    return source === 'MALAFAT' || source === 'OPERATOR';
  });
  const comeback = comebackEntryOf(offers);
  return { subscriptions: summary.subscriptions, events, covered, comebackOfferIds: new Set(comeback ? [comeback.id] : []) };
}

/**
 * MUT-534 (D8): the running come-back offer, from the coupon (cached) and the catalog. Any Stripe failure, a missing
 * permission included, is no offer, warned: a promotion never stops anything else (ADR-237 D5).
 */
export async function comebackOfferOrNothing(checkout: CheckoutGateway, offers: readonly OfferEntry[], logger: Pick<Logger, 'warn'>, options: { fresh?: boolean } = {}): Promise<ComebackOffer | null> {
  const entry = comebackEntryOf(offers);
  if (!entry) return null;
  try {
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
