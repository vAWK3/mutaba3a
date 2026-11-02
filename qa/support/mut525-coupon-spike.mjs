#!/usr/bin/env node
/**
 * MUT-525 build step 0 (plan D5, eng review R2): does a launch-offer coupon discount the first *paid* invoice after a
 * carried trial? Stripe first issues a zero-amount invoice for the trial; a `once` coupon spent on it would leave the
 * trialist paying the full price. Not shipped: a sandbox proof whose output goes into the ADR.
 *
 * For each coupon shape (`once`, then `repeating` 12 months) and each case (a: a 10-day trial carried; b: no trial) it
 * makes a throwaway coupon, a customer on a test clock with a test card, and a yearly ILS subscription with that
 * coupon, then advances the clock past the trial and past the first renewal and prints every invoice's total.
 *
 * Pass: the first paid invoice is the list price minus 50% (₪145), the renewal the list price (₪290). Everything it
 * makes (coupons, test clocks and their customers) is deleted at the end. Sandbox key only (billing-live.mjs's rule).
 */
import { ensureCatalog, sandboxKey } from './billing-live.mjs';

const PRODUCT_ID = 'mutaba3a_qa_freelancer';
const LOOKUP_KEY = 'freelancer_list_yearly_ils';
const DAY = 24 * 60 * 60;
const TRIAL_DAYS = 10;

const key = sandboxKey();

async function stripe(method, endpoint, params = {}) {
  const body = new URLSearchParams(params).toString();
  const url = `https://api.stripe.com/v1/${endpoint}${method === 'GET' && body ? `?${body}` : ''}`;
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/x-www-form-urlencoded' },
    ...(method === 'GET' ? {} : { body }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Stripe ${method} /v1/${endpoint}: ${res.status} ${json.error?.code ?? ''} ${json.error?.message ?? ''}`);
  return json;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function advance(clock, to) {
  await stripe('POST', `test_helpers/test_clocks/${clock}/advance`, { frozen_time: String(to) });
  for (let i = 0; i < 90; i += 1) {
    const state = await stripe('GET', `test_helpers/test_clocks/${clock}`);
    if (state.status === 'ready') return;
    if (state.status === 'internal_failure') throw new Error(`test clock ${clock} failed`);
    await sleep(2000);
  }
  throw new Error(`test clock ${clock} did not settle`);
}

async function invoicesOf(subscription) {
  const listed = await stripe('GET', 'invoices', { subscription, limit: '10' });
  return listed.data
    .sort((a, b) => a.created - b.created)
    .map((inv) => ({
      billingReason: inv.billing_reason,
      subtotal: inv.subtotal,
      total: inv.total,
      discounted: (inv.total_discount_amounts ?? []).reduce((sum, d) => sum + d.amount, 0),
      status: inv.status,
    }));
}

async function runCase({ shape, trial, priceId, coupon, created }) {
  const now = Math.floor(Date.now() / 1000);
  const clock = await stripe('POST', 'test_helpers/test_clocks', { frozen_time: String(now), name: `mut525 ${shape} ${trial ? 'trial' : 'no trial'}` });
  created.clocks.push(clock.id);
  const customer = await stripe('POST', 'customers', { test_clock: clock.id, email: `mut525-spike-${shape}-${trial}@example.com` });
  await stripe('POST', 'payment_methods/pm_card_visa/attach', { customer: customer.id }).then((pm) =>
    stripe('POST', `customers/${customer.id}`, { 'invoice_settings[default_payment_method]': pm.id }),
  );
  const params = { customer: customer.id, 'items[0][price]': priceId, 'discounts[0][coupon]': coupon, 'metadata[mutaba3a_offer]': 'spike' };
  if (trial) params.trial_end = String(now + TRIAL_DAYS * DAY);
  const sub = await stripe('POST', 'subscriptions', params);
  const firstPaidAt = trial ? now + TRIAL_DAYS * DAY : now;
  await advance(clock.id, firstPaidAt + DAY);
  const afterFirst = await invoicesOf(sub.id);
  const subNow = await stripe('GET', `subscriptions/${sub.id}`);
  // The renewal a year after the first paid period starts, plus a day for Stripe to finalise and pay it.
  await advance(clock.id, firstPaidAt + 366 * DAY + DAY);
  const all = await invoicesOf(sub.id);
  const paid = all.filter((inv) => inv.subtotal > 0);
  return {
    shape,
    trial,
    invoices: all,
    discountAfterFirst: subNow.discounts?.length ?? (subNow.discount ? 1 : 0),
    firstPaid: paid[0]?.total ?? null,
    renewal: paid[1]?.total ?? null,
    afterFirstCount: afterFirst.length,
  };
}

async function main() {
  await ensureCatalog(key);
  const prices = await stripe('GET', 'prices', { 'lookup_keys[]': LOOKUP_KEY, active: 'true' });
  const price = prices.data[0];
  if (!price || price.unit_amount !== 29000) throw new Error(`${LOOKUP_KEY} is not ₪290 in the sandbox`);
  const created = { coupons: [], clocks: [] };
  const results = [];
  try {
    const stamp = Date.now().toString(36);
    const shapes = [
      { shape: 'once', params: { duration: 'once' } },
      { shape: 'repeating12', params: { duration: 'repeating', duration_in_months: '12' } },
    ];
    for (const { shape, params } of shapes) {
      const coupon = await stripe('POST', 'coupons', {
        id: `mut525_spike_${shape}_${stamp}`,
        name: 'Launch offer · عرض الإطلاق',
        percent_off: '50',
        'applies_to[products][0]': PRODUCT_ID,
        redeem_by: String(Math.floor(Date.now() / 1000) + 2 * DAY),
        ...params,
      });
      created.coupons.push(coupon.id);
      for (const trial of [true, false]) {
        const result = await runCase({ shape, trial, priceId: price.id, coupon: coupon.id, created });
        results.push(result);
        console.log(JSON.stringify(result));
      }
    }
  } finally {
    for (const id of created.clocks) await stripe('DELETE', `test_helpers/test_clocks/${id}`).catch((err) => console.error(err.message));
    for (const id of created.coupons) await stripe('DELETE', `coupons/${id}`).catch((err) => console.error(err.message));
  }
  console.log('\nshape        trial  first paid  renewal  pass');
  for (const r of results) {
    const pass = r.firstPaid === 14500 && r.renewal === 29000;
    console.log(`${r.shape.padEnd(12)} ${String(r.trial).padEnd(6)} ${String(r.firstPaid).padEnd(11)} ${String(r.renewal).padEnd(8)} ${pass ? 'PASS' : 'FAIL'}`);
  }
}

main().catch((err) => {
  console.error(`[mut525-spike] ${err.message}`);
  process.exit(1);
});
