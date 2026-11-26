import { pathToFileURL } from 'node:url';
import Stripe from 'stripe';
import { STRIPE_API_VERSION } from '../billing/stripe/gateway.js';
import { BILLING_COUNTRIES, ISRAEL_VAT, israelVatPercent } from '../billing/checkout.js';
import { listLookupKey, PLAN_NAMES, type ListCurrency, type ListInterval, type PlanName } from '../billing/plans.js';

/**
 * MUT-702 Part B (ADR-288): makes Stripe's catalog match the plans on sale: one product per plan (`metadata.tier` and
 * `metadata.mtb3a_plan` = the plan, the SaaS tax code) and its four list prices (ILS and USD, monthly and yearly, VAT
 * exclusive), each under its lookup key. **The only place the plans' amounts are written.** A key on a wrong price
 * (another amount, product or tax behaviour) gets a new price and the key moves to it; subscriptions already on the
 * old price keep it. Freelancer and Accountant products and prices are never touched. It also makes the Israeli VAT
 * tax rate at billing-countries.json's `vatRates.IL` (ISRAEL_VAT): Stripe Tax takes no Israel registration, so an
 * Israeli address is taxed with it. A changed percent makes a new rate; Checkout picks the one at the configured percent.
 *
 *   STRIPE_SECRET_KEY=<rk_test_…> npm run billing:plans                  dry run: prints what it would do
 *   STRIPE_SECRET_KEY=<rk_test_…> npm run billing:plans -- --apply       does it
 *   STRIPE_SECRET_KEY=<rk_live_…> npm run billing:plans -- --apply --live  the live run (Basel's)
 *
 * Exit 0: nothing to do, or done. Exit 1: a dry run with something to do. Exit 2: no key, a live key without --live,
 * or Stripe refused.
 */

/** Stripe's tax code for software as a service (Stripe Tax reads it to tax the sale). */
export const SAAS_TAX_CODE = 'txcd_10103001';

export interface PlanSpecRow {
  plan: PlanName;
  name: string;
  /** Minor units, before tax. */
  prices: Record<ListCurrency, Record<ListInterval, number>>;
}

const yearOf = (month: number) => month * 10;
/** Basel, 2026-11-22 (₪39 / ₪89 / ₪249) and 2026-11-26 Q6 ($12 / $27 / $75); a year costs ten months. */
export const PLAN_SPEC: readonly PlanSpecRow[] = [
  { plan: 'solo', name: 'MTB3A Solo · متابعة مستقل', prices: { ILS: { month: 3900, year: yearOf(3900) }, USD: { month: 1200, year: yearOf(1200) } } },
  { plan: 'business', name: 'MTB3A Business · متابعة تجاري', prices: { ILS: { month: 8900, year: yearOf(8900) }, USD: { month: 2700, year: yearOf(2700) } } },
  { plan: 'firm', name: 'MTB3A Firm · متابعة مؤسسة', prices: { ILS: { month: 24900, year: yearOf(24900) }, USD: { month: 7500, year: yearOf(7500) } } },
];

export interface CatalogState {
  products: Array<{ id: string; name: string; active: boolean; metadata: Record<string, string> }>;
  prices: Array<{ id: string; lookupKey: string | null; productId: string; currency: string; unitAmount: number | null; interval: string | null; taxBehavior: string | null; active: boolean }>;
  taxRates: Array<{ id: string; active: boolean; inclusive: boolean; country: string | null; percentage: number; metadata: Record<string, string> }>;
}

export type PlanAction =
  | { kind: 'create-vat-rate'; percentage: number }
  | { kind: 'create-product'; plan: PlanName; name: string }
  | { kind: 'tag-product'; plan: PlanName; productId: string }
  | { kind: 'create-price'; plan: PlanName; lookupKey: string; currency: ListCurrency; unitAmount: number; interval: ListInterval; transfer: boolean };

/** The plan's product: the one this script made (`mtb3a_plan`), else an active one already tagged with its tier. */
function productOf(state: CatalogState, plan: PlanName) {
  return state.products.find((p) => p.metadata['mtb3a_plan'] === plan) ?? state.products.find((p) => p.active && (p.metadata['tier'] ?? '').trim().toLowerCase() === plan) ?? null;
}

/** What it takes to make `state` match PLAN_SPEC. Pure. */
export function planActions(state: CatalogState, spec: readonly PlanSpecRow[] = PLAN_SPEC, vatPercent: number | null = israelVatPercent(BILLING_COUNTRIES)): PlanAction[] {
  const actions: PlanAction[] = [];
  const vat = state.taxRates.some((r) => r.active && !r.inclusive && r.country === ISRAEL_VAT.country && r.percentage === vatPercent && r.metadata[ISRAEL_VAT.metadataKey] === ISRAEL_VAT.country);
  if (vatPercent !== null && !vat) actions.push({ kind: 'create-vat-rate', percentage: vatPercent });
  for (const row of spec) {
    const product = productOf(state, row.plan);
    if (!product) actions.push({ kind: 'create-product', plan: row.plan, name: row.name });
    else if (product.metadata['tier'] !== row.plan || product.metadata['mtb3a_plan'] !== row.plan) actions.push({ kind: 'tag-product', plan: row.plan, productId: product.id });
    for (const currency of ['ILS', 'USD'] as const) {
      for (const interval of ['month', 'year'] as const) {
        const lookupKey = listLookupKey(row.plan, interval, currency);
        const unitAmount = row.prices[currency][interval];
        const existing = state.prices.find((p) => p.active && p.lookupKey === lookupKey) ?? null;
        const right =
          existing !== null &&
          product !== null &&
          existing.productId === product.id &&
          existing.currency.toUpperCase() === currency &&
          existing.unitAmount === unitAmount &&
          existing.interval === interval &&
          existing.taxBehavior === 'exclusive';
        if (!right) actions.push({ kind: 'create-price', plan: row.plan, lookupKey, currency, unitAmount, interval, transfer: existing !== null });
      }
    }
  }
  return actions;
}

export function describeAction(action: PlanAction): string {
  switch (action.kind) {
    case 'create-vat-rate':
      return `create the ${action.percentage}% Israeli VAT tax rate (exclusive)`;
    case 'create-product':
      return `create product "${action.name}" (tier ${action.plan})`;
    case 'tag-product':
      return `tag product ${action.productId} as tier ${action.plan}`;
    case 'create-price':
      return `create price ${action.lookupKey}: ${action.unitAmount} ${action.currency} a ${action.interval}, VAT exclusive${action.transfer ? ' (the key moves from the old price)' : ''}`;
  }
}

async function readState(stripe: Stripe): Promise<CatalogState> {
  const state: CatalogState = { products: [], prices: [], taxRates: [] };
  for await (const r of stripe.taxRates.list({ active: true, limit: 100 })) {
    state.taxRates.push({ id: r.id, active: r.active, inclusive: r.inclusive, country: r.country, percentage: r.percentage, metadata: { ...r.metadata } });
  }
  for await (const p of stripe.products.list({ limit: 100 })) state.products.push({ id: p.id, name: p.name, active: p.active, metadata: { ...p.metadata } });
  const keys = PLAN_NAMES.flatMap((plan) => (['month', 'year'] as const).flatMap((interval) => (['ILS', 'USD'] as const).map((currency) => listLookupKey(plan, interval, currency))));
  for (let i = 0; i < keys.length; i += 10) {
    const page = await stripe.prices.list({ lookup_keys: keys.slice(i, i + 10), active: true, limit: 10 });
    for (const p of page.data) {
      state.prices.push({
        id: p.id,
        lookupKey: p.lookup_key,
        productId: typeof p.product === 'string' ? p.product : p.product.id,
        currency: p.currency,
        unitAmount: p.unit_amount,
        interval: p.recurring?.interval_count === 1 ? p.recurring.interval : null,
        taxBehavior: p.tax_behavior,
        active: p.active,
      });
    }
  }
  return state;
}

async function apply(stripe: Stripe, state: CatalogState, actions: readonly PlanAction[]): Promise<void> {
  const productIds = new Map<PlanName, string>();
  for (const plan of PLAN_NAMES) {
    const found = productOf(state, plan);
    if (found) productIds.set(plan, found.id);
  }
  const metadata = (plan: PlanName) => ({ tier: plan, mtb3a_plan: plan });
  for (const action of actions) {
    if (action.kind === 'create-vat-rate') {
      await stripe.taxRates.create({
        display_name: 'VAT',
        description: 'Israel VAT · ضريبة القيمة المضافة',
        percentage: action.percentage,
        inclusive: false,
        country: ISRAEL_VAT.country,
        tax_type: 'vat',
        metadata: { [ISRAEL_VAT.metadataKey]: ISRAEL_VAT.country },
      });
    } else if (action.kind === 'create-product') {
      const created = await stripe.products.create({ name: action.name, tax_code: SAAS_TAX_CODE, metadata: metadata(action.plan) });
      productIds.set(action.plan, created.id);
    } else if (action.kind === 'tag-product') {
      await stripe.products.update(action.productId, { tax_code: SAAS_TAX_CODE, metadata: metadata(action.plan) });
    } else {
      await stripe.prices.create({
        product: productIds.get(action.plan)!,
        currency: action.currency.toLowerCase(),
        unit_amount: action.unitAmount,
        recurring: { interval: action.interval },
        tax_behavior: 'exclusive',
        lookup_key: action.lookupKey,
        transfer_lookup_key: action.transfer,
      });
    }
    console.log(`  done: ${describeAction(action)}`);
  }
}

async function main(argv: readonly string[]): Promise<number> {
  const key = process.env['STRIPE_SECRET_KEY'];
  if (!key || !/^(rk|sk)_(test|live)_/.test(key)) {
    console.error('Set STRIPE_SECRET_KEY (Products and Prices write; a test key unless this is the live run).');
    return 2;
  }
  const live = key.includes('_live_');
  if (live && !argv.includes('--live')) {
    console.error('This is a LIVE key: add --live to run against the live account.');
    return 2;
  }
  const stripe = new Stripe(key, { apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion, maxNetworkRetries: 2 });
  try {
    const state = await readState(stripe);
    const actions = planActions(state);
    console.log(`Stripe ${live ? 'LIVE' : 'test'} mode: ${actions.length === 0 ? 'nothing to do.' : `${actions.length} change(s):`}`);
    for (const action of actions) console.log(`  ${describeAction(action)}`);
    if (actions.length === 0) return 0;
    if (!argv.includes('--apply')) {
      console.log('\nDry run: add --apply to make these changes.');
      return 1;
    }
    await apply(stripe, state, actions);
    return 0;
  } catch (err) {
    console.error(`Stripe refused: ${(err as Error).message}`);
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(err);
      process.exit(2);
    },
  );
}
