// MUT-531 spike (2026-11-02): node qa/support/mut531-switch-spike.mjs [pm_card_authenticationRequired]
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
async function advance(clock, to) { await api('POST', `test_helpers/test_clocks/${clock}/advance`, { frozen_time: String(to) }); for (;;) { const c = await api('GET', `test_helpers/test_clocks/${clock}`); if (c.status === 'ready') return; await sleep(2000); } }
const card = process.argv[2] ?? 'pm_card_visa';
const now = Math.floor(Date.now() / 1000);
const start = now - 31 * 86400 - 3 * 3600;
const clock = await api('POST', 'test_helpers/test_clocks', { frozen_time: String(start), name: 'MUT-531 spike' });
console.log('clock created in the past:', clock.status);
const cus = await api('POST', 'customers', { email: 'spike@studio.ps', test_clock: clock.id, 'address[country]': 'IL' });
await api('POST', 'payment_methods/pm_card_visa/attach', { customer: cus.id });
const pm = (await api('GET', 'payment_methods', { customer: cus.id, type: 'card' })).data[0].id;
const month = (await api('GET', 'prices', { 'lookup_keys[]': 'freelancer_list_monthly_ils' })).data[0];
const year = (await api('GET', 'prices', { 'lookup_keys[]': 'freelancer_list_yearly_ils' })).data[0];
const sub = await api('POST', 'subscriptions', { customer: cus.id, 'items[0][price]': month.id, default_payment_method: pm, 'automatic_tax[enabled]': 'true' });
await advance(clock.id, now - 120);
const paid = await api('GET', 'invoices', { subscription: sub.id, status: 'paid', limit: '5' });
console.log('paid invoices with money:', paid.data.filter((i) => i.amount_paid > 0).length, paid.data.map((i) => i.amount_paid));
const fresh = await api('GET', `subscriptions/${sub.id}`, { 'expand[0]': 'test_clock' });
const prorationDate = fresh.test_clock.frozen_time;
console.log('expanded clock frozen', prorationDate);
const item = fresh.items.data[0];
if (card !== 'pm_card_visa') {
  await api('POST', `payment_methods/${card}/attach`, { customer: cus.id }).catch((e) => console.log('attach', e.message));
  const pms = (await api('GET', 'payment_methods', { customer: cus.id, type: 'card' })).data;
  const other = pms.find((p) => p.id !== pm) ?? pms[0];
  await api('POST', `subscriptions/${sub.id}`, { default_payment_method: other.id });
}
const preview = await api('POST', 'invoices/create_preview', { customer: cus.id, subscription: sub.id, 'subscription_details[items][0][id]': item.id, 'subscription_details[items][0][price]': year.id, 'subscription_details[proration_behavior]': 'always_invoice', 'subscription_details[proration_date]': String(prorationDate) });
console.log('preview amount_due', preview.amount_due, 'subscription_proration_date', preview.subscription_proration_date, 'clock now', now - 120, 'real now', Math.floor(Date.now() / 1000));
try {
  const updated = await api('POST', `subscriptions/${sub.id}`, { 'items[0][id]': item.id, 'items[0][price]': year.id, proration_behavior: 'always_invoice', proration_date: String(prorationDate), payment_behavior: 'pending_if_incomplete', 'expand[0]': 'latest_invoice' });
  console.log('pending_update', JSON.stringify(updated.pending_update), 'price now', updated.items.data[0].price.lookup_key, 'period end', updated.items.data[0].current_period_end, 'discounts', updated.discounts);
  const inv = updated.latest_invoice;
  console.log('latest invoice', inv.status, 'amount_paid', inv.amount_paid, 'amount_due', inv.amount_due, 'hosted', Boolean(inv.hosted_invoice_url));
  if (updated.pending_update) {
    const full = await api('GET', `invoices/${inv.id}`, { 'expand[0]': 'payments.data.payment.payment_intent' });
    console.log('payment intents', (full.payments?.data ?? []).map((p) => p.payment?.payment_intent?.status));
  }
} catch (e) { console.log('update error', e.message); }
await api('DELETE', `test_helpers/test_clocks/${clock.id}`);
