// MUT-532 spike (2026-11-02): node qa/support/mut532-pause-spike.mjs
// (a) pause_collection void from the paid period's end, resumes_at = the boundary 2 months on − 1 h;
// (b) Resume now mid-pause with billing_cycle_anchor=now; (d) a repeating 2-month 50% coupon on monthly.
// (c) and (e) were MUT-531's (mut-531-switch-spike-result.md).
import { sandboxKey } from './billing-live.mjs';
const KEY = sandboxKey();
const VERSION = '2026-09-30.endive';
async function api(method, path, params = {}) {
  const body = new URLSearchParams(params).toString();
  const url = `https://api.stripe.com/v1/${path}${method === 'GET' && body ? `?${body}` : ''}`;
  const res = await fetch(url, { method, headers: { authorization: `Bearer ${KEY}`, 'stripe-version': VERSION, 'content-type': 'application/x-www-form-urlencoded' }, body: method === 'GET' ? undefined : body });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${JSON.stringify(json.error)}`);
  return json;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function advance(clock, to) {
  await api('POST', `test_helpers/test_clocks/${clock}/advance`, { frozen_time: String(to) });
  for (;;) { const c = await api('GET', `test_helpers/test_clocks/${clock}`); if (c.status === 'ready') return; await sleep(2000); }
}
/** Stripe's monthly rule: the anchor's day of the month, clamped to the month's last day, at the anchor's time. */
function boundary(anchorSec, k) {
  const a = new Date(anchorSec * 1000);
  const y = a.getUTCFullYear(), m = a.getUTCMonth() + k;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Math.floor(Date.UTC(y, m, Math.min(a.getUTCDate(), last), a.getUTCHours(), a.getUTCMinutes(), a.getUTCSeconds()) / 1000);
}
function boundaryAfter(anchorSec, fromSec, months) {
  let k = 0;
  while (boundary(anchorSec, k) < fromSec) k += 1;
  return boundary(anchorSec, k + months);
}
const iso = (s) => new Date(s * 1000).toISOString();
async function invoicesOf(sub) {
  const list = await api('GET', 'invoices', { subscription: sub, limit: '10' });
  return list.data.reverse().map((i) => `${iso(i.period_end ?? i.created).slice(0, 10)}:${i.status}:${i.amount_paid}/${i.amount_due}`);
}

const now = Math.floor(Date.now() / 1000);
const start = now - 31 * 86400 - 3 * 3600;
const clock = await api('POST', 'test_helpers/test_clocks', { frozen_time: String(start), name: 'MUT-532 spike' });
const month = (await api('GET', 'prices', { 'lookup_keys[]': 'freelancer_list_monthly_ils' })).data[0];
async function payer(email) {
  const cus = await api('POST', 'customers', { email, test_clock: clock.id, 'address[country]': 'IL' });
  await api('POST', 'payment_methods/pm_card_visa/attach', { customer: cus.id });
  const pm = (await api('GET', 'payment_methods', { customer: cus.id, type: 'card' })).data[0].id;
  return api('POST', 'subscriptions', { customer: cus.id, 'items[0][price]': month.id, default_payment_method: pm, 'automatic_tax[enabled]': 'true' });
}
const pauseA = await payer('pause-a@studio.ps');
const resumeB = await payer('resume-b@studio.ps');
const stayC = await payer('stay-c@studio.ps');
let coupon;
try {
  await advance(clock.id, now - 120);
  const a = await api('GET', `subscriptions/${pauseA.id}`);
  const anchor = a.billing_cycle_anchor;
  const periodEnd = a.items.data[0].current_period_end;
  const resumesAt = boundaryAfter(anchor, periodEnd, 2) - 3600;
  console.log('anchor', iso(anchor), 'period end', iso(periodEnd), 'resumes_at', iso(resumesAt));
  for (const s of [pauseA.id, resumeB.id]) {
    await api('POST', `subscriptions/${s}`, { 'pause_collection[behavior]': 'void', 'pause_collection[resumes_at]': String(resumesAt), 'metadata[mutaba3a_pause_from]': iso(periodEnd), 'metadata[mutaba3a_pause_months]': '2' });
  }
  coupon = await api('POST', 'coupons', { id: `spike_stay_${now}`, percent_off: '50', duration: 'repeating', duration_in_months: '2', 'applies_to[products][0]': month.product, name: 'Spike stay' });
  await api('POST', `subscriptions/${stayC.id}`, { 'discounts[0][coupon]': coupon.id });
  const set = await api('GET', `subscriptions/${pauseA.id}`);
  console.log('(a) after setting: status', set.status, 'pause_collection', JSON.stringify(set.pause_collection), 'invoices', await invoicesOf(pauseA.id));

  // Month 1 of the pause.
  await advance(clock.id, periodEnd + 3600);
  const m1 = await api('GET', `subscriptions/${pauseA.id}`);
  console.log('(a) pause month 1: status', m1.status, 'period end', iso(m1.items.data[0].current_period_end), 'invoices', await invoicesOf(pauseA.id));

  // (b) Resume now, mid-pause.
  // Clearing the pause and restarting the cycle today makes no invoice at all (any proration_behavior; always_invoice
  // charges only the new month less a credit for the voided one). So Resume now adds the month as its own invoice on
  // the subscription: a declined card leaves it past_due, Stripe's normal retries.
  const restarted = await api('POST', `subscriptions/${resumeB.id}`, { pause_collection: '', 'billing_cycle_anchor[type]': 'now', proration_behavior: 'none' });
  const item = restarted.items.data[0];
  await api('POST', 'invoiceitems', { customer: restarted.customer, subscription: resumeB.id, 'price_data[currency]': month.currency, 'price_data[product]': month.product, 'price_data[unit_amount]': String(month.unit_amount), 'price_data[tax_behavior]': month.tax_behavior, 'period[start]': String(item.current_period_start), 'period[end]': String(item.current_period_end) });
  const draft = await api('POST', 'invoices', { customer: restarted.customer, subscription: resumeB.id, auto_advance: 'true', 'automatic_tax[enabled]': 'true' });
  await api('POST', `invoices/${draft.id}/finalize`);
  await api('POST', `invoices/${draft.id}/pay`);
  const resumed = await api('GET', `subscriptions/${resumeB.id}`, { 'expand[0]': 'latest_invoice' });
  console.log('(b) resumed: status', resumed.status, 'pause', resumed.pause_collection, 'anchor', iso(resumed.billing_cycle_anchor), 'period', iso(resumed.items.data[0].current_period_start), '→', iso(resumed.items.data[0].current_period_end), 'latest', resumed.latest_invoice.status, resumed.latest_invoice.amount_paid);
  console.log('(b) invoices', await invoicesOf(resumeB.id));

  const second = boundary(anchor, 0) <= periodEnd ? boundaryAfter(anchor, periodEnd, 1) : null;
  await advance(clock.id, second + 3600);
  const m2 = await api('GET', `subscriptions/${pauseA.id}`);
  console.log('(a) pause month 2: status', m2.status, 'pause', JSON.stringify(m2.pause_collection), 'invoices', await invoicesOf(pauseA.id));

  await advance(clock.id, resumesAt + 2 * 3600);
  const back = await api('GET', `subscriptions/${pauseA.id}`);
  console.log('(a) after resumes_at: status', back.status, 'pause', JSON.stringify(back.pause_collection), 'metadata', JSON.stringify(back.metadata), 'period end', iso(back.items.data[0].current_period_end), 'invoices', await invoicesOf(pauseA.id));
  console.log('(b) invoices at the end', await invoicesOf(resumeB.id));
  console.log('(d) stay invoices', await invoicesOf(stayC.id), 'discounts now', JSON.stringify((await api('GET', `subscriptions/${stayC.id}`)).discounts));
} finally {
  if (coupon) await api('DELETE', `coupons/${coupon.id}`).catch(() => {});
  await api('DELETE', `test_helpers/test_clocks/${clock.id}`);
}
