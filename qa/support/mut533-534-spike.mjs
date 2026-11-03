// MUT-533/534 spike (2026-11-02): node qa/support/mut533-534-spike.mjs
// Plan §5 step 0, sandbox key only. Everything it makes (a test clock and its customers, a coupon) is deleted at the end.
// (a) Smart Retries: attempt times, next_payment_attempt, finalized_at vs the first failure, when Stripe gives up and what
//     it does then; (b) a 5-level expand from the subscription vs the 4-level one from the invoice; (c) a Customer Portal
//     session with the payment_method_update flow and a redirect after completion; (e) a ₪20 / $6 `once` coupon on the
//     four list prices; (f) a renewal that needs 3-D Secure; (g) ended_at after cancel-at-period-end; (h) a cancelled
//     ILS customer subscribing in USD.
import { sandboxKey } from './billing-live.mjs';

const KEY = sandboxKey();
const VERSION = '2026-09-30.endive';
const PRODUCT_ID = 'mutaba3a_qa_freelancer';
const DAY = 86400;

async function api(method, path, params = {}, { allowError = false } = {}) {
  const body = new URLSearchParams(params).toString();
  const url = `https://api.stripe.com/v1/${path}${method === 'GET' && body ? `?${body}` : ''}`;
  const res = await fetch(url, { method, headers: { authorization: `Bearer ${KEY}`, 'stripe-version': VERSION, 'content-type': 'application/x-www-form-urlencoded' }, body: method === 'GET' ? undefined : body });
  const json = await res.json();
  if (!res.ok && !allowError) throw new Error(`${method} ${path}: ${JSON.stringify(json.error)}`);
  return res.ok ? json : { error: json.error };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function advance(clock, to) {
  await api('POST', `test_helpers/test_clocks/${clock}/advance`, { frozen_time: String(to) });
  for (;;) {
    const c = await api('GET', `test_helpers/test_clocks/${clock}`);
    if (c.status === 'ready') return;
    if (c.status === 'internal_failure') throw new Error('test clock failed');
    await sleep(2000);
  }
}
const iso = (s) => (s ? new Date(s * 1000).toISOString().slice(0, 16) : null);
const priceOf = async (lookupKey) => (await api('GET', 'prices', { 'lookup_keys[]': lookupKey })).data[0];

const now = Math.floor(Date.now() / 1000);
const start = now - 40 * DAY;
const clock = await api('POST', 'test_helpers/test_clocks', { frozen_time: String(start), name: 'MUT-533/534 spike' });
const monthIls = await priceOf('freelancer_list_monthly_ils');
const monthUsd = await priceOf('freelancer_list_monthly_usd');
let coupon = null;

async function subscriber(email, failingCard) {
  const cus = await api('POST', 'customers', { email, test_clock: clock.id, 'address[country]': 'IL' });
  const good = await api('POST', 'payment_methods/pm_card_visa/attach', { customer: cus.id });
  const sub = await api('POST', 'subscriptions', { customer: cus.id, 'items[0][price]': monthIls.id, default_payment_method: good.id, 'automatic_tax[enabled]': 'true' });
  if (failingCard) {
    const bad = await api('POST', `payment_methods/${failingCard}/attach`, { customer: cus.id });
    await api('POST', `subscriptions/${sub.id}`, { default_payment_method: bad.id });
  }
  return { cus, sub };
}

async function snapshot(subId) {
  const sub = await api('GET', `subscriptions/${subId}`);
  const open = await api('GET', 'invoices', { subscription: subId, status: 'open', limit: '10' });
  const oldest = open.data.sort((a, b) => a.created - b.created)[0] ?? null;
  let pi = null;
  if (oldest) {
    const inv = await api('GET', `invoices/${oldest.id}`, { 'expand[]': 'payments.data.payment.payment_intent' });
    const intents = (inv.payments?.data ?? []).map((p) => p.payment?.payment_intent).filter((x) => x && typeof x === 'object');
    pi = intents[intents.length - 1] ?? null;
  }
  return {
    status: sub.status,
    endedAt: iso(sub.ended_at),
    periodEnd: iso(sub.items.data[0].current_period_end),
    openInvoices: open.data.length,
    invoice: oldest && {
      id: oldest.id,
      created: iso(oldest.created),
      finalizedAt: iso(oldest.status_transitions?.finalized_at),
      attemptCount: oldest.attempt_count,
      attempted: oldest.attempted,
      nextPaymentAttempt: iso(oldest.next_payment_attempt),
    },
    intent: pi && { status: pi.status, error: pi.last_payment_error?.code ?? null, decline: pi.last_payment_error?.decline_code ?? null },
  };
}

try {
  const declined = await subscriber('declined-a@studio.ps', 'pm_card_chargeCustomerFail');
  const threeDs = await subscriber('threeds-b@studio.ps', 'pm_card_authenticationRequired');
  const ending = await subscriber('ending-c@studio.ps', null);
  await api('POST', `subscriptions/${ending.sub.id}`, { cancel_at_period_end: 'true' });

  // (b) expand depth
  const deep = await api('GET', `subscriptions/${declined.sub.id}`, { 'expand[]': 'latest_invoice.payments.data.payment.payment_intent' }, { allowError: true });
  console.log('(b) 5-level expand from the subscription:', deep.error ? `refused: ${deep.error.message}` : 'accepted');

  // (a)(f)(g): the renewal is a month after start; step a day at a time for 35 days past it.
  const renewal = declined.sub.items.data[0].current_period_end;
  const seen = new Map();
  for (let t = renewal + 2 * 3600; t <= renewal + 35 * DAY; t += DAY) {
    await advance(clock.id, t);
    for (const [name, s] of [['declined', declined], ['3ds', threeDs], ['ending', ending]]) {
      const snap = JSON.stringify(await snapshot(s.sub.id));
      if (seen.get(name) !== snap) console.log(`${iso(t)} ${name} ${snap}`);
      seen.set(name, snap);
    }
  }

  // (h) the ended ILS customer subscribes in USD.
  const usd = await api('POST', 'subscriptions', { customer: ending.cus.id, 'items[0][price]': monthUsd.id, default_payment_method: (await api('GET', 'payment_methods', { customer: ending.cus.id, type: 'card' })).data[0].id }, { allowError: true });
  console.log('(h) USD subscription after an ended ILS one:', usd.error ? `refused: ${usd.error.message}` : `${usd.status} ${usd.currency}`);

  // (c) the portal's card flow
  const portal = await api('POST', 'billing_portal/sessions', {
    customer: declined.cus.id,
    return_url: 'https://portal.example.test/?billing=true',
    'flow_data[type]': 'payment_method_update',
    'flow_data[after_completion][type]': 'redirect',
    'flow_data[after_completion][redirect][return_url]': 'https://portal.example.test/?billing=true&portal=returned',
  }, { allowError: true });
  console.log('(c) portal payment_method_update session:', portal.error ? `refused: ${portal.error.message}` : 'created');

  // (e) the come-back coupon on the four list prices
  coupon = await api('POST', 'coupons', {
    name: 'MUT-534 spike', duration: 'once', amount_off: '2000', currency: 'ils',
    'currency_options[usd][amount_off]': '600', 'applies_to[products][0]': PRODUCT_ID,
  });
  const read = await api('GET', `coupons/${coupon.id}`, { 'expand[]': 'currency_options' });
  console.log('(e) coupon read back:', JSON.stringify({ amount_off: read.amount_off, currency: read.currency, currency_options: read.currency_options, applies_to: read.applies_to ?? '(needs expand)' }));
  for (const key of ['freelancer_list_monthly_ils', 'freelancer_list_yearly_ils', 'freelancer_list_monthly_usd', 'freelancer_list_yearly_usd']) {
    const price = await priceOf(key);
    const preview = await api('POST', 'invoices/create_preview', {
      'customer_details[address][country]': key.endsWith('ils') ? 'IL' : 'GB',
      'subscription_details[items][0][price]': price.id,
      'discounts[0][coupon]': coupon.id,
    }, { allowError: true });
    console.log(`(e) ${key}:`, preview.error ? `refused: ${preview.error.message}` : `subtotal ${preview.subtotal} discount ${(preview.total_discount_amounts ?? []).reduce((s, d) => s + d.amount, 0)} total_excluding_tax ${preview.total_excluding_tax} ${preview.currency}`);
  }
} finally {
  await api('DELETE', `test_helpers/test_clocks/${clock.id}`, {}, { allowError: true });
  if (coupon) await api('DELETE', `coupons/${coupon.id}`, {}, { allowError: true });
  console.log('cleaned up');
}
