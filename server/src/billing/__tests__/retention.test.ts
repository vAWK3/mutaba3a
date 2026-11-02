import { describe, expect, it } from 'vitest';
import type { Catalog } from '../checkout.js';
import { listMonthlyCurrencyOf, SWITCH_AFTER_PAID_INVOICES, yearlySavingsOf, yearlySwitchOf, type PlanFacts, type SwitchSubscription } from '../retention.js';

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
