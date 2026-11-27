import { describe, expect, it } from 'vitest';
import { COUPON_SPEC, couponActions, describeAction, PLAN_SPEC, planActions, RETIRED_COUPON_IDS, type CatalogState, type CouponState } from '../stripe-plans.js';
import { OFFERS } from '../../billing/offer.js';

/** MUT-702 Part B (ADR-288): the catalog script's pure core, the one place the plans' amounts are written. */
const EMPTY: CatalogState = { products: [], prices: [], taxRates: [], coupons: [] };
const VAT = { id: 'txr_il', active: true, inclusive: false, country: 'IL', percentage: 18, metadata: { mtb3a_vat: 'IL' } };

/** A coupon exactly as COUPON_SPEC makes it, on the plans' products (`prod_<plan>`). */
const couponOf = (row: (typeof COUPON_SPEC)[number]): CouponState => ({
  id: row.id,
  name: row.name,
  percentOff: row.percentOff,
  duration: row.duration,
  durationInMonths: row.durationInMonths ?? null,
  redeemBy: row.redeemBy ? Math.floor(Date.parse(row.redeemBy) / 1000) : null,
  appliesToProducts: row.plans.map((plan) => `prod_${plan}`),
  metadata: { ...row.metadata },
});

/** The catalog as the script leaves it. */
function complete(): CatalogState {
  const products = PLAN_SPEC.map((row) => ({ id: `prod_${row.plan}`, name: row.name, active: true, metadata: { tier: row.plan, mtb3a_plan: row.plan } }));
  const prices = PLAN_SPEC.flatMap((row) =>
    (['ILS', 'USD'] as const).flatMap((currency) =>
      (['month', 'year'] as const).map((interval) => ({
        id: `price_${row.plan}_${currency}_${interval}`,
        lookupKey: `${row.plan}_list_${interval === 'month' ? 'monthly' : 'yearly'}_${currency.toLowerCase()}`,
        productId: `prod_${row.plan}`,
        currency,
        unitAmount: row.prices[currency][interval],
        interval,
        taxBehavior: 'exclusive',
        active: true,
      })),
    ),
  );
  return { products, prices, taxRates: [VAT], coupons: COUPON_SPEC.map(couponOf) };
}

describe('PLAN_SPEC (Basel, 2026-11-22 and 2026-11-26 Q6)', () => {
  it('prices each plan before tax, a year at ten months', () => {
    expect(PLAN_SPEC.map((r) => [r.plan, r.prices.ILS.month, r.prices.USD.month])).toEqual([
      ['solo', 3900, 1200],
      ['business', 8900, 2700],
      ['firm', 24900, 7500],
    ]);
    for (const row of PLAN_SPEC) for (const c of ['ILS', 'USD'] as const) expect(row.prices[c].year).toBe(row.prices[c].month * 10);
  });
});

describe('planActions', () => {
  it('an empty catalog gets three products and twelve prices', () => {
    const actions = planActions(EMPTY);
    expect(actions.filter((a) => a.kind === 'create-vat-rate')).toHaveLength(1);
    expect(actions.filter((a) => a.kind === 'create-product').map((a) => a.plan)).toEqual(['solo', 'business', 'firm']);
    const prices = actions.filter((a) => a.kind === 'create-price');
    expect(prices).toHaveLength(12);
    expect(prices.find((a) => a.kind === 'create-price' && a.lookupKey === 'firm_list_yearly_ils')).toMatchObject({ unitAmount: 249000, currency: 'ILS', interval: 'year', transfer: false });
  });

  it('makes the Israeli VAT rate at the configured percent once (Stripe Tax has no Israel registration)', () => {
    expect(planActions(EMPTY)[0]).toEqual({ kind: 'create-vat-rate', percentage: 18 });
    const state = complete();
    state.taxRates = [{ ...VAT, percentage: 17 }];
    expect(planActions(state)).toEqual([{ kind: 'create-vat-rate', percentage: 18 }]);
    // The rate is billing-countries.json's: a new percent makes a new rate; none configured makes none.
    expect(planActions(complete(), undefined, 17)).toEqual([{ kind: 'create-vat-rate', percentage: 17 }]);
    expect(planActions(EMPTY, undefined, null).some((a) => a.kind === 'create-vat-rate')).toBe(false);
  });

  it('a complete catalog has nothing to do', () => {
    expect(planActions(complete())).toEqual([]);
  });

  it('Firm at the old ₪149 gets a new price and the key moves to it (subscriptions on the old one keep it)', () => {
    const state = complete();
    const old = state.prices.find((p) => p.lookupKey === 'firm_list_monthly_ils')!;
    old.unitAmount = 14900;
    expect(planActions(state)).toEqual([{ kind: 'create-price', plan: 'firm', lookupKey: 'firm_list_monthly_ils', currency: 'ILS', unitAmount: 24900, interval: 'month', transfer: true }]);
  });

  it('a key on an inclusive price, or on another plan’s product, moves too', () => {
    const state = complete();
    state.prices.find((p) => p.lookupKey === 'solo_list_monthly_usd')!.taxBehavior = 'inclusive';
    state.prices.find((p) => p.lookupKey === 'business_list_yearly_usd')!.productId = 'prod_solo';
    expect(planActions(state).map((a) => a.kind === 'create-price' && [a.lookupKey, a.transfer])).toEqual([
      ['solo_list_monthly_usd', true],
      ['business_list_yearly_usd', true],
    ]);
  });

  it('an existing Firm product tagged only `tier: firm` is adopted and tagged, not duplicated', () => {
    const state = complete();
    state.products = state.products.map((p) => (p.id === 'prod_firm' ? { ...p, metadata: { tier: 'firm' } } : p));
    expect(planActions(state)).toEqual([{ kind: 'tag-product', plan: 'firm', productId: 'prod_firm' }]);
  });

  it('never touches Freelancer or Accountant products and prices', () => {
    const state = complete();
    state.products.push({ id: 'prod_F', name: 'Freelancer', active: true, metadata: { tier: 'freelancer' } }, { id: 'prod_A', name: 'Accountant', active: true, metadata: { tier: 'accountant' } });
    state.prices.push({ id: 'price_f', lookupKey: 'freelancer_list_monthly_ils', productId: 'prod_F', currency: 'ILS', unitAmount: 2900, interval: 'month', taxBehavior: 'exclusive', active: true });
    expect(planActions(state)).toEqual([]);
  });
});

/** MUT-703 (ADR-340, §4, §13): the three plan coupons, made only here. */
describe('COUPON_SPEC (Basel, 2026-11-27, §13 defaults)', () => {
  it('launch 50% once until 21 Feb 2027 (Jerusalem), stay 50% for 2 months, come-back 67% once; all on Solo, Business and Firm only', () => {
    expect(COUPON_SPEC.map((r) => [r.id, r.percentOff, r.duration, r.durationInMonths ?? null, r.redeemBy ?? null, r.metadata.mtb3a_offer])).toEqual([
      ['mtb3a_launch_yearly_plans_2026', 50, 'once', null, '2027-02-21T22:59:00.000Z', 'launch'],
      ['mtb3a_stay_monthly_plans_50', 50, 'repeating', 2, null, 'stay'],
      ['mtb3a_comeback_first_month_plans_67', 67, 'once', null, null, 'comeback'],
    ]);
    for (const row of COUPON_SPEC) expect(row.plans).toEqual(['solo', 'business', 'firm']);
    // 2027-02-22 00:59 in Jerusalem (UTC+2 in winter), as the live legacy launch coupon.
    const jerusalem = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    expect(jerusalem.format(new Date(COUPON_SPEC[0]!.redeemBy!))).toBe('2027-02-22, 00:59');
    for (const row of COUPON_SPEC) expect(row.name.length).toBeLessThanOrEqual(40);
  });

  it('offers.json and the spec name the same coupons on the same plans: no orphan entry, no orphan coupon (AC6)', () => {
    const planEntries = OFFERS.filter((e) => !e.plans.includes('freelancer'));
    expect(planEntries.map((e) => ['couponId' in e ? e.couponId : null, [...e.plans]])).toEqual(COUPON_SPEC.map((r) => [r.id, [...r.plans]]));
    expect(planEntries.map((e) => e.kind)).toEqual(COUPON_SPEC.map((r) => r.metadata.mtb3a_offer));
    // The legacy coupons are not the script's.
    const legacyIds = OFFERS.filter((e) => e.plans.includes('freelancer')).flatMap((e) => ('couponIds' in e ? Object.values(e.couponIds) : [e.couponId]));
    for (const id of legacyIds) expect(COUPON_SPEC.some((r) => r.id === id)).toBe(false);
    expect(RETIRED_COUPON_IDS).toEqual([]);
  });
});

describe('couponActions', () => {
  const ids = COUPON_SPEC.map((r) => r.id);

  it('an empty account gets the three coupons on the plans’ products (made with the products when new)', () => {
    const actions = couponActions(EMPTY);
    expect(actions.map((a) => (a.kind === 'create-coupon' ? a.row.id : a.kind))).toEqual(ids);
    expect(actions[0]).toEqual({ kind: 'create-coupon', row: COUPON_SPEC[0], products: null });
    const withProducts = complete();
    withProducts.coupons = [];
    const first = couponActions(withProducts)[0]!;
    expect(first).toEqual({ kind: 'create-coupon', row: COUPON_SPEC[0], products: ['prod_solo', 'prod_business', 'prod_firm'] });
    expect(describeAction(first)).toBe('create coupon mtb3a_launch_yearly_plans_2026 "Launch offer · عرض الإطلاق": 50% off once, redeemable until 2027-02-21T22:59:00.000Z, on solo, business, firm');
  });

  it('a complete account has nothing to do (the second dry run)', () => {
    expect(couponActions(complete())).toEqual([]);
    expect([...planActions(complete()), ...couponActions(complete())]).toEqual([]);
  });

  it.each<[string, number, Partial<CouponState>, string]>([
    ['percent', 0, { percentOff: 40 }, 'percent_off'],
    ['duration', 0, { duration: 'forever' }, 'duration'],
    ['months', 1, { durationInMonths: 3 }, 'duration_in_months'],
    ['redeem_by', 0, { redeemBy: 1 }, 'redeem_by'],
    ['products', 2, { appliesToProducts: ['prod_solo'] }, 'products'],
    ['products (a Freelancer product too)', 2, { appliesToProducts: ['prod_solo', 'prod_business', 'prod_firm', 'prod_F'] }, 'products'],
    ['products (any product)', 2, { appliesToProducts: null }, 'products'],
  ])('a live coupon whose %s differs is never fixed: refused with the new-id message', (_, index, over, field) => {
    const state = complete();
    state.coupons[index] = { ...state.coupons[index]!, ...over };
    const actions = couponActions(state);
    expect(actions).toEqual([{ kind: 'coupon-differs', id: ids[index], fields: [field] }]);
    expect(describeAction(actions[0]!)).toBe(`coupon ${ids[index]} differs (${field}): give the spec a new id and name it in offers.json`);
  });

  it('a coupon whose plans’ products don’t exist yet differs too (never guessed)', () => {
    const state = complete();
    state.products = state.products.filter((p) => p.id !== 'prod_firm');
    expect(couponActions(state)).toEqual(ids.map((id) => ({ kind: 'coupon-differs', id, fields: ['products'] })));
  });

  it('name or metadata drift is updated in place (Stripe can edit those)', () => {
    const state = complete();
    state.coupons[2] = { ...state.coupons[2]!, name: 'Old name', metadata: {} };
    expect(couponActions(state)).toEqual([{ kind: 'update-coupon', id: ids[2], name: COUPON_SPEC[2]!.name, metadata: { mtb3a_offer: 'comeback' } }]);
  });

  it('a retired id is deleted when it exists; nothing else is ever touched (Freelancer coupons included)', () => {
    const state = complete();
    state.coupons.push(
      { id: 'mtb3a_launch_yearly_2026', name: 'Launch', percentOff: 50, duration: 'once', durationInMonths: null, redeemBy: 1, appliesToProducts: ['prod_F'], metadata: {} },
      { id: 'mtb3a_comeback_first_month_ils', name: 'Back', percentOff: null, duration: 'once', durationInMonths: null, redeemBy: null, appliesToProducts: ['prod_F'], metadata: {} },
    );
    expect(couponActions(state)).toEqual([]);
    expect(couponActions(state, COUPON_SPEC, ['mtb3a_old_plans_offer'])).toEqual([]);
    expect(couponActions(state, COUPON_SPEC, ['mtb3a_launch_yearly_2026'])).toEqual([{ kind: 'delete-coupon', id: 'mtb3a_launch_yearly_2026' }]);
  });
});
