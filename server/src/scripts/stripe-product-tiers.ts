import { pathToFileURL } from 'node:url';
import Stripe from 'stripe';
import { STRIPE_API_VERSION } from '../billing/stripe/gateway.js';

/**
 * MUT-565 fix (pilot runbook §1.12, release check): READ-ONLY. Lists every Stripe product with its `metadata.tier`
 * and fails when a product that a live subscription uses has none (or an unknown one). The mirror (mirror.ts) reads a
 * subscription's plan only from that tag: an untagged product's subscriptions stop mirroring (UNKNOWN_TIER) and the
 * people paying for them lapse 7 days after the stored period.
 *
 *   STRIPE_SECRET_KEY=<rk_live_… or rk_test_…> npm run billing:product-tiers
 *
 * Only `GET /v1/products` and `GET /v1/subscriptions` are called; nothing is created, changed or deleted.
 * Exit 0: every product in use is tagged. Exit 1: at least one isn't (listed). Exit 2: no key / Stripe refused.
 */

export const KNOWN_TIERS: ReadonlySet<string> = new Set(['freelancer', 'firm', 'accountant']);
/** Subscriptions that can still charge or cover someone; an ended one no longer mirrors anything that matters. */
const ENDED: ReadonlySet<string> = new Set(['canceled', 'incomplete_expired']);

export interface ProductRow {
  id: string;
  name: string;
  active: boolean;
  tier: string | null;
  /** Subscriptions not ended that use it. */
  liveSubscriptions: number;
}

type ProductLike = Pick<Stripe.Product, 'id' | 'name' | 'active' | 'metadata'>;
type SubscriptionLike = { status: string; items: { data: Array<{ price: { product: string | { id: string } } }> } };

/** The tier as the mirror reads it (trimmed, lower case), or null. */
export function tierOfProduct(product: Pick<Stripe.Product, 'metadata'>): string | null {
  const tier = (product.metadata?.['tier'] ?? '').trim().toLowerCase();
  return tier === '' ? null : tier;
}

/** One row per product (and per product a subscription names that the list didn't return), and the problems. */
export function productTierReport(products: readonly ProductLike[], subscriptions: readonly SubscriptionLike[]): { rows: ProductRow[]; problems: string[] } {
  const uses = new Map<string, number>();
  for (const sub of subscriptions) {
    if (ENDED.has(sub.status)) continue;
    for (const id of new Set(sub.items.data.map((item) => (typeof item.price.product === 'string' ? item.price.product : item.price.product.id)))) {
      uses.set(id, (uses.get(id) ?? 0) + 1);
    }
  }
  const rows: ProductRow[] = products.map((p) => ({ id: p.id, name: p.name, active: p.active, tier: tierOfProduct(p), liveSubscriptions: uses.get(p.id) ?? 0 }));
  for (const [id, count] of uses) {
    if (!rows.some((r) => r.id === id)) rows.push({ id, name: '(not listed: deleted?)', active: false, tier: null, liveSubscriptions: count });
  }
  const problems = rows
    .filter((r) => r.liveSubscriptions > 0 && (r.tier === null || !KNOWN_TIERS.has(r.tier)))
    .map((r) => `${r.id} (${r.name}): metadata.tier is ${r.tier === null ? 'missing' : `"${r.tier}"`}, used by ${r.liveSubscriptions} live subscription(s): they will not mirror (UNKNOWN_TIER)`);
  return { rows, problems };
}

async function main(): Promise<number> {
  const key = process.env['STRIPE_SECRET_KEY'];
  if (!key || !/^(rk|sk)_(test|live)_/.test(key)) {
    console.error('Set STRIPE_SECRET_KEY to the Stripe key to read (a restricted key is enough: Products and Subscriptions read).');
    return 2;
  }
  const stripe = new Stripe(key, { apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion, maxNetworkRetries: 2 });
  const products: Stripe.Product[] = [];
  const subscriptions: Stripe.Subscription[] = [];
  try {
    for await (const p of stripe.products.list({ limit: 100 })) products.push(p);
    for await (const s of stripe.subscriptions.list({ status: 'all', limit: 100 })) subscriptions.push(s);
  } catch (err) {
    console.error(`Stripe refused the read: ${(err as Error).message}`);
    return 2;
  }
  const { rows, problems } = productTierReport(products, subscriptions);
  console.log(`Stripe ${key.includes('_live_') ? 'LIVE' : 'test'} mode: ${rows.length} product(s), ${subscriptions.length} subscription(s) read.`);
  for (const r of rows) console.log(`  ${r.id}\ttier=${r.tier ?? '(none)'}\t${r.active ? 'active' : 'inactive'}\tlive subs=${r.liveSubscriptions}\t${r.name}`);
  if (problems.length > 0) {
    console.error(`\nFAIL: ${problems.length} product(s) in use without a known tier. Set metadata.tier (freelancer, firm or accountant) in the dashboard before deploying:`);
    for (const p of problems) console.error(`  ${p}`);
    return 1;
  }
  console.log('\nOK: every product a live subscription uses carries metadata.tier.');
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(err);
      process.exit(2);
    },
  );
}
