import { describe, expect, it } from 'vitest';
import { CHECKOUT_SESSION_TTL_SECONDS, type Catalog } from '../checkout.js';
import {
  OFFERS,
  firstYearOf,
  offerEligible,
  offerFromCoupon,
  offersFor,
  offerView,
  parseOffers,
  stayEntryOf,
  productIdsOf,
  resolveOffer,
  type CouponFact,
  type OfferEntry,
} from '../offer.js';
import { formatMinor } from '../money.js';

/**
 * MUT-525 (plan D1–D4, eng review R1, OV-6, D12): the launch offer, decided from the Stripe coupon alone. Pure: the
 * route reads the coupon (cached or fresh) and the person's subscriptions; this decides whether an offer runs, who
 * gets it and what the first year costs.
 */

const NOW = new Date('2026-11-02T09:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const END = new Date('2027-02-01T22:59:00.000Z');
const ENTRY: OfferEntry = { id: 'launch-2026', couponId: 'mtb3a_launch_yearly_2026', kind: 'launch', interval: 'year', tier: 'freelancer' };
const STAY: OfferEntry = { id: 'stay-2026', couponId: 'mtb3a_stay_monthly_50', kind: 'stay', interval: 'month', tier: 'freelancer' };
const PRODUCTS = new Set(['prod_FREELANCER']);
const CATALOG: Catalog = {
  ILS: { month: { id: 'price_ils_m', unitAmount: 2900, productId: 'prod_FREELANCER' }, year: { id: 'price_ils_y', unitAmount: 29000, productId: 'prod_FREELANCER' } },
  USD: { month: { id: 'price_usd_m', unitAmount: 900, productId: 'prod_FREELANCER' }, year: { id: 'price_usd_y', unitAmount: 9000, productId: 'prod_FREELANCER' } },
};

const coupon = (over: Partial<CouponFact> = {}): CouponFact => ({
  id: ENTRY.couponId,
  valid: true,
  percentOff: 50,
  amountOff: null,
  duration: 'once',
  durationInMonths: null,
  redeemBy: END,
  appliesToProducts: ['prod_FREELANCER'],
  ...over,
});

describe('offers.json (D12)', () => {
  it('ships the launch offer, yearly, and the stay offer, monthly, on the Freelancer tier (MUT-532)', () => {
    expect(OFFERS).toEqual([ENTRY, STAY]);
  });

  it('reads an entry with no kind as a launch offer, and a stay offer only monthly (MUT-532)', () => {
    const { kind: _kind, ...noKind } = ENTRY;
    void _kind;
    expect(parseOffers([noKind])).toEqual([ENTRY]);
    expect(() => parseOffers([{ ...STAY, interval: 'year' }])).toThrow(/stay offer/);
    expect(() => parseOffers([{ ...STAY, kind: 'comeback' }])).toThrow(/kind/);
    expect(stayEntryOf(OFFERS)).toEqual(STAY);
    expect(stayEntryOf([ENTRY])).toBeNull();
  });

  it('fails fast on a malformed list', () => {
    expect(() => parseOffers({})).toThrow(/offers.json/);
    expect(() => parseOffers([{ ...ENTRY, interval: 'week' }])).toThrow(/interval/);
    expect(() => parseOffers([{ ...ENTRY, tier: 'firm' }])).toThrow(/tier/);
    expect(() => parseOffers([{ ...ENTRY, couponId: '' }])).toThrow(/couponId/);
    expect(() => parseOffers([{ ...ENTRY, id: 'Bad Id' }])).toThrow(/id/);
    expect(() => parseOffers([ENTRY, ENTRY])).toThrow(/duplicate/);
  });

  it('a non-production coupon id replaces the list with one yearly QA entry (R6)', () => {
    expect(offersFor(undefined)).toBe(OFFERS);
    expect(offersFor('qa_offer_abc')).toEqual([{ ...ENTRY, couponId: 'qa_offer_abc' }, STAY]);
    expect(offersFor(undefined, 'qa_stay_abc')).toEqual([ENTRY, { ...STAY, couponId: 'qa_stay_abc' }]);
    expect(offersFor('qa_offer_abc', 'qa_stay_abc')).toEqual([{ ...ENTRY, couponId: 'qa_offer_abc' }, { ...STAY, couponId: 'qa_stay_abc' }]);
  });

  it('never takes a stay coupon for the launch offer of a monthly Checkout (MUT-532)', async () => {
    const read: string[] = [];
    const stay = coupon({ id: STAY.couponId, duration: 'repeating', durationInMonths: 2, redeemBy: null });
    expect(await resolveOffer([ENTRY, STAY], 'month', async (id) => (read.push(id), stay), PRODUCTS, NOW)).toBeNull();
    expect(read).toEqual([]);
  });
});

describe('offerFromCoupon (D1, R1, OV-6)', () => {
  it('a valid 50% once coupon on the Freelancer product is an offer ending an hour before redeem_by', () => {
    expect(offerFromCoupon(ENTRY, coupon(), PRODUCTS, NOW)).toEqual({ id: 'launch-2026', couponId: ENTRY.couponId, percentOff: 50, interval: 'year', endsAt: new Date(END.getTime() - HOUR) });
  });

  it.each<[string, CouponFact | null]>([
    ['missing', null],
    ['not valid', coupon({ valid: false })],
    ['without redeem_by', coupon({ redeemBy: null })],
    ['an amount off', coupon({ percentOff: null, amountOff: 14500 })],
    ['repeating', coupon({ duration: 'repeating' })],
    ['forever', coupon({ duration: 'forever' })],
    ['not restricted to a product', coupon({ appliesToProducts: null })],
    ['restricted to no product', coupon({ appliesToProducts: [] })],
    ['also on another product', coupon({ appliesToProducts: ['prod_FREELANCER', 'prod_FIRM'] })],
    ['over 100%', coupon({ percentOff: 120 })],
    ['zero', coupon({ percentOff: 0 })],
  ])('a coupon %s is no offer', (_, fact) => {
    expect(offerFromCoupon(ENTRY, fact, PRODUCTS, NOW)).toBeNull();
  });

  it('a new Checkout gets it only while now + the session TTL is before redeem_by (R1)', () => {
    const lastMoment = new Date(END.getTime() - CHECKOUT_SESSION_TTL_SECONDS * 1000 - 1);
    expect(offerFromCoupon(ENTRY, coupon(), PRODUCTS, lastMoment)).not.toBeNull();
    expect(offerFromCoupon(ENTRY, coupon(), PRODUCTS, new Date(END.getTime() - CHECKOUT_SESSION_TTL_SECONDS * 1000))).toBeNull();
    expect(offerFromCoupon(ENTRY, coupon(), PRODUCTS, END)).toBeNull();
  });

  it('the Freelancer products come from the catalog’s prices', () => {
    expect(productIdsOf(CATALOG)).toEqual(new Set(['prod_FREELANCER']));
    expect(productIdsOf({ ILS: null, USD: null })).toEqual(new Set());
    expect(offerFromCoupon(ENTRY, coupon(), productIdsOf({ ILS: null, USD: null }), NOW)).toBeNull();
  });
});

describe('resolveOffer (D12): the first entry for the interval whose coupon is an offer', () => {
  const second: OfferEntry = { id: 'spring-2027', couponId: 'mtb3a_spring_2027', kind: 'launch', interval: 'year', tier: 'freelancer' };

  it('reads each yearly entry’s coupon in order and stops at the first offer', async () => {
    const read: string[] = [];
    const offer = await resolveOffer([ENTRY, second], 'year', async (id) => (read.push(id), id === second.couponId ? coupon({ id }) : null), PRODUCTS, NOW);
    expect(offer?.id).toBe('spring-2027');
    expect(read).toEqual([ENTRY.couponId, second.couponId]);
  });

  it('never reads a coupon for an interval no entry has (R9d: no read on Monthly)', async () => {
    const read: string[] = [];
    expect(await resolveOffer([ENTRY], 'month', async (id) => (read.push(id), coupon()), PRODUCTS, NOW)).toBeNull();
    expect(read).toEqual([]);
  });
});

describe('offerEligible (D2, D3)', () => {
  const offer = offerFromCoupon(ENTRY, coupon(), PRODUCTS, NOW)!;
  const LATER = new Date('2027-01-01T00:00:00.000Z');

  it('yearly with no subscription ever: yes', () => {
    expect(offerEligible(offer, [], 'year')).toBe(true);
  });

  it('monthly: no', () => {
    expect(offerEligible(offer, [], 'month')).toBe(false);
  });

  it.each(['canceled', 'trialing', 'incomplete_expired', 'active'])('anyone with a %s subscription, ever: no', (status) => {
    expect(offerEligible(offer, [{ status, currentPeriodEnd: LATER }], 'year')).toBe(false);
  });

  it('no offer: no', () => {
    expect(offerEligible(null, [], 'year')).toBe(false);
  });
});

describe('firstYearOf (D4): Stripe’s arithmetic in minor units', () => {
  it.each([
    [29000, 50, 14500],
    [9000, 50, 4500],
    [4999, 50, 2499],
    [4999, 30, 3499],
    [1, 50, 0],
  ])('%i at %i%% off is %i', (amount, percent, first) => {
    expect(firstYearOf(amount, percent)).toBe(first);
  });
});

describe('offerView (§2 API contract)', () => {
  const offer = offerFromCoupon(ENTRY, coupon(), PRODUCTS, NOW)!;

  it('the first-year amount per currency, the shown end and whether this person gets it', () => {
    expect(offerView(offer, true, CATALOG)).toEqual({
      id: 'launch-2026',
      percentOff: 50,
      endsAt: new Date(END.getTime() - HOUR).toISOString(),
      interval: 'year',
      eligible: true,
      firstYear: { ILS: 14500, USD: 4500 },
    });
  });

  it('a currency that isn’t sellable has no first-year amount', () => {
    expect(offerView(offer, false, { ...CATALOG, USD: null }).firstYear).toEqual({ ILS: 14500, USD: null });
  });
});

describe('formatMinor: amounts on Stripe’s page and in mail', () => {
  it('whole amounts drop the decimals; others keep two', () => {
    expect(formatMinor(14500, 'ILS')).toBe('₪145');
    expect(formatMinor(4500, 'USD')).toBe('$45');
    expect(formatMinor(2499, 'USD')).toBe('$24.99');
  });
});
