import { profileOwnerOf } from '../personal-profile.js';
import type { LedgerStore } from '../repositories/ports.js';
import type { ComebackFacts } from './comeback.js';
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
