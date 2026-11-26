import { describe, expect, it } from 'vitest';
import { PLAN_SPEC, planActions, type CatalogState } from '../stripe-plans.js';

/** MUT-702 Part B (ADR-286): the catalog script's pure core, the one place the plans' amounts are written. */
const EMPTY: CatalogState = { products: [], prices: [], taxRates: [] };
const VAT = { id: 'txr_il', active: true, inclusive: false, country: 'IL', percentage: 18, metadata: { mtb3a_vat: 'IL' } };

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
  return { products, prices, taxRates: [VAT] };
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

  it('makes the 18% Israeli VAT rate once (Stripe Tax has no Israel registration)', () => {
    expect(planActions(EMPTY)[0]).toEqual({ kind: 'create-vat-rate' });
    const state = complete();
    state.taxRates = [{ ...VAT, percentage: 17 }];
    expect(planActions(state)).toEqual([{ kind: 'create-vat-rate' }]);
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
