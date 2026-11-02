import { GA_PRICE_LOOKUP_KEYS, type BillingCurrency, type Catalog, type CatalogPrice } from './checkout.js';

/**
 * MUT-531 (plan D2–D4, D13, ADR-238): moving a monthly payer to the yearly price. Pure: the route reads the mirror,
 * the catalog and Stripe's own facts about the subscription; this decides. Nothing here is an amount: the saving is
 * the catalog's twelve months less its year (ADR-004, ADR-170).
 */

/** D2: the switch opens from the 2nd invoice that took money (a ₪0 trial invoice doesn't count). */
export const SWITCH_AFTER_PAID_INVOICES = 2;

/** What the mirror knows of the subscription Billing shows. */
export interface SwitchSubscription {
  status: string;
  priceLookupKey: string | null;
  cancelAtPeriodEnd: boolean;
}

/** What only Stripe knows: paid invoices with money in them, a running discount, a pause. */
export interface PlanFacts {
  paidInvoices: number;
  discounted: boolean;
  paused: boolean;
}

export type SwitchRefusal = 'NOT_MONTHLY_LIST' | 'NOT_ACTIVE' | 'CANCELLING' | 'PAUSED' | 'DISCOUNTED' | 'TOO_EARLY' | 'NO_PRICE';

export type YearlySwitch =
  | { ok: true; currency: BillingCurrency; yearly: CatalogPrice; savings: number | null }
  | { ok: false; refusal: SwitchRefusal };

const CURRENCIES = Object.keys(GA_PRICE_LOOKUP_KEYS) as BillingCurrency[];

/** The currency of a monthly list price; null for a yearly, founder, Firm or unknown price (D5: founders don't switch). */
export function listMonthlyCurrencyOf(priceLookupKey: string | null): BillingCurrency | null {
  return CURRENCIES.find((currency) => GA_PRICE_LOOKUP_KEYS[currency].month === priceLookupKey) ?? null;
}

/** D3: twelve months less the year, in that currency's minor units; null when the year saves nothing or isn't sold. */
export function yearlySavingsOf(catalog: Catalog, currency: BillingCurrency): number | null {
  const pair = catalog[currency];
  if (!pair) return null;
  const savings = 12 * pair.month.unitAmount - pair.year.unitAmount;
  return savings > 0 ? savings : null;
}

/** D2, D4, D13: the first refusal that applies, else the yearly price of the subscription's own currency. */
export function yearlySwitchOf(subscription: SwitchSubscription, facts: PlanFacts, catalog: Catalog): YearlySwitch {
  const currency = listMonthlyCurrencyOf(subscription.priceLookupKey);
  if (!currency) return { ok: false, refusal: 'NOT_MONTHLY_LIST' };
  if (subscription.status !== 'active') return { ok: false, refusal: 'NOT_ACTIVE' };
  if (subscription.cancelAtPeriodEnd) return { ok: false, refusal: 'CANCELLING' };
  if (facts.paused) return { ok: false, refusal: 'PAUSED' };
  if (facts.discounted) return { ok: false, refusal: 'DISCOUNTED' };
  if (facts.paidInvoices < SWITCH_AFTER_PAID_INVOICES) return { ok: false, refusal: 'TOO_EARLY' };
  const yearly = catalog[currency]?.year;
  if (!yearly) return { ok: false, refusal: 'NO_PRICE' };
  return { ok: true, currency, yearly, savings: yearlySavingsOf(catalog, currency) };
}
