import { describe, expect, it } from 'vitest';
import type { Catalog } from '../checkout.js';
import { comebackOfferOf, comebackPlanOf, comebackRefusalOf, comebackStageOf, comebackSubscriptionRefusalOf, lapsedTierOf, percentComebackOfferOf, type ComebackFacts } from '../comeback.js';
import type { CouponFact, LegacyComebackEntry, OfferCatalogs, PercentComebackEntry } from '../offer.js';

/**
 * MUT-534 (plan D8–D14): the come-back offer. Pure: the coupon's shape and amounts, the stage a lapse is in, and who
 * may have the offer. The job, GET /v1/billing and Checkout read the facts; these decide.
 */
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2027-03-10T08:30:00Z');
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const ENTRY: LegacyComebackEntry = { id: 'comeback-2026', couponIds: { ILS: 'mtb3a_comeback_first_month_ils', USD: 'mtb3a_comeback_first_month_usd' }, kind: 'comeback', plans: ['freelancer'] };
const CATALOG: Catalog = {
  ILS: { month: { id: 'price_ils_m', unitAmount: 2900, productId: 'prod_F' }, year: { id: 'price_ils_y', unitAmount: 29000, productId: 'prod_F' } },
  USD: { month: { id: 'price_usd_m', unitAmount: 900, productId: 'prod_F' }, year: { id: 'price_usd_y', unitAmount: 9000, productId: 'prod_F' } },
};
/** One coupon per currency (Stripe's Checkout takes an amount off only in the coupon's own currency). */
const coupon = (over: Partial<CouponFact> = {}): CouponFact => ({
  id: ENTRY.couponIds.ILS,
  valid: true,
  percentOff: null,
  amountOff: 2000,
  amountOffIn: { ILS: 2000, USD: null },
  duration: 'once',
  durationInMonths: null,
  redeemBy: null,
  appliesToProducts: ['prod_F'],
  ...over,
});

const usd = (over: Partial<CouponFact> = {}) => coupon({ id: ENTRY.couponIds.USD, amountOff: 600, amountOffIn: { ILS: null, USD: 600 }, ...over });
const both = (ils: Partial<CouponFact> = {}, dollars: Partial<CouponFact> = {}) => ({ ILS: coupon(ils), USD: usd(dollars) });

describe('comebackOfferOf (D8)', () => {
  it('₪20 / $6 off once: ₪9 / $3 the first month back, ₪270 / $84 a first year, then the list prices', () => {
    expect(comebackOfferOf(ENTRY, both(), CATALOG)).toEqual({
      id: 'comeback-2026',
      plan: 'freelancer',
      percentOff: null,
      couponIds: { ILS: 'mtb3a_comeback_first_month_ils', USD: 'mtb3a_comeback_first_month_usd' },
      firstMonth: { ILS: 900, USD: 300 },
      listMonth: { ILS: 2900, USD: 900 },
      firstYear: { ILS: 27000, USD: 8400 },
      listYear: { ILS: 29000, USD: 9000 },
    });
  });

  it('a currency whose coupon is missing or wrongly shaped has no come-back price; with none at all there is no offer', () => {
    expect(comebackOfferOf(ENTRY, { ILS: coupon(), USD: null }, CATALOG)).toMatchObject({ firstMonth: { ILS: 900, USD: null }, couponIds: { ILS: 'mtb3a_comeback_first_month_ils', USD: null } });
    expect(comebackOfferOf(ENTRY, both({}, { amountOffIn: { ILS: 600, USD: null } }), CATALOG)).toMatchObject({ firstMonth: { ILS: 900, USD: null } });
    expect(comebackOfferOf(ENTRY, { ILS: null, USD: null }, CATALOG)).toBeNull();
  });

  it('anything not shaped as D8 says is no offer: a percent, not once, an amount not below the month, other products, gone', () => {
    const ilsOnly = (over: Partial<CouponFact>) => comebackOfferOf(ENTRY, { ILS: coupon(over), USD: null }, CATALOG);
    expect(ilsOnly({ percentOff: 50, amountOff: null, amountOffIn: { ILS: null, USD: null } })).toBeNull();
    expect(ilsOnly({ duration: 'repeating', durationInMonths: 2 })).toBeNull();
    expect(ilsOnly({ amountOffIn: { ILS: 2900, USD: null } })).toBeNull();
    expect(ilsOnly({ appliesToProducts: ['prod_F', 'prod_FIRM'] })).toBeNull();
    expect(ilsOnly({ appliesToProducts: null })).toBeNull();
    expect(ilsOnly({ valid: false })).toBeNull();
  });
});

describe('comebackStageOf (D11): two two-week windows', () => {
  it.each([
    [29, null],
    [30, 'day-30'],
    [43.9, 'day-30'],
    [44, null],
    [89, null],
    [90, 'day-90'],
    [103.9, 'day-90'],
    [104, null],
  ] as const)('%s days after the end: %s', (days, stage) => {
    expect(comebackStageOf(ago(days), NOW)).toBe(stage);
  });
});

describe('comebackSubscriptionRefusalOf: the checks the subscriptions alone settle (review: GET reads nothing more for them)', () => {
  const sub = (over: Partial<ComebackFacts['subscriptions'][number]> = {}) => ({ status: 'canceled', tier: 'FREELANCER' as const, endedAt: ago(35), offerId: null, ...over });
  it('paying, no lapse, too soon and already had it are refused from the subscriptions alone; otherwise nothing yet', () => {
    const ids = new Set(['comeback-2026']);
    expect(comebackSubscriptionRefusalOf([sub(), { ...sub(), status: 'active', endedAt: null }], ids, NOW)).toBe('PAYING');
    expect(comebackSubscriptionRefusalOf([], ids, NOW)).toBe('NO_LAPSE');
    expect(comebackSubscriptionRefusalOf([sub({ endedAt: ago(3) })], ids, NOW)).toBe('TOO_SOON');
    // MUT-703 (§13 Q5): a Firm lapse is a come-back like any other.
    expect(comebackSubscriptionRefusalOf([sub({ tier: 'FIRM' })], ids, NOW)).toBeNull();
    expect(comebackSubscriptionRefusalOf([sub({ offerId: 'comeback-2026' })], ids, NOW)).toBe('ALREADY_HAD');
    expect(comebackSubscriptionRefusalOf([sub()], ids, NOW)).toBeNull();
  });
});

describe('comebackRefusalOf (D12, D13)', () => {
  const lapsed = (over: Partial<ComebackFacts['subscriptions'][number]> = {}) => ({ status: 'canceled', tier: 'FREELANCER' as const, endedAt: ago(35), offerId: null, ...over });
  const facts = (over: Partial<ComebackFacts> = {}): ComebackFacts => ({ subscriptions: [lapsed()], events: [], covered: false, ownsProfile: true, comebackOfferIds: new Set(['comeback-2026']), ...over });
  const event = (kind: 'STAY_OFFER' | 'COMEBACK_OFFERED' | 'PAUSE', createdAt: Date, reason: string | null = null) => ({ kind, createdAt, reason });

  it('a Freelancer lapse 30+ days ago, nothing running, never had it: eligible (for the job); GET and Checkout also need it offered', () => {
    expect(comebackRefusalOf(facts(), NOW, { requireOffered: false })).toBeNull();
    expect(comebackRefusalOf(facts(), NOW, { requireOffered: true })).toBe('NOT_OFFERED');
    expect(comebackRefusalOf(facts({ events: [event('COMEBACK_OFFERED', ago(5), 'day-30')] }), NOW, { requireOffered: true })).toBeNull();
  });

  it('nothing may be running: active, trialing, past due, unpaid or paused all refuse (Checkout would too)', () => {
    for (const status of ['active', 'trialing', 'past_due', 'unpaid', 'paused', 'incomplete']) {
      expect(comebackRefusalOf(facts({ subscriptions: [lapsed(), { ...lapsed(), status, endedAt: null }] }), NOW, { requireOffered: false })).toBe('PAYING');
    }
  });

  it('needs a lapse 30 days old: none, or too recent, refuses', () => {
    expect(comebackRefusalOf(facts({ subscriptions: [] }), NOW, { requireOffered: false })).toBe('NO_LAPSE');
    expect(comebackRefusalOf(facts({ subscriptions: [lapsed({ status: 'incomplete_expired', endedAt: ago(40) })] }), NOW, { requireOffered: false })).toBe('NO_LAPSE');
    expect(comebackRefusalOf(facts({ subscriptions: [lapsed({ endedAt: ago(29) })] }), NOW, { requireOffered: false })).toBe('TOO_SOON');
  });

  it('MUT-703 (§13 Q5): any paid plan’s lapse counts, Firm included; the latest lapse names the plan', () => {
    for (const tier of ['FREELANCER', 'SOLO', 'BUSINESS', 'FIRM'] as const) {
      expect(comebackRefusalOf(facts({ subscriptions: [lapsed({ tier })] }), NOW, { requireOffered: false })).toBeNull();
    }
    const subs = [lapsed({ tier: 'BUSINESS', endedAt: ago(300) }), lapsed({ tier: 'FIRM', endedAt: ago(35) })];
    expect(lapsedTierOf(subs)).toBe('FIRM');
    expect(lapsedTierOf([])).toBeNull();
  });

  it('MUT-703: already had reads every come-back entry’s id, legacy and plans alike', () => {
    const ids = new Set(['comeback-2026', 'comeback-plans-2026']);
    expect(comebackRefusalOf(facts({ comebackOfferIds: ids, subscriptions: [lapsed({ offerId: 'comeback-2026', endedAt: ago(300) }), lapsed({ tier: 'SOLO' })] }), NOW, { requireOffered: false })).toBe('ALREADY_HAD');
    expect(comebackRefusalOf(facts({ comebackOfferIds: ids, subscriptions: [lapsed({ tier: 'SOLO', offerId: 'comeback-plans-2026', endedAt: ago(300) }), lapsed()] }), NOW, { requireOffered: false })).toBe('ALREADY_HAD');
  });

  it('once per person ever: a subscription that carried it refuses; an abandoned Checkout that never paid doesn’t use it up', () => {
    expect(comebackRefusalOf(facts({ subscriptions: [lapsed({ offerId: 'comeback-2026', endedAt: ago(300) }), lapsed()] }), NOW, { requireOffered: false })).toBe('ALREADY_HAD');
    expect(comebackRefusalOf(facts({ subscriptions: [lapsed(), lapsed({ status: 'incomplete_expired', offerId: 'comeback-2026', endedAt: ago(31) })] }), NOW, { requireOffered: false })).toBeNull();
  });

  it('no one who took the stay offer in the last 12 months (by when they took it); covered people never', () => {
    expect(comebackRefusalOf(facts({ events: [event('STAY_OFFER', ago(300))] }), NOW, { requireOffered: false })).toBe('STAY_OFFER_RECENT');
    expect(comebackRefusalOf(facts({ events: [event('STAY_OFFER', ago(400))] }), NOW, { requireOffered: false })).toBeNull();
    expect(comebackRefusalOf(facts({ covered: true }), NOW, { requireOffered: false })).toBe('COVERED');
    // Review: Checkout would refuse someone who owns no profile (NOTHING_TO_COVER), so they're never offered it.
    expect(comebackRefusalOf(facts({ ownsProfile: false }), NOW, { requireOffered: false })).toBe('NO_PROFILE');
  });
});

/** MUT-703 (ADR-340, §13 Q1/Q4/Q5): the plans' come-back, 67% off the first month of the plan chosen, monthly only. */
describe('percentComebackOfferOf (MUT-703)', () => {
  const PLAN_ENTRY: PercentComebackEntry = { id: 'comeback-plans-2026', couponId: 'mtb3a_comeback_first_month_plans_67', kind: 'comeback', interval: 'month', plans: ['solo', 'business', 'firm'] };
  const planCatalog = (plan: string, month: number, usd: number): Catalog => ({
    ILS: { month: { id: `price_${plan}_m_ils`, unitAmount: month, productId: `prod_${plan}` }, year: { id: `price_${plan}_y_ils`, unitAmount: month * 10, productId: `prod_${plan}` } },
    USD: { month: { id: `price_${plan}_m_usd`, unitAmount: usd, productId: `prod_${plan}` }, year: { id: `price_${plan}_y_usd`, unitAmount: usd * 10, productId: `prod_${plan}` } },
  });
  const CATALOGS: OfferCatalogs = { legacy: CATALOG, plans: { solo: planCatalog('solo', 3900, 1200), business: planCatalog('business', 8900, 2700), firm: planCatalog('firm', 24900, 7500) } };
  const percent = (over: Partial<CouponFact> = {}): CouponFact => ({
    ...coupon(),
    id: PLAN_ENTRY.couponId,
    percentOff: 67,
    amountOff: null,
    amountOffIn: { ILS: null, USD: null },
    appliesToProducts: ['prod_solo', 'prod_business', 'prod_firm'],
    ...over,
  });

  it.each([
    ['solo', { ILS: 1287, USD: 396 }, { ILS: 3900, USD: 1200 }],
    ['business', { ILS: 2937, USD: 891 }, { ILS: 8900, USD: 2700 }],
    ['firm', { ILS: 8217, USD: 2475 }, { ILS: 24900, USD: 7500 }],
  ] as const)('%s: the first month back after 67%% off, both currencies from one coupon, no yearly price (Q4)', (plan, firstMonth, listMonth) => {
    expect(percentComebackOfferOf(PLAN_ENTRY, percent(), CATALOGS, plan)).toEqual({
      id: 'comeback-plans-2026',
      plan,
      percentOff: 67,
      couponIds: { ILS: 'mtb3a_comeback_first_month_plans_67', USD: 'mtb3a_comeback_first_month_plans_67' },
      firstMonth,
      listMonth,
      firstYear: { ILS: null, USD: null },
      listYear: { ILS: null, USD: null },
    });
  });

  it('an entry with no interval offers a first year too', () => {
    expect(percentComebackOfferOf({ ...PLAN_ENTRY, interval: null }, percent(), CATALOGS, 'solo')).toMatchObject({ firstYear: { ILS: 12870, USD: 3960 }, listYear: { ILS: 39000, USD: 12000 } });
  });

  it('a coupon not shaped as the plans’ come-back is no offer', () => {
    const shapes: Partial<CouponFact>[] = [
      { valid: false },
      { percentOff: null, amountOff: 2000 },
      { percentOff: 0 },
      { percentOff: 100 },
      { duration: 'repeating', durationInMonths: 2 },
      { appliesToProducts: null },
      { appliesToProducts: ['prod_solo', 'prod_business', 'prod_firm', 'prod_F'] },
      { appliesToProducts: ['prod_solo'] },
    ];
    for (const over of shapes) expect(percentComebackOfferOf(PLAN_ENTRY, percent(over), CATALOGS, 'firm')).toBeNull();
    expect(percentComebackOfferOf(PLAN_ENTRY, null, CATALOGS, 'solo')).toBeNull();
    expect(percentComebackOfferOf(PLAN_ENTRY, percent(), { legacy: CATALOG, plans: null }, 'solo')).toBeNull();
  });

  it('a currency the plan isn’t sold in has no come-back price there', () => {
    const catalogs: OfferCatalogs = { ...CATALOGS, plans: { ...CATALOGS.plans!, firm: { ...CATALOGS.plans!.firm, USD: null } } };
    expect(percentComebackOfferOf(PLAN_ENTRY, percent(), catalogs, 'firm')).toMatchObject({ firstMonth: { ILS: 8217, USD: null }, couponIds: { ILS: 'mtb3a_comeback_first_month_plans_67', USD: null } });
  });

  it('the plan a come-back names: the lapsed plan, a legacy Freelancer lapse is offered Solo (§13 Q5)', () => {
    expect(comebackPlanOf('FREELANCER')).toBe('solo');
    expect(comebackPlanOf('SOLO')).toBe('solo');
    expect(comebackPlanOf('BUSINESS')).toBe('business');
    expect(comebackPlanOf('FIRM')).toBe('firm');
    expect(comebackPlanOf('ACCOUNTANT')).toBeNull();
    expect(comebackPlanOf(null)).toBeNull();
  });
});
