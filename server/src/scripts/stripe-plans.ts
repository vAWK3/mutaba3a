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
 * MUT-703 (ADR-340): it also makes the offers' coupons on the plans' products (`COUPON_SPEC`), **the only place offer
 * amounts and dates are written** (offers.json names the ids). Stripe can't edit a coupon's percent, duration, products
 * or `redeem_by`, so a live coupon of another shape is never "fixed": the run refuses (exit 2) and asks for a new id.
 * A changed name or metadata is updated. `RETIRED_COUPON_IDS` are deleted (ending a campaign early). Legacy Freelancer
 * coupons are never touched unless listed there. No promotion codes (MUT-528: automatic offers only).
 *
 *   STRIPE_SECRET_KEY=<rk_test_…> npm run billing:plans                  dry run: prints what it would do
 *   STRIPE_SECRET_KEY=<rk_test_…> npm run billing:plans -- --apply       does it
 *   STRIPE_SECRET_KEY=<rk_live_…> npm run billing:plans -- --apply --live  the live run (Basel's)
 *
 * Exit 0: nothing to do, or done. Exit 1: a dry run with something to do. Exit 2: no key, a live key without --live,
 * a live coupon whose shape differs from the spec, or Stripe refused.
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

export type OfferCouponKind = 'launch' | 'stay' | 'comeback';

/** MUT-703 (§4): one coupon the script makes, on the plans' products. */
export interface CouponSpecRow {
  /** The Stripe coupon id, also named in offers.json. */
  id: string;
  /** Shown on Stripe's invoice; Stripe allows 40 characters. */
  name: string;
  /** `applies_to`: these plans' products (never Freelancer or Accountant). */
  plans: readonly PlanName[];
  percentOff: number;
  duration: 'once' | 'repeating';
  durationInMonths?: number;
  /** ISO instant; launch only. */
  redeemBy?: string;
  metadata: { mtb3a_offer: OfferCouponKind };
}

const ON_PLANS: readonly PlanName[] = ['solo', 'business', 'firm'];
/**
 * Basel, 2026-11-27 (MUT-703 §13 defaults): one percent per kind for all three plans and both currencies. The launch
 * discounts the first year only and ends with the legacy launch coupon, last day 21 Feb 2027 (`redeem_by` 2027-02-22
 * 00:59 Jerusalem); stay is two months at half price; come-back is the first month at about a third.
 */
export const COUPON_SPEC: readonly CouponSpecRow[] = [
  { id: 'mtb3a_launch_yearly_plans_2026', name: 'Launch offer · عرض الإطلاق', plans: ON_PLANS, percentOff: 50, duration: 'once', redeemBy: '2027-02-21T22:59:00.000Z', metadata: { mtb3a_offer: 'launch' } },
  { id: 'mtb3a_stay_monthly_plans_50', name: 'Stay offer · عرض البقاء', plans: ON_PLANS, percentOff: 50, duration: 'repeating', durationInMonths: 2, metadata: { mtb3a_offer: 'stay' } },
  { id: 'mtb3a_comeback_first_month_plans_67', name: 'Welcome back · عرض العودة', plans: ON_PLANS, percentOff: 67, duration: 'once', metadata: { mtb3a_offer: 'comeback' } },
];
/** Coupons `--apply` deletes (ending a campaign early is a spec change and a run, not a dashboard click). */
export const RETIRED_COUPON_IDS: readonly string[] = [];

/** What the script reads of a Stripe coupon. */
export interface CouponState {
  id: string;
  name: string | null;
  percentOff: number | null;
  duration: string;
  durationInMonths: number | null;
  /** Seconds, as Stripe holds it. */
  redeemBy: number | null;
  /** Null: any product. */
  appliesToProducts: string[] | null;
  metadata: Record<string, string>;
}

export interface CatalogState {
  products: Array<{ id: string; name: string; active: boolean; metadata: Record<string, string> }>;
  prices: Array<{ id: string; lookupKey: string | null; productId: string; currency: string; unitAmount: number | null; interval: string | null; taxBehavior: string | null; active: boolean }>;
  taxRates: Array<{ id: string; active: boolean; inclusive: boolean; country: string | null; percentage: number; metadata: Record<string, string> }>;
  coupons: CouponState[];
}

export type PlanAction =
  | { kind: 'create-vat-rate'; percentage: number }
  | { kind: 'create-product'; plan: PlanName; name: string }
  | { kind: 'tag-product'; plan: PlanName; productId: string }
  | { kind: 'create-price'; plan: PlanName; lookupKey: string; currency: ListCurrency; unitAmount: number; interval: ListInterval; transfer: boolean };

export type CouponAction =
  /** `products` null: a plan's product is made in this same run; the ids are read after it. */
  | { kind: 'create-coupon'; row: CouponSpecRow; products: string[] | null }
  | { kind: 'update-coupon'; id: string; name: string; metadata: Record<string, string> }
  | { kind: 'delete-coupon'; id: string }
  /** Never applied: Stripe can't edit these fields, so the spec needs a new id. */
  | { kind: 'coupon-differs'; id: string; fields: string[] };

export type CatalogAction = PlanAction | CouponAction;

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

/** The products of `plans`, or null while one of them has no product yet. */
function productIdsFor(state: CatalogState, plans: readonly PlanName[]): string[] | null {
  const ids = plans.map((plan) => productOf(state, plan)?.id ?? null);
  return ids.every((id): id is string => id !== null) ? ids : null;
}

const redeemSeconds = (row: CouponSpecRow) => (row.redeemBy ? Math.floor(Date.parse(row.redeemBy) / 1000) : null);

/** The fields Stripe can't edit that differ from the row. */
function differingFields(coupon: CouponState, row: CouponSpecRow, products: string[] | null): string[] {
  const fields: string[] = [];
  if (coupon.percentOff !== row.percentOff) fields.push('percent_off');
  if (coupon.duration !== row.duration) fields.push('duration');
  if (coupon.durationInMonths !== (row.durationInMonths ?? null)) fields.push('duration_in_months');
  if (coupon.redeemBy !== redeemSeconds(row)) fields.push('redeem_by');
  const live = coupon.appliesToProducts;
  const same = products !== null && live !== null && live.length === products.length && products.every((p) => live.includes(p));
  if (!same) fields.push('products');
  return fields;
}

/** MUT-703 (§4): what it takes to make the account's coupons match COUPON_SPEC. Pure. */
export function couponActions(state: CatalogState, spec: readonly CouponSpecRow[] = COUPON_SPEC, retired: readonly string[] = RETIRED_COUPON_IDS): CouponAction[] {
  const actions: CouponAction[] = [];
  for (const row of spec) {
    const products = productIdsFor(state, row.plans);
    const coupon = state.coupons.find((c) => c.id === row.id);
    if (!coupon) {
      actions.push({ kind: 'create-coupon', row, products });
      continue;
    }
    const fields = differingFields(coupon, row, products);
    if (fields.length > 0) actions.push({ kind: 'coupon-differs', id: row.id, fields });
    else if (coupon.name !== row.name || coupon.metadata['mtb3a_offer'] !== row.metadata.mtb3a_offer) actions.push({ kind: 'update-coupon', id: row.id, name: row.name, metadata: { ...row.metadata } });
  }
  for (const id of retired) if (state.coupons.some((c) => c.id === id)) actions.push({ kind: 'delete-coupon', id });
  return actions;
}

export function describeAction(action: CatalogAction): string {
  switch (action.kind) {
    case 'create-coupon': {
      const { row } = action;
      const length = row.duration === 'once' ? 'once' : `for ${row.durationInMonths} months`;
      const until = row.redeemBy ? `, redeemable until ${row.redeemBy}` : '';
      return `create coupon ${row.id} "${row.name}": ${row.percentOff}% off ${length}${until}, on ${row.plans.join(', ')}`;
    }
    case 'update-coupon':
      return `rename coupon ${action.id} to "${action.name}" (metadata ${JSON.stringify(action.metadata)})`;
    case 'delete-coupon':
      return `delete retired coupon ${action.id}`;
    case 'coupon-differs':
      return `coupon ${action.id} differs (${action.fields.join(', ')}): give the spec a new id and name it in offers.json`;
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
  const state: CatalogState = { products: [], prices: [], taxRates: [], coupons: [] };
  for await (const r of stripe.taxRates.list({ active: true, limit: 100 })) {
    state.taxRates.push({ id: r.id, active: r.active, inclusive: r.inclusive, country: r.country, percentage: r.percentage, metadata: { ...r.metadata } });
  }
  for await (const p of stripe.products.list({ limit: 100 })) state.products.push({ id: p.id, name: p.name, active: p.active, metadata: { ...p.metadata } });
  const keys = PLAN_NAMES.flatMap((plan) => (['month', 'year'] as const).flatMap((interval) => (['ILS', 'USD'] as const).map((currency) => listLookupKey(plan, interval, currency))));
  for await (const c of stripe.coupons.list({ limit: 100, expand: ['data.applies_to'] })) {
    state.coupons.push({
      id: c.id,
      name: c.name,
      percentOff: c.percent_off,
      duration: c.duration,
      durationInMonths: c.duration_in_months,
      redeemBy: c.redeem_by,
      appliesToProducts: c.applies_to?.products ?? null,
      metadata: { ...c.metadata },
    });
  }
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

async function apply(stripe: Stripe, state: CatalogState, actions: readonly CatalogAction[]): Promise<void> {
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
    } else if (action.kind === 'create-coupon') {
      const { row } = action;
      // Products made earlier in this run are known only now.
      const products = action.products ?? row.plans.map((plan) => productIds.get(plan)!);
      const redeemBy = redeemSeconds(row);
      await stripe.coupons.create(
        {
          id: row.id,
          name: row.name,
          percent_off: row.percentOff,
          duration: row.duration,
          ...(row.durationInMonths ? { duration_in_months: row.durationInMonths } : {}),
          ...(redeemBy ? { redeem_by: redeemBy } : {}),
          applies_to: { products },
          metadata: { ...row.metadata },
        },
        { idempotencyKey: `mut703-coupon-${row.id}` },
      );
    } else if (action.kind === 'update-coupon') {
      await stripe.coupons.update(action.id, { name: action.name, metadata: action.metadata });
    } else if (action.kind === 'delete-coupon') {
      await stripe.coupons.del(action.id);
    } else if (action.kind === 'coupon-differs') {
      throw new Error(describeAction(action));
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
    const actions: CatalogAction[] = [...planActions(state), ...couponActions(state)];
    console.log(`Stripe ${live ? 'LIVE' : 'test'} mode: ${actions.length === 0 ? 'nothing to do.' : `${actions.length} change(s):`}`);
    for (const action of actions) console.log(`  ${describeAction(action)}`);
    if (actions.length === 0) return 0;
    // MUT-703: a coupon Stripe can't edit is never "fixed", with or without --apply; nothing is written.
    if (actions.some((a) => a.kind === 'coupon-differs')) {
      console.error('\nA live coupon differs from COUPON_SPEC; nothing was changed.');
      return 2;
    }
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
