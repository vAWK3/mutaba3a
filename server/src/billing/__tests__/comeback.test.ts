import { describe, expect, it } from 'vitest';
import type { Catalog } from '../checkout.js';
import { comebackOfferOf, comebackRefusalOf, comebackStageOf, comebackSubscriptionRefusalOf, type ComebackFacts } from '../comeback.js';
import type { ComebackOfferEntry, CouponFact } from '../offer.js';

/**
 * MUT-534 (plan D8–D14): the come-back offer. Pure: the coupon's shape and amounts, the stage a lapse is in, and who
 * may have the offer. The job, GET /v1/billing and Checkout read the facts; these decide.
 */
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2027-03-10T08:30:00Z');
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const ENTRY: ComebackOfferEntry = { id: 'comeback-2026', couponIds: { ILS: 'mtb3a_comeback_first_month_ils', USD: 'mtb3a_comeback_first_month_usd' }, kind: 'comeback', tier: 'freelancer' };
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
  it('paying, no lapse, too soon, Firm and already had it are refused from the subscriptions alone; otherwise nothing yet', () => {
    const ids = new Set(['comeback-2026']);
    expect(comebackSubscriptionRefusalOf([sub(), { ...sub(), status: 'active', endedAt: null }], ids, NOW)).toBe('PAYING');
    expect(comebackSubscriptionRefusalOf([], ids, NOW)).toBe('NO_LAPSE');
    expect(comebackSubscriptionRefusalOf([sub({ endedAt: ago(3) })], ids, NOW)).toBe('TOO_SOON');
    expect(comebackSubscriptionRefusalOf([sub({ tier: 'FIRM' })], ids, NOW)).toBe('FIRM');
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

  it('the latest lapse decides: a lapsed Firm payer gets no Freelancer come-back (Basel)', () => {
    expect(comebackRefusalOf(facts({ subscriptions: [lapsed({ tier: 'FIRM' })] }), NOW, { requireOffered: false })).toBe('FIRM');
    expect(comebackRefusalOf(facts({ subscriptions: [lapsed({ endedAt: ago(300) }), lapsed({ tier: 'FIRM', endedAt: ago(35) })] }), NOW, { requireOffered: false })).toBe('FIRM');
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
