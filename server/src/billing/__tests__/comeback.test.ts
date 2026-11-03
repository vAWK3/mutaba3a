import { describe, expect, it } from 'vitest';
import type { Catalog } from '../checkout.js';
import { comebackOfferOf, comebackRefusalOf, comebackStageOf, type ComebackFacts } from '../comeback.js';
import type { ComebackOfferEntry, CouponFact } from '../offer.js';

/**
 * MUT-534 (plan D8–D14): the come-back offer. Pure: the coupon's shape and amounts, the stage a lapse is in, and who
 * may have the offer. The job, GET /v1/billing and Checkout read the facts; these decide.
 */
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2027-03-10T08:30:00Z');
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const ENTRY: ComebackOfferEntry = { id: 'comeback-2026', couponId: 'mtb3a_comeback_first_month', kind: 'comeback', tier: 'freelancer' };
const CATALOG: Catalog = {
  ILS: { month: { id: 'price_ils_m', unitAmount: 2900, productId: 'prod_F' }, year: { id: 'price_ils_y', unitAmount: 29000, productId: 'prod_F' } },
  USD: { month: { id: 'price_usd_m', unitAmount: 900, productId: 'prod_F' }, year: { id: 'price_usd_y', unitAmount: 9000, productId: 'prod_F' } },
};
const coupon = (over: Partial<CouponFact> = {}): CouponFact => ({
  id: ENTRY.couponId,
  valid: true,
  percentOff: null,
  amountOff: 2000,
  amountOffIn: { ILS: 2000, USD: 600 },
  duration: 'once',
  durationInMonths: null,
  redeemBy: null,
  appliesToProducts: ['prod_F'],
  ...over,
});

describe('comebackOfferOf (D8)', () => {
  it('₪20 / $6 off once: ₪9 / $3 the first month back, ₪270 / $84 a first year, then the list prices', () => {
    expect(comebackOfferOf(ENTRY, coupon(), CATALOG)).toEqual({
      id: 'comeback-2026',
      couponId: 'mtb3a_comeback_first_month',
      firstMonth: { ILS: 900, USD: 300 },
      listMonth: { ILS: 2900, USD: 900 },
      firstYear: { ILS: 27000, USD: 8400 },
      listYear: { ILS: 29000, USD: 9000 },
    });
  });

  it('a currency with no amount in the coupon has no come-back price; with none at all there is no offer', () => {
    expect(comebackOfferOf(ENTRY, coupon({ amountOffIn: { ILS: 2000, USD: null } }), CATALOG)).toMatchObject({ firstMonth: { ILS: 900, USD: null } });
    expect(comebackOfferOf(ENTRY, coupon({ amountOffIn: { ILS: null, USD: null } }), CATALOG)).toBeNull();
  });

  it('anything not shaped as D8 says is no offer: a percent, not once, an amount not below the month, other products, gone', () => {
    expect(comebackOfferOf(ENTRY, coupon({ percentOff: 50, amountOff: null, amountOffIn: { ILS: null, USD: null } }), CATALOG)).toBeNull();
    expect(comebackOfferOf(ENTRY, coupon({ duration: 'repeating', durationInMonths: 2 }), CATALOG)).toBeNull();
    expect(comebackOfferOf(ENTRY, coupon({ amountOffIn: { ILS: 2900, USD: 600 } }), CATALOG)).toBeNull();
    expect(comebackOfferOf(ENTRY, coupon({ appliesToProducts: ['prod_F', 'prod_FIRM'] }), CATALOG)).toBeNull();
    expect(comebackOfferOf(ENTRY, coupon({ appliesToProducts: null }), CATALOG)).toBeNull();
    expect(comebackOfferOf(ENTRY, coupon({ valid: false }), CATALOG)).toBeNull();
    expect(comebackOfferOf(ENTRY, null, CATALOG)).toBeNull();
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

describe('comebackRefusalOf (D12, D13)', () => {
  const lapsed = (over: Partial<ComebackFacts['subscriptions'][number]> = {}) => ({ status: 'canceled', tier: 'FREELANCER' as const, endedAt: ago(35), offerId: null, ...over });
  const facts = (over: Partial<ComebackFacts> = {}): ComebackFacts => ({ subscriptions: [lapsed()], events: [], covered: false, comebackOfferIds: new Set(['comeback-2026']), ...over });
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
  });
});
