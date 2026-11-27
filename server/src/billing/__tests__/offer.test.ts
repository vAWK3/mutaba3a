import { describe, expect, it } from 'vitest';
import { CHECKOUT_SESSION_TTL_SECONDS, type Catalog, type PlanCatalogs } from '../checkout.js';
import {
  OFFERS,
  comebackEntryFor,
  comebackIdsOf,
  entryFor,
  firstYearOf,
  offerEligible,
  offerFromCoupon,
  offersFor,
  offerView,
  parseOffers,
  productIdsOf,
  productsOf,
  resolveOffer,
  stayEntryFor,
  tookMoney,
  type CouponFact,
  type IntervalOfferEntry,
  type OfferCatalogs,
  type OfferEntry,
} from '../offer.js';
import { formatMinor } from '../money.js';

/**
 * MUT-525 (plan D1–D4, eng review R1, OV-6, D12): the launch offer, decided from the Stripe coupon alone. Pure: the
 * route reads the coupon (cached or fresh) and the person's subscriptions; this decides whether an offer runs, who
 * gets it and what the first year costs. MUT-703: entries name their plans; offers are looked up by kind, plan, interval.
 */

const NOW = new Date('2026-11-02T09:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const END = new Date('2027-02-01T22:59:00.000Z');
const ENTRY: IntervalOfferEntry = { id: 'launch-2026', couponId: 'mtb3a_launch_yearly_2026', kind: 'launch', interval: 'year', plans: ['freelancer'] };
const STAY: OfferEntry = { id: 'stay-2026', couponId: 'mtb3a_stay_monthly_50', kind: 'stay', interval: 'month', plans: ['freelancer'] };
const COMEBACK: OfferEntry = { id: 'comeback-2026', couponIds: { ILS: 'mtb3a_comeback_first_month_ils', USD: 'mtb3a_comeback_first_month_usd' }, kind: 'comeback', plans: ['freelancer'] };
const PLANS = ['solo', 'business', 'firm'] as const;
const PLAN_LAUNCH: IntervalOfferEntry = { id: 'launch-plans-2026', couponId: 'mtb3a_launch_yearly_plans_2026', kind: 'launch', interval: 'year', plans: [...PLANS] };
const PLAN_STAY: OfferEntry = { id: 'stay-plans-2026', couponId: 'mtb3a_stay_monthly_plans_50', kind: 'stay', interval: 'month', plans: [...PLANS] };
const PLAN_COMEBACK: OfferEntry = { id: 'comeback-plans-2026', couponId: 'mtb3a_comeback_first_month_plans_67', kind: 'comeback', interval: 'month', plans: [...PLANS] };
const PRODUCTS = new Set(['prod_FREELANCER']);
const CATALOG: Catalog = {
  ILS: { month: { id: 'price_ils_m', unitAmount: 2900, productId: 'prod_FREELANCER' }, year: { id: 'price_ils_y', unitAmount: 29000, productId: 'prod_FREELANCER' } },
  USD: { month: { id: 'price_usd_m', unitAmount: 900, productId: 'prod_FREELANCER' }, year: { id: 'price_usd_y', unitAmount: 9000, productId: 'prod_FREELANCER' } },
};
const planCatalog = (plan: string, month: number, usd: number): Catalog => ({
  ILS: { month: { id: `price_${plan}_m_ils`, unitAmount: month, productId: `prod_${plan}` }, year: { id: `price_${plan}_y_ils`, unitAmount: month * 10, productId: `prod_${plan}` } },
  USD: { month: { id: `price_${plan}_m_usd`, unitAmount: usd, productId: `prod_${plan}` }, year: { id: `price_${plan}_y_usd`, unitAmount: usd * 10, productId: `prod_${plan}` } },
});
const PLAN_CATALOGS: PlanCatalogs = { solo: planCatalog('solo', 3900, 1200), business: planCatalog('business', 8900, 2700), firm: planCatalog('firm', 24900, 7500) };
const CATALOGS: OfferCatalogs = { legacy: CATALOG, plans: PLAN_CATALOGS };
const ALL_PLAN_PRODUCTS = ['prod_solo', 'prod_business', 'prod_firm'];

const coupon = (over: Partial<CouponFact> = {}): CouponFact => ({
  id: ENTRY.couponId,
  valid: true,
  percentOff: 50,
  amountOff: null,
  amountOffIn: { ILS: null, USD: null },
  duration: 'once',
  durationInMonths: null,
  redeemBy: END,
  appliesToProducts: ['prod_FREELANCER'],
  ...over,
});

describe('offers.json (D12)', () => {
  it('ships the legacy Freelancer offers unchanged and one entry per kind for Solo, Business and Firm (MUT-703)', () => {
    expect(OFFERS).toEqual([ENTRY, STAY, COMEBACK, PLAN_LAUNCH, PLAN_STAY, PLAN_COMEBACK]);
    expect(comebackEntryFor(OFFERS, 'freelancer')).toEqual(COMEBACK);
    expect(comebackEntryFor(OFFERS, 'firm')).toEqual(PLAN_COMEBACK);
    expect(comebackEntryFor([ENTRY, STAY], 'freelancer')).toBeNull();
    expect(comebackIdsOf(OFFERS)).toEqual(new Set(['comeback-2026', 'comeback-plans-2026']));
  });

  it('MUT-703: looks an offer up by kind, plan and interval; legacy and plan entries never compete', () => {
    for (const plan of PLANS) {
      expect(entryFor(OFFERS, 'launch', plan, 'year')).toEqual(PLAN_LAUNCH);
      expect(entryFor(OFFERS, 'launch', plan, 'month')).toBeNull();
      expect(stayEntryFor(OFFERS, plan)).toEqual(PLAN_STAY);
      expect(entryFor(OFFERS, 'comeback', plan, 'month')).toEqual(PLAN_COMEBACK);
      // §13 Q4: the plans' come-back is monthly only.
      expect(entryFor(OFFERS, 'comeback', plan, 'year')).toBeNull();
    }
    expect(entryFor(OFFERS, 'launch', 'freelancer', 'year')).toEqual(ENTRY);
    expect(stayEntryFor(OFFERS, 'freelancer')).toEqual(STAY);
    // The legacy come-back has no interval: both.
    expect(entryFor(OFFERS, 'comeback', 'freelancer', 'year')).toEqual(COMEBACK);
  });

  it('MUT-703: plans are named, or the legacy tier stands for ["freelancer"]; mixed, unknown, repeated or empty plans fail', () => {
    const { plans: _p, ...noPlans } = ENTRY;
    void _p;
    expect(parseOffers([{ ...noPlans, tier: 'freelancer' }])).toEqual([ENTRY]);
    expect(() => parseOffers([noPlans])).toThrow(/plans/);
    expect(() => parseOffers([{ ...noPlans, tier: 'firm' }])).toThrow(/plans/);
    expect(() => parseOffers([{ ...ENTRY, tier: 'freelancer' }])).toThrow(/tier/);
    expect(() => parseOffers([{ ...ENTRY, plans: ['freelancer', 'solo'] }])).toThrow(/mix/);
    expect(() => parseOffers([{ ...ENTRY, plans: ['starter'] }])).toThrow(/not a plan/);
    expect(() => parseOffers([{ ...ENTRY, plans: ['accountant'] }])).toThrow(/not a plan/);
    expect(() => parseOffers([{ ...ENTRY, plans: ['solo', 'solo'] }])).toThrow(/repeat/);
    expect(() => parseOffers([{ ...ENTRY, plans: [] }])).toThrow(/non-empty/);
  });

  it('MUT-703: the percent come-back takes one coupon and an optional interval', () => {
    const { interval: _i, ...both } = PLAN_COMEBACK as OfferEntry & { interval: string };
    void _i;
    expect(parseOffers([both])).toEqual([{ ...PLAN_COMEBACK, interval: null }]);
    expect(() => parseOffers([{ ...PLAN_COMEBACK, interval: 'week' }])).toThrow(/interval/);
    expect(() => parseOffers([{ ...PLAN_COMEBACK, couponId: '' }])).toThrow(/couponId/);
  });

  it('MUT-534 (D9): a legacy come-back offer has no interval (it applies to both) and is never the launch offer', async () => {
    expect(parseOffers([{ id: 'comeback-2026', kind: 'comeback', couponIds: { ILS: 'mtb3a_comeback_first_month_ils', USD: 'mtb3a_comeback_first_month_usd' }, tier: 'freelancer' }])).toEqual([COMEBACK]);
    // One coupon per currency: Stripe's Checkout takes an amount off only in the coupon's own currency.
    expect(() => parseOffers([{ id: 'comeback-2026', kind: 'comeback', couponIds: { ILS: 'mtb3a_comeback_first_month_ils' }, tier: 'freelancer' }])).toThrow(/couponIds/);
    expect(() => parseOffers([{ ...COMEBACK, interval: 'month' }])).toThrow(/come-back offer with couponIds has no interval/);
    const read: string[] = [];
    expect(await resolveOffer([COMEBACK], 'freelancer', 'year', async (id) => (read.push(id), coupon({ id })), CATALOGS, NOW)).toBeNull();
    expect(read).toEqual([]);
  });

  it('reads an entry with no kind as a launch offer, and a stay offer only monthly (MUT-532)', () => {
    const { kind: _kind, ...noKind } = ENTRY;
    void _kind;
    expect(parseOffers([noKind])).toEqual([ENTRY]);
    expect(() => parseOffers([{ ...STAY, interval: 'year' }])).toThrow(/stay offer/);
    expect(() => parseOffers([{ ...STAY, kind: 'welcome' }])).toThrow(/kind/);
    expect(stayEntryFor(OFFERS, 'freelancer')).toEqual(STAY);
    expect(stayEntryFor([ENTRY], 'freelancer')).toBeNull();
  });

  it('fails fast on a malformed list', () => {
    expect(() => parseOffers({})).toThrow(/offers.json/);
    expect(() => parseOffers([{ ...ENTRY, interval: 'week' }])).toThrow(/interval/);
    expect(() => parseOffers([{ ...ENTRY, couponId: '' }])).toThrow(/couponId/);
    expect(() => parseOffers([{ ...ENTRY, id: 'Bad Id' }])).toThrow(/id/);
    expect(() => parseOffers([ENTRY, ENTRY])).toThrow(/duplicate/);
  });

  it('a non-production coupon id replaces the coupon of its kind’s entries, keeping ids and plans (R6, MUT-534, MUT-703)', () => {
    expect(offersFor({})).toBe(OFFERS);
    expect(offersFor({ launch: 'qa_offer_abc' })).toEqual([{ ...ENTRY, couponId: 'qa_offer_abc' }, STAY, COMEBACK, { ...PLAN_LAUNCH, couponId: 'qa_offer_abc' }, PLAN_STAY, PLAN_COMEBACK]);
    expect(offersFor({ stay: 'qa_stay_abc' })).toEqual([ENTRY, { ...STAY, couponId: 'qa_stay_abc' }, COMEBACK, PLAN_LAUNCH, { ...PLAN_STAY, couponId: 'qa_stay_abc' }, PLAN_COMEBACK]);
    // The per-currency pair replaces the legacy amount-off coupons only.
    expect(offersFor({ comeback: { ILS: 'qa_back_ils', USD: 'qa_back_usd' } })).toEqual([ENTRY, STAY, { ...COMEBACK, couponIds: { ILS: 'qa_back_ils', USD: 'qa_back_usd' } }, PLAN_LAUNCH, PLAN_STAY, PLAN_COMEBACK]);
  });

  it('never takes a stay coupon for the launch offer of a monthly Checkout (MUT-532)', async () => {
    const read: string[] = [];
    const stay = coupon({ id: 'mtb3a_stay_monthly_50', duration: 'repeating', durationInMonths: 2, redeemBy: null });
    expect(await resolveOffer([ENTRY, STAY], 'freelancer', 'month', async (id) => (read.push(id), stay), CATALOGS, NOW)).toBeNull();
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

  it('MUT-703: the entry’s products are exactly its plans’; the coupon must sit inside them and cover the plan sold', () => {
    expect(productsOf(['solo', 'business', 'firm'], CATALOGS)).toEqual(new Set(ALL_PLAN_PRODUCTS));
    expect(productsOf(['freelancer'], CATALOGS)).toEqual(new Set(['prod_FREELANCER']));
    expect(productsOf(['solo'], { legacy: CATALOG, plans: null })).toEqual(new Set());
    const products = productsOf(PLAN_LAUNCH.plans, CATALOGS);
    const plansCoupon = coupon({ id: PLAN_LAUNCH.couponId, appliesToProducts: ALL_PLAN_PRODUCTS });
    expect(offerFromCoupon(PLAN_LAUNCH, plansCoupon, products, NOW, new Set(['prod_firm']))?.id).toBe('launch-plans-2026');
    // Outside the entry's products (a Freelancer product too): no offer.
    expect(offerFromCoupon(PLAN_LAUNCH, coupon({ appliesToProducts: [...ALL_PLAN_PRODUCTS, 'prod_FREELANCER'] }), products, NOW, new Set(['prod_solo']))).toBeNull();
    // Inside, but not covering the plan sold: Stripe wouldn't discount the line, so no offer.
    expect(offerFromCoupon(PLAN_LAUNCH, coupon({ appliesToProducts: ['prod_solo', 'prod_business'] }), products, NOW, new Set(['prod_firm']))).toBeNull();
  });
});

describe('resolveOffer (D12): the first entry for the plan and interval whose coupon is an offer', () => {
  const second: OfferEntry = { id: 'spring-2027', couponId: 'mtb3a_spring_2027', kind: 'launch', interval: 'year', plans: ['freelancer'] };

  it('reads each yearly entry’s coupon in order and stops at the first offer', async () => {
    const read: string[] = [];
    const offer = await resolveOffer([ENTRY, second], 'freelancer', 'year', async (id) => (read.push(id), id === 'mtb3a_spring_2027' ? coupon({ id }) : null), CATALOGS, NOW);
    expect(offer?.id).toBe('spring-2027');
    expect(read).toEqual([ENTRY.couponId, 'mtb3a_spring_2027']);
  });

  it('never reads a coupon for an interval no entry has (R9d: no read on Monthly)', async () => {
    const read: string[] = [];
    expect(await resolveOffer([ENTRY], 'freelancer', 'month', async (id) => (read.push(id), coupon()), CATALOGS, NOW)).toBeNull();
    expect(read).toEqual([]);
  });

  it.each(PLANS)('MUT-703: %s yearly reads the plans’ launch coupon, never the Freelancer one', async (plan) => {
    const read: string[] = [];
    const offer = await resolveOffer(OFFERS, plan, 'year', async (id) => (read.push(id), coupon({ id, appliesToProducts: ALL_PLAN_PRODUCTS })), CATALOGS, NOW);
    expect(offer).toMatchObject({ id: 'launch-plans-2026', couponId: 'mtb3a_launch_yearly_plans_2026', percentOff: 50 });
    expect(read).toEqual(['mtb3a_launch_yearly_plans_2026']);
  });

  it('MUT-703: a plan whose catalog isn’t sold reads nothing', async () => {
    const read: string[] = [];
    expect(await resolveOffer(OFFERS, 'firm', 'year', async (id) => (read.push(id), coupon()), { legacy: CATALOG, plans: null }, NOW)).toBeNull();
    expect(read).toEqual([]);
  });
});

describe('offerEligible (D2, D3, MUT-703 §13 Q6)', () => {
  const offer = offerFromCoupon(ENTRY, coupon(), PRODUCTS, NOW)!;
  const LATER = new Date('2027-01-01T00:00:00.000Z');

  it('yearly with no subscription ever: yes', () => {
    expect(offerEligible(offer, [], 'year')).toBe(true);
  });

  it('monthly: no', () => {
    expect(offerEligible(offer, [], 'month')).toBe(false);
  });

  it.each(['canceled', 'trialing', 'active', 'past_due'])('anyone with a %s subscription that took money (or runs), ever: no', (status) => {
    expect(offerEligible(offer, [{ status, currentPeriodEnd: LATER }], 'year')).toBe(false);
  });

  it.each(['incomplete', 'incomplete_expired'])('a %s Checkout never took money: still yes', (status) => {
    expect(offerEligible(offer, [{ status, currentPeriodEnd: LATER }], 'year')).toBe(true);
  });

  it('a trial cancelled at or before its end never paid: still yes; one that ended later paid', () => {
    const trialEnd = new Date('2026-12-01T00:00:00.000Z');
    const unpaid = { status: 'canceled', currentPeriodEnd: trialEnd, trialEnd, endedAt: trialEnd };
    expect(tookMoney(unpaid)).toBe(false);
    expect(offerEligible(offer, [unpaid], 'year')).toBe(true);
    const paid = { ...unpaid, endedAt: LATER };
    expect(tookMoney(paid)).toBe(true);
    expect(offerEligible(offer, [paid], 'year')).toBe(false);
    // A trial still running can't switch into the launch.
    expect(offerEligible(offer, [{ ...unpaid, status: 'trialing', endedAt: null }], 'year')).toBe(false);
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
    // MUT-703 (§13 Q1): the plans' come-back, 67% off the first month.
    [3900, 67, 1287],
    [24900, 67, 8217],
    [1200, 67, 396],
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
