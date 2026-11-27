import type { CalendarDay, MailOffer } from '../email/ports.js';
import type { Logger } from '../logger.js';
import { ALL_GA_LOOKUP_KEYS, catalogFrom, planCatalogsFrom, type BillingInterval, type Catalog } from './checkout.js';
import { LEGACY_OFFER_PLAN, resolveOffer, type Offer, type OfferCatalogs, type OfferEntry, type OfferPlan } from './offer.js';
import { ALL_PLAN_LOOKUP_KEYS } from './plans.js';
import type { CheckoutGateway } from './stripe/checkout-gateway.js';
import { StripeGatewayError } from './stripe/gateway.js';

/**
 * MUT-525 (D6, R7): the running offer, or null. GET reads the coupon through the gateway's cache; Checkout reads it
 * fresh. Any failure, a missing permission included, means no offer: a promotion must never stop anyone paying. GET
 * warns (like the catalog); Checkout logs an error, since an eligible person is then charged the full price.
 * This is the legacy Freelancer Checkout's launch offer; `launchOfferFor` is any plan's (MUT-703).
 */
export async function offerOrNothing(
  checkout: CheckoutGateway,
  offers: readonly OfferEntry[],
  catalog: Catalog,
  now: Date,
  fresh: boolean,
  logger: Pick<Logger, 'warn' | 'error'>,
  requestId: string,
  interval: BillingInterval = 'year',
): Promise<Offer | null> {
  return launchOfferFor(checkout, offers, LEGACY_OFFER_PLAN, interval, { legacy: catalog, plans: null }, now, fresh, logger, requestId);
}

/** MUT-703 (§3.4): the launch offer on one plan and interval, from the coupon its entry names; failures as above. */
export async function launchOfferFor(
  checkout: CheckoutGateway,
  offers: readonly OfferEntry[],
  plan: OfferPlan,
  interval: BillingInterval,
  catalogs: OfferCatalogs,
  now: Date,
  fresh: boolean,
  logger: Pick<Logger, 'warn' | 'error'>,
  requestId: string,
): Promise<Offer | null> {
  try {
    return await resolveOffer(offers, plan, interval, (id) => checkout.couponById(id, { fresh }), catalogs, now);
  } catch (err) {
    if (!(err instanceof StripeGatewayError)) throw err;
    const ids = { code: err.code, type: err.type, stripeRequestId: err.requestId, requestId, plan };
    if (fresh) logger.error(ids, 'launch offer coupon could not be read; this Checkout is at full price (check Read on Coupons)');
    else logger.warn(ids, 'launch offer unavailable; offer hidden');
    return null;
  }
}

/**
 * MUT-525 (D8, R9b): the offer line the day's trial mails carry, read once per run through the gateway's cache. No
 * Stripe, or Stripe failing on the prices or the coupon: no line, and the mails go out as before. MUT-703: while the
 * plans are on sale (PLAN_CHECKOUT) the line is the plans' launch offer (one coupon for all three, read on Solo).
 */
export async function trialMailOffer(checkout: CheckoutGateway | null, offers: readonly OfferEntry[], now: Date, logger: Pick<Logger, 'warn' | 'error'>, planSales = false): Promise<MailOffer | null> {
  if (!checkout) return null;
  let catalogs: OfferCatalogs;
  try {
    catalogs = planSales
      ? { legacy: { ILS: null, USD: null }, plans: planCatalogsFrom(await checkout.pricesByLookupKey(ALL_PLAN_LOOKUP_KEYS)) }
      : { legacy: catalogFrom(await checkout.pricesByLookupKey(ALL_GA_LOOKUP_KEYS)), plans: null };
  } catch (err) {
    if (!(err instanceof StripeGatewayError)) throw err;
    logger.warn({ code: err.code, type: err.type, stripeRequestId: err.requestId }, 'trial mail: prices unavailable; no launch offer line');
    return null;
  }
  const offer = await launchOfferFor(checkout, offers, planSales ? 'solo' : LEGACY_OFFER_PLAN, 'year', catalogs, now, false, logger, 'trial-mail');
  return offer ? mailOfferOf(offer) : null;
}

/** The offer as mail names it: its percent and the Jerusalem calendar day of its end (23:59 there, DD10d). */
export function mailOfferOf(offer: Offer): MailOffer {
  return { percentOff: offer.percentOff, endsOn: jerusalemDayOf(offer.endsAt) };
}

/** Billing mail days are Asia/Jerusalem calendar days (DD7), whatever zone the server runs in. */
export function jerusalemDayOf(at: Date): CalendarDay {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(at);
  const part = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { year: part('year'), month: part('month'), day: part('day') };
}
