import { ISRAEL_VAT, taxRatesFor } from '../checkout.js';
import type { PlanGateway } from './plan-gateway.js';

/**
 * MUT-750 (ADR-290, amends ADR-288 d4): the tax follows the billing address. A plan subscription carries a fixed
 * Israeli VAT rate for an Israeli address and Stripe Tax elsewhere, so an address that moves into or out of Israel after
 * Checkout (the Customer Portal) must re-tax the item from the next invoice. The sync calls this on `customer.updated`.
 */
export interface TaxFollowsAddress {
  /** `changed`: Stripe was asked to re-tax; `unchanged`: the item already matched. Throws StripeGatewayError. */
  retax(input: { subscriptionId: string; country: string | null }): Promise<'changed' | 'unchanged'>;
}

/** No Israeli VAT rate exists in Stripe (or none is configured): the subscription can't be taxed correctly for Israel. */
export class IsraelVatRateMissing extends Error {
  constructor() {
    super('No Israeli VAT tax rate in Stripe; run npm run billing:plans');
    this.name = 'IsraelVatRateMissing';
  }
}

export interface TaxFollowsAddressOptions {
  plan: Pick<PlanGateway, 'planOf' | 'retax'>;
  /** The Stripe tax rate id for the configured Israeli VAT, or null (billing-countries.json sets none, or Stripe has none). */
  israelVatRateId(): Promise<string | null>;
}

export function createTaxFollowsAddress(options: TaxFollowsAddressOptions): TaxFollowsAddress {
  return {
    async retax({ subscriptionId, country }) {
      const rateId = country === ISRAEL_VAT.country ? await options.israelVatRateId() : null;
      const tax = taxRatesFor(country, rateId);
      if (!tax) throw new IsraelVatRateMissing();
      const live = await options.plan.planOf(subscriptionId);
      if (live.automaticTax === tax.automaticTax && sameRates(live.taxRateIds, tax.taxRates)) return 'unchanged';
      await options.plan.retax({ subscriptionId, itemId: live.itemId, country, ...tax });
      return 'changed';
    },
  };
}

function sameRates(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().every((id, i) => id === [...b].sort()[i]);
}
