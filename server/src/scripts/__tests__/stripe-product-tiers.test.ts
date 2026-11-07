import { describe, expect, it } from 'vitest';
import { productTierReport } from '../stripe-product-tiers.js';

/** MUT-565 fix: the read-only release check that every product a live subscription uses carries `metadata.tier`. */
const product = (id: string, tier: string | null, name = id) => ({ id, name, active: true, metadata: tier === null ? {} : { tier } });
const sub = (status: string, ...products: string[]) => ({ status, items: { data: products.map((p) => ({ price: { product: p } })) } });

describe('billing:product-tiers (MUT-565 fix)', () => {
  it('passes when every product in use is tagged, read as the mirror reads it', () => {
    const { rows, problems } = productTierReport([product('prod_F', ' Freelancer '), product('prod_A', 'accountant'), product('prod_X', null)], [sub('active', 'prod_F'), sub('trialing', 'prod_A')]);
    expect(problems).toEqual([]);
    expect(rows).toEqual([
      { id: 'prod_F', name: 'prod_F', active: true, tier: 'freelancer', liveSubscriptions: 1 },
      { id: 'prod_A', name: 'prod_A', active: true, tier: 'accountant', liveSubscriptions: 1 },
      { id: 'prod_X', name: 'prod_X', active: true, tier: null, liveSubscriptions: 0 },
    ]);
  });

  it('fails on a product in use with no tier, an unknown tier, or one the listing no longer returns; ended subscriptions do not count', () => {
    const { problems } = productTierReport([product('prod_F', null), product('prod_Y', 'pro'), product('prod_Z', null)], [sub('active', 'prod_F'), sub('past_due', 'prod_Y'), sub('canceled', 'prod_Z'), sub('active', 'prod_GONE')]);
    expect(problems).toHaveLength(3);
    expect(problems[0]).toMatch(/^prod_F .*missing.*1 live/);
    expect(problems[1]).toMatch(/^prod_Y .*"pro"/);
    expect(problems[2]).toMatch(/^prod_GONE /);
  });
});
