import type { CalendarDay, MailOffer } from '../email/ports.js';
import type { Logger } from '../logger.js';
import { ALL_GA_LOOKUP_KEYS, catalogFrom, type BillingInterval, type Catalog } from './checkout.js';
import { productIdsOf, resolveOffer, type Offer, type OfferEntry } from './offer.js';
import type { CheckoutGateway } from './stripe/checkout-gateway.js';
import { StripeGatewayError } from './stripe/gateway.js';

/**
 * MUT-525 (D6, R7): the running offer, or null. GET reads the coupon through the gateway's cache; Checkout reads it
 * fresh. Any failure, a missing permission included, means no offer: a promotion must never stop anyone paying. GET
 * warns (like the catalog); Checkout logs an error, since an eligible person is then charged the full price.
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
  const products = productIdsOf(catalog);
  if (products.size === 0) return null;
  try {
    return await resolveOffer(offers, interval, (id) => checkout.couponById(id, { fresh }), products, now);
  } catch (err) {
    if (!(err instanceof StripeGatewayError)) throw err;
    const ids = { code: err.code, type: err.type, stripeRequestId: err.requestId, requestId };
    if (fresh) logger.error(ids, 'launch offer coupon could not be read; this Checkout is at full price (check Read on Coupons)');
    else logger.warn(ids, 'launch offer unavailable; offer hidden');
    return null;
  }
}

/**
 * MUT-525 (D8, R9b): the offer line the day's trial mails carry, read once per run through the gateway's cache. No
 * Stripe, or Stripe failing on the prices or the coupon: no line, and the mails go out as before.
 */
export async function trialMailOffer(checkout: CheckoutGateway | null, offers: readonly OfferEntry[], now: Date, logger: Pick<Logger, 'warn' | 'error'>): Promise<MailOffer | null> {
  if (!checkout) return null;
  let catalog: Catalog;
  try {
    catalog = catalogFrom(await checkout.pricesByLookupKey(ALL_GA_LOOKUP_KEYS));
  } catch (err) {
    if (!(err instanceof StripeGatewayError)) throw err;
    logger.warn({ code: err.code, type: err.type, stripeRequestId: err.requestId }, 'trial mail: prices unavailable; no launch offer line');
    return null;
  }
  const offer = await offerOrNothing(checkout, offers, catalog, now, false, logger, 'trial-mail');
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
