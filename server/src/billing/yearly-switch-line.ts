import type { Logger } from '../logger.js';
import type { BillingRetentionEventRecord, BillingSubscriptionRecord, LedgerStore } from '../repositories/ports.js';
import { ALL_GA_LOOKUP_KEYS, catalogFrom, planCatalogsFrom, type Catalog } from './checkout.js';
import { catalogFor, LEGACY_OFFER_PLAN, type OfferCatalogs } from './offer.js';
import { ALL_PLAN_LOOKUP_KEYS } from './plans.js';
import { listPriceOf, SWITCH_AFTER_PAID_INVOICES, yearlySwitchOf } from './retention.js';
import type { CheckoutGateway } from './stripe/checkout-gateway.js';
import { StripeGatewayError } from './stripe/gateway.js';
import type { PlanGateway } from './stripe/plan-gateway.js';

/**
 * MUT-535 (plan D9): the list-price catalog and MUT-531's "switch to yearly" line, read by Billing (GET /v1/billing)
 * and by the monthly summary mail, so the mail offers the switch exactly when Billing does. MUT-703: on every plan,
 * each from its own plan's catalog.
 */

export const NO_CATALOG: Catalog = { ILS: null, USD: null };
export const NO_CATALOGS: OfferCatalogs = { legacy: NO_CATALOG, plans: null };

export async function catalogOf(checkout: CheckoutGateway): Promise<Catalog> {
  return catalogFrom(await checkout.pricesByLookupKey(ALL_GA_LOOKUP_KEYS));
}

/** MUT-703: the legacy Freelancer catalog and each plan on sale's, each read through the gateway's cache. */
export async function offerCatalogsOf(checkout: CheckoutGateway): Promise<OfferCatalogs> {
  const [legacy, plans] = await Promise.all([catalogOf(checkout), checkout.pricesByLookupKey(ALL_PLAN_LOOKUP_KEYS).then(planCatalogsFrom)]);
  return { legacy, plans };
}

/** MUT-703 (§3.3): the catalog a subscription's own list price is sold from (the legacy one for anything else). */
export function catalogOfKey(catalogs: OfferCatalogs, lookupKey: string | null): Catalog {
  return catalogFor(catalogs, listPriceOf(lookupKey)?.plan ?? LEGACY_OFFER_PLAN);
}

/** GET must open for a person who only wants Manage billing, so a failed price lookup is logged and shown as no prices. */
export async function catalogOrNothing(checkout: CheckoutGateway, logger: Pick<Logger, 'warn' | 'error'>, requestId: string): Promise<Catalog> {
  try {
    return await catalogOf(checkout);
  } catch (err) {
    if (!(err instanceof StripeGatewayError)) throw err;
    logger.warn({ code: err.code, type: err.type, stripeRequestId: err.requestId, requestId }, 'billing catalog unavailable; prices hidden');
    return NO_CATALOG;
  }
}

/** MUT-703: the plan catalogs for GET, or none (warned): a read never fails on them. */
export async function planCatalogsOrNothing(checkout: CheckoutGateway, logger: Pick<Logger, 'warn'>, requestId: string): Promise<OfferCatalogs['plans']> {
  try {
    return planCatalogsFrom(await checkout.pricesByLookupKey(ALL_PLAN_LOOKUP_KEYS));
  } catch (err) {
    if (!(err instanceof StripeGatewayError)) throw err;
    logger.warn({ code: err.code, type: err.type, stripeRequestId: err.requestId, requestId }, 'plan catalogs unavailable; plan offers hidden');
    return null;
  }
}

/**
 * MUT-531 (D2, D3, R1): the "switch to yearly" line, from the mirror plus Stripe's paid-invoice count (cached). Only a
 * monthly list price that is active and not cancelling asks Stripe at all; a failure hides the line, never the read.
 * Stripe's own discount and pause are checked when the person opens the switch (GET /v1/billing/yearly-switch).
 * MUT-703: any plan's monthly list price, its saving from its own plan's catalog; hidden while a plan change waits.
 */
export async function yearlySwitchLine(
  store: LedgerStore,
  userId: string,
  plan: PlanGateway,
  shown: BillingSubscriptionRecord,
  catalogs: OfferCatalogs,
  now: Date,
  logger: Pick<Logger, 'warn'>,
  requestId: string,
) {
  const mirrored = { status: shown.status, priceLookupKey: shown.priceLookupKey, cancelAtPeriodEnd: shown.cancelAtPeriodEnd };
  const catalog = catalogOfKey(catalogs, shown.priceLookupKey);
  const paused = shown.pausedFrom !== null;
  if (yearlySwitchOf(mirrored, { paidInvoices: SWITCH_AFTER_PAID_INVOICES, discounted: false, paused }, catalog).ok === false) return null;
  // MUT-532 (D13): not while the stay offer runs; the rest of its discount would land on the yearly invoice or be lost.
  if (stayOfferRuns(await store.billing.retentionEventsOf(userId), now)) return null;
  // MUT-703: not while a plan change waits on a Stripe schedule (the switch would fight its phases).
  if ((await store.billing.planChangesOf(userId)).some((change) => change.state === 'SCHEDULED')) return null;
  try {
    const decision = yearlySwitchOf(mirrored, { paidInvoices: await plan.paidInvoiceCount(shown.stripeSubscriptionId), discounted: false, paused: false }, catalog);
    return decision.ok ? { plan: decision.plan, currency: decision.currency, savings: decision.savings } : null;
  } catch (err) {
    if (!(err instanceof StripeGatewayError)) throw err;
    logger.warn({ code: err.code, type: err.type, stripeRequestId: err.requestId, requestId }, 'paid invoices unavailable; switch line hidden');
    return null;
  }
}

export function stayOfferRuns(events: readonly BillingRetentionEventRecord[], now: Date): boolean {
  return events.some((e) => e.kind === 'STAY_OFFER' && (e.endsAt === null || e.endsAt > now));
}
