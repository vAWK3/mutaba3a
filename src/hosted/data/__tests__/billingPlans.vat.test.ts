import { describe, expect, it } from 'vitest';
import type { BillingOverview } from '../../api/client';
import { priceLinesOf, vatRateOf } from '../billingPlans';

/** MUT-750 slice A: the price, VAT and total before Checkout, rounded as Stripe rounds a line's tax. */

const IL18 = { country: 'IL' as const, percent: 18 };

describe('priceLinesOf', () => {
  it('adds Israeli VAT half-up in minor units: Solo 3900 → 702, total 4602', () => {
    expect(priceLinesOf(3900, 'IL', IL18)).toEqual({ price: 3900, vat: { percent: 18, amount: 702 }, total: 4602 });
  });

  it('rounds a half up (the yearly Solo, 39000 → 7020; 8925 → 1606.5 → 1607)', () => {
    expect(priceLinesOf(39000, 'IL', IL18).vat?.amount).toBe(7020);
    expect(priceLinesOf(8925, 'IL', IL18).vat?.amount).toBe(1607);
  });

  it('elsewhere, or with no rate from the server, the price alone', () => {
    expect(priceLinesOf(1200, 'JO', IL18)).toEqual({ price: 1200, vat: null, total: 1200 });
    expect(priceLinesOf(3900, 'IL', null)).toEqual({ price: 3900, vat: null, total: 3900 });
    expect(priceLinesOf(3900, null, IL18).vat).toBeNull();
  });
});

describe('vatRateOf', () => {
  it('reads the server’s rate, or null from an older server', () => {
    expect(vatRateOf({ vatRate: IL18 } as Pick<BillingOverview, 'vatRate'>)).toEqual(IL18);
    expect(vatRateOf({ vatRate: null } as Pick<BillingOverview, 'vatRate'>)).toBeNull();
    expect(vatRateOf(undefined)).toBeNull();
  });
});
