import { describe, expect, it } from 'vitest';
import type { Catalog } from '../checkout.js';
import type { CouponFact } from '../offer.js';
import {
  cycleBoundaryAfter,
  listMonthlyCurrencyOf,
  PAUSE_RESUME_LEAD_MS,
  pauseOptionsOf,
  stayOfferOf,
  SWITCH_AFTER_PAID_INVOICES,
  yearlySavingsOf,
  yearlySwitchOf,
  type PlanFacts,
  type RetentionEventFact,
  type RetentionSubject,
  type SwitchSubscription,
} from '../retention.js';

/**
 * MUT-531 (plan D2–D4, D13): who may switch from monthly to yearly, and what the switch saves. Pure: the route reads
 * the mirror, the catalog and Stripe's own facts (paid invoices, discounts); this decides.
 */

const CATALOG: Catalog = {
  ILS: { month: { id: 'price_ils_m', unitAmount: 2900, productId: 'prod_F' }, year: { id: 'price_ils_y', unitAmount: 29000, productId: 'prod_F' } },
  USD: { month: { id: 'price_usd_m', unitAmount: 900, productId: 'prod_F' }, year: { id: 'price_usd_y', unitAmount: 9000, productId: 'prod_F' } },
};

const monthly = (over: Partial<SwitchSubscription> = {}): SwitchSubscription => ({
  status: 'active',
  priceLookupKey: 'freelancer_list_monthly_ils',
  cancelAtPeriodEnd: false,
  ...over,
});
const facts = (over: Partial<PlanFacts> = {}): PlanFacts => ({ paidInvoices: 2, discounted: false, paused: false, ...over });

describe('listMonthlyCurrencyOf', () => {
  it('reads the currency of a monthly list price, and nothing else', () => {
    expect(listMonthlyCurrencyOf('freelancer_list_monthly_ils')).toBe('ILS');
    expect(listMonthlyCurrencyOf('freelancer_list_monthly_usd')).toBe('USD');
    expect(listMonthlyCurrencyOf('freelancer_list_yearly_ils')).toBeNull();
    expect(listMonthlyCurrencyOf('freelancer_founder_monthly_ils')).toBeNull();
    expect(listMonthlyCurrencyOf(null)).toBeNull();
  });
});

describe('yearlySavingsOf (D3: computed from the catalog, never written down)', () => {
  it('is twelve months less the year, in minor units of that currency', () => {
    expect(yearlySavingsOf(CATALOG, 'ILS')).toBe(5800);
    expect(yearlySavingsOf(CATALOG, 'USD')).toBe(1800);
  });

  it('follows the catalog when the prices change', () => {
    const changed: Catalog = { ...CATALOG, ILS: { month: { ...CATALOG.ILS!.month, unitAmount: 3900 }, year: { ...CATALOG.ILS!.year, unitAmount: 39000 } } };
    expect(yearlySavingsOf(changed, 'ILS')).toBe(7800);
  });

  it('is null when the year saves nothing or the currency has no prices', () => {
    const flat: Catalog = { ...CATALOG, USD: { month: CATALOG.USD!.month, year: { ...CATALOG.USD!.year, unitAmount: 10800 } } };
    expect(yearlySavingsOf(flat, 'USD')).toBeNull();
    expect(yearlySavingsOf({ ILS: null, USD: CATALOG.USD }, 'ILS')).toBeNull();
  });
});

describe('yearlySwitchOf (D2: from the 2nd paid invoice, a monthly list price only)', () => {
  it('offers the yearly price of the same currency with the saving', () => {
    expect(yearlySwitchOf(monthly(), facts(), CATALOG)).toEqual({ ok: true, currency: 'ILS', yearly: CATALOG.ILS!.year, savings: 5800 });
    expect(yearlySwitchOf(monthly({ priceLookupKey: 'freelancer_list_monthly_usd' }), facts(), CATALOG)).toEqual({ ok: true, currency: 'USD', yearly: CATALOG.USD!.year, savings: 1800 });
  });

  it(`needs ${SWITCH_AFTER_PAID_INVOICES} paid invoices: before that it is too early`, () => {
    expect(yearlySwitchOf(monthly(), facts({ paidInvoices: 0 }), CATALOG)).toEqual({ ok: false, refusal: 'TOO_EARLY' });
    expect(yearlySwitchOf(monthly(), facts({ paidInvoices: 1 }), CATALOG)).toEqual({ ok: false, refusal: 'TOO_EARLY' });
    expect(yearlySwitchOf(monthly(), facts({ paidInvoices: 3 }), CATALOG)).toMatchObject({ ok: true });
  });

  it('never offers it on a yearly, founder or unknown price (D5)', () => {
    for (const priceLookupKey of ['freelancer_list_yearly_ils', 'freelancer_founder_monthly_ils', 'firm_founder_monthly_ils', null]) {
      expect(yearlySwitchOf(monthly({ priceLookupKey }), facts(), CATALOG)).toEqual({ ok: false, refusal: 'NOT_MONTHLY_LIST' });
    }
  });

  it('needs an active subscription', () => {
    for (const status of ['trialing', 'past_due', 'unpaid', 'canceled', 'paused', 'incomplete']) {
      expect(yearlySwitchOf(monthly({ status }), facts(), CATALOG)).toEqual({ ok: false, refusal: 'NOT_ACTIVE' });
    }
  });

  it('is not offered while the plan is cancelling, paused or discounted (D4, D13)', () => {
    expect(yearlySwitchOf(monthly({ cancelAtPeriodEnd: true }), facts(), CATALOG)).toEqual({ ok: false, refusal: 'CANCELLING' });
    expect(yearlySwitchOf(monthly(), facts({ paused: true }), CATALOG)).toEqual({ ok: false, refusal: 'PAUSED' });
    expect(yearlySwitchOf(monthly(), facts({ discounted: true }), CATALOG)).toEqual({ ok: false, refusal: 'DISCOUNTED' });
  });

  it('needs the yearly price on sale in that currency', () => {
    expect(yearlySwitchOf(monthly(), facts(), { ILS: null, USD: CATALOG.USD })).toEqual({ ok: false, refusal: 'NO_PRICE' });
  });

  it('still offers the switch when the year saves nothing, with no saving to show', () => {
    const flat: Catalog = { ...CATALOG, ILS: { month: CATALOG.ILS!.month, year: { ...CATALOG.ILS!.year, unitAmount: 34800 } } };
    expect(yearlySwitchOf(monthly(), facts(), flat)).toEqual({ ok: true, currency: 'ILS', yearly: flat.ILS!.year, savings: null });
  });
});

/** MUT-532 (plan D6, D10, D11, ADR-240): pause instead of cancel, and the stay offer. */
const at = (iso: string) => new Date(iso);

describe('cycleBoundaryAfter (Stripe\'s monthly rule: the anchor\'s day, clamped to the month, at the anchor\'s time)', () => {
  it('counts months from the first boundary at or after `from` (the spike: Dec 2 + 2 months = Feb 2)', () => {
    const anchor = at('2026-10-02T13:25:49.000Z');
    expect(cycleBoundaryAfter(anchor, at('2026-12-02T13:25:49.000Z'), 2)).toEqual(at('2027-02-02T13:25:49.000Z'));
    expect(cycleBoundaryAfter(anchor, at('2026-12-02T13:25:49.000Z'), 0)).toEqual(at('2026-12-02T13:25:49.000Z'));
    expect(cycleBoundaryAfter(anchor, at('2026-11-20T00:00:00.000Z'), 1)).toEqual(at('2027-01-02T13:25:49.000Z'));
  });

  it('clamps a 31st to the month\'s last day and comes back to the 31st (Jan 31 → Feb 28 → Mar 31)', () => {
    const anchor = at('2027-01-31T09:00:00.000Z');
    expect(cycleBoundaryAfter(anchor, at('2027-01-31T09:00:00.000Z'), 1)).toEqual(at('2027-02-28T09:00:00.000Z'));
    expect(cycleBoundaryAfter(anchor, at('2027-02-28T09:00:00.000Z'), 1)).toEqual(at('2027-03-31T09:00:00.000Z'));
    expect(cycleBoundaryAfter(anchor, at('2027-01-31T09:00:00.000Z'), 3)).toEqual(at('2027-04-30T09:00:00.000Z'));
  });

  it('gives Feb 29 in a leap year', () => {
    expect(cycleBoundaryAfter(at('2027-12-31T09:00:00.000Z'), at('2028-01-31T09:00:00.000Z'), 1)).toEqual(at('2028-02-29T09:00:00.000Z'));
    expect(cycleBoundaryAfter(at('2028-01-30T09:00:00.000Z'), at('2028-01-30T09:00:00.000Z'), 1)).toEqual(at('2028-02-29T09:00:00.000Z'));
  });

  it('crosses a year', () => {
    expect(cycleBoundaryAfter(at('2026-11-15T10:00:00.000Z'), at('2026-12-15T10:00:00.000Z'), 3)).toEqual(at('2027-03-15T10:00:00.000Z'));
  });
});

const NOW = at('2026-11-20T12:00:00.000Z');
const subject = (over: Partial<RetentionSubject> = {}): RetentionSubject => ({
  status: 'active',
  priceLookupKey: 'freelancer_list_monthly_ils',
  cancelAtPeriodEnd: false,
  paused: false,
  discounted: false,
  currentPeriodEnd: at('2026-12-02T13:00:00.000Z'),
  billingCycleAnchor: at('2026-10-02T13:00:00.000Z'),
  ...over,
});
const pauseEvent = (over: Partial<RetentionEventFact> = {}): RetentionEventFact => ({ kind: 'PAUSE', startsAt: at('2026-03-02T13:00:00.000Z'), endedEarlyAt: null, ...over });

describe('pauseOptionsOf (D6, D10: 1–3 months from the paid period\'s end, monthly list payers, once in 12 months)', () => {
  it('offers 1, 2 and 3 months from the period end, each restarting on a cycle boundary, resuming an hour before it', () => {
    const result = pauseOptionsOf(subject(), 1, [], NOW);
    expect(result).toEqual({
      ok: true,
      options: [
        { months: 1, from: at('2026-12-02T13:00:00.000Z'), until: at('2027-01-02T13:00:00.000Z'), resumesAt: new Date(at('2027-01-02T13:00:00.000Z').getTime() - PAUSE_RESUME_LEAD_MS) },
        { months: 2, from: at('2026-12-02T13:00:00.000Z'), until: at('2027-02-02T13:00:00.000Z'), resumesAt: new Date(at('2027-02-02T13:00:00.000Z').getTime() - PAUSE_RESUME_LEAD_MS) },
        { months: 3, from: at('2026-12-02T13:00:00.000Z'), until: at('2027-03-02T13:00:00.000Z'), resumesAt: new Date(at('2027-03-02T13:00:00.000Z').getTime() - PAUSE_RESUME_LEAD_MS) },
      ],
    });
  });

  it('needs one paid invoice: a trialist has nothing to pause', () => {
    expect(pauseOptionsOf(subject(), 0, [], NOW)).toEqual({ ok: false, refusal: 'TOO_EARLY' });
  });

  it('is monthly list only: yearly (a void would cancel a whole year) and founder prices never pause', () => {
    for (const priceLookupKey of ['freelancer_list_yearly_ils', 'freelancer_founder_monthly_ils', 'firm_founder_monthly_usd', null]) {
      expect(pauseOptionsOf(subject({ priceLookupKey }), 3, [], NOW)).toEqual({ ok: false, refusal: 'NOT_MONTHLY_LIST' });
    }
  });

  it('needs an active plan that is not cancelling, pausing or paused', () => {
    expect(pauseOptionsOf(subject({ status: 'past_due' }), 3, [], NOW)).toEqual({ ok: false, refusal: 'NOT_ACTIVE' });
    expect(pauseOptionsOf(subject({ cancelAtPeriodEnd: true }), 3, [], NOW)).toEqual({ ok: false, refusal: 'CANCELLING' });
    expect(pauseOptionsOf(subject({ paused: true }), 3, [], NOW)).toEqual({ ok: false, refusal: 'PAUSED' });
  });

  it('is once in 12 months, counted from when the last pause started', () => {
    expect(pauseOptionsOf(subject(), 3, [pauseEvent({ startsAt: at('2025-12-21T12:00:00.000Z') })], NOW)).toEqual({ ok: false, refusal: 'ONCE_A_YEAR' });
    expect(pauseOptionsOf(subject(), 3, [pauseEvent({ startsAt: at('2025-11-20T12:00:00.000Z') })], NOW)).toMatchObject({ ok: true });
  });

  it('does not count a pause undone before it started (D7: Don\'t pause), but counts one resumed early', () => {
    const undone = pauseEvent({ startsAt: at('2026-12-02T13:00:00.000Z'), endedEarlyAt: at('2026-11-10T00:00:00.000Z') });
    expect(pauseOptionsOf(subject(), 3, [undone], NOW)).toMatchObject({ ok: true });
    const resumed = pauseEvent({ startsAt: at('2026-06-02T13:00:00.000Z'), endedEarlyAt: at('2026-06-20T00:00:00.000Z') });
    expect(pauseOptionsOf(subject(), 3, [resumed], NOW)).toEqual({ ok: false, refusal: 'ONCE_A_YEAR' });
  });

  it('ignores other kinds of event', () => {
    expect(pauseOptionsOf(subject(), 3, [{ kind: 'STAY_OFFER', startsAt: NOW, endedEarlyAt: null }], NOW)).toMatchObject({ ok: true });
  });

  it('needs Stripe\'s period end and billing anchor', () => {
    expect(pauseOptionsOf(subject({ currentPeriodEnd: null }), 3, [], NOW)).toEqual({ ok: false, refusal: 'NO_PERIOD' });
    expect(pauseOptionsOf(subject({ billingCycleAnchor: null }), 3, [], NOW)).toEqual({ ok: false, refusal: 'NO_PERIOD' });
  });
});

const PRODUCTS_CATALOG = CATALOG;
const stayCoupon = (over: Partial<CouponFact> = {}): CouponFact => ({
  id: 'mtb3a_stay_monthly_50',
  valid: true,
  percentOff: 50,
  amountOff: null,
  amountOffIn: { ILS: null, USD: null },
  duration: 'repeating',
  durationInMonths: 2,
  redeemBy: null,
  appliesToProducts: ['prod_F'],
  ...over,
});

describe('stayOfferOf (D11: 2 months at 50%, once per person ever, monthly list payers only)', () => {
  it('reads the percent and the months from the coupon, and halves the price with Stripe\'s rounding', () => {
    expect(stayOfferOf(subject(), [], stayCoupon(), PRODUCTS_CATALOG)).toEqual({
      ok: true,
      offer: { couponId: 'mtb3a_stay_monthly_50', percentOff: 50, months: 2, currency: 'ILS', monthlyAmount: 1450, listAmount: 2900 },
    });
    expect(stayOfferOf(subject({ priceLookupKey: 'freelancer_list_monthly_usd' }), [], stayCoupon(), PRODUCTS_CATALOG)).toMatchObject({ ok: true, offer: { currency: 'USD', monthlyAmount: 450, listAmount: 900 } });
  });

  it('is once per person ever (rule 2)', () => {
    expect(stayOfferOf(subject(), [{ kind: 'STAY_OFFER', startsAt: at('2024-01-01T00:00:00.000Z'), endedEarlyAt: null }], stayCoupon(), PRODUCTS_CATALOG)).toEqual({ ok: false, refusal: 'ALREADY_HAD' });
  });

  it('is monthly list only: never founders (rule 3) or yearly', () => {
    for (const priceLookupKey of ['freelancer_list_yearly_ils', 'freelancer_founder_monthly_ils', null]) {
      expect(stayOfferOf(subject({ priceLookupKey }), [], stayCoupon(), PRODUCTS_CATALOG)).toEqual({ ok: false, refusal: 'NOT_MONTHLY_LIST' });
    }
  });

  it('never stacks on a discount (rule 1), and needs an active plan that is not cancelling or paused', () => {
    expect(stayOfferOf(subject({ discounted: true }), [], stayCoupon(), PRODUCTS_CATALOG)).toEqual({ ok: false, refusal: 'DISCOUNTED' });
    expect(stayOfferOf(subject({ status: 'past_due' }), [], stayCoupon(), PRODUCTS_CATALOG)).toEqual({ ok: false, refusal: 'NOT_ACTIVE' });
    expect(stayOfferOf(subject({ cancelAtPeriodEnd: true }), [], stayCoupon(), PRODUCTS_CATALOG)).toEqual({ ok: false, refusal: 'CANCELLING' });
    expect(stayOfferOf(subject({ paused: true }), [], stayCoupon(), PRODUCTS_CATALOG)).toEqual({ ok: false, refusal: 'PAUSED' });
  });

  it('needs a stay-shaped coupon: valid, a percentage, repeating for some months, Freelancer products only', () => {
    const shapes: Partial<CouponFact>[] = [
      { valid: false },
      { percentOff: null, amountOff: 1000 },
      { percentOff: 0 },
      { duration: 'once' },
      { duration: 'forever' },
      { durationInMonths: null },
      { appliesToProducts: null },
      { appliesToProducts: [] },
      { appliesToProducts: ['prod_F', 'prod_FIRM'] },
    ];
    for (const over of shapes) expect(stayOfferOf(subject(), [], stayCoupon(over), PRODUCTS_CATALOG)).toEqual({ ok: false, refusal: 'NO_COUPON' });
    expect(stayOfferOf(subject(), [], null, PRODUCTS_CATALOG)).toEqual({ ok: false, refusal: 'NO_COUPON' });
  });

  it('needs the monthly price on sale in that currency', () => {
    expect(stayOfferOf(subject(), [], stayCoupon(), { ILS: null, USD: CATALOG.USD })).toEqual({ ok: false, refusal: 'NO_PRICE' });
  });
});
