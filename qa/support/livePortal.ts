/**
 * MUT-362 (eng review D8 B): helpers for the `portal-live` specs. The env is started by support/billing-live.mjs;
 * these read its state file, make people through the real admin API, sign them in, and drive the Stripe sandbox
 * by its REST API (customers on test clocks, subscriptions paid with test cards, clock advances).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';
import { CURRENT_TERMS } from '../../server/src/legal';

interface LiveState {
  apiOrigin: string;
  portalOrigin: string;
  adminToken: string;
}

const STATE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.state', 'portal-live.json');
const PASSWORD = 'qa-live-correct-horse-battery';

export function liveState(): LiveState {
  return JSON.parse(fs.readFileSync(STATE, 'utf8')) as LiveState;
}

let cachedKey: string | null = null;
function sandboxKey(): string {
  cachedKey ??= execFileSync('security', ['find-generic-password', '-s', 'release-kit', '-a', 'barmajiyat/MUTABA3A_STRIPE_SANDBOX_KEY', '-w'], { encoding: 'utf8' }).trim();
  if (!/^(sk|rk)_test_/.test(cachedKey)) throw new Error('Not a Stripe test key');
  return cachedKey;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

export async function stripeApi(method: 'GET' | 'POST', endpoint: string, params: Record<string, string> = {}): Promise<Json> {
  const body = new URLSearchParams(params).toString();
  const res = await fetch(`https://api.stripe.com/v1/${endpoint}${method === 'GET' && body ? `?${body}` : ''}`, {
    method,
    headers: { authorization: `Bearer ${sandboxKey()}`, 'content-type': 'application/x-www-form-urlencoded' },
    ...(method === 'POST' ? { body } : {}),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Stripe ${method} /v1/${endpoint}: ${res.status} ${json.error?.message ?? ''}`);
  return json;
}

export interface LivePerson {
  userId: string;
  email: string;
  personalId: string;
}

/** A new hosted person with a password set through their setup link, as the operator's create + the setup page do. */
export async function provisionPerson(locale: 'en' | 'ar', label: string): Promise<LivePerson> {
  const { apiOrigin, portalOrigin, adminToken } = liveState();
  const email = `qa-billing-${label}-${Date.now()}@mtb3a.test`;
  const created = await fetch(`${apiOrigin}/admin/v1/users`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-token': adminToken },
    body: JSON.stringify({ email, displayName: 'Rana Saleh', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', locale }),
  }).then((r) => r.json() as Promise<Json>);
  const token = new URL(created.setupLink.url).hash.slice(1);
  const redeemed = await fetch(`${apiOrigin}/v1/account-setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: portalOrigin },
    body: JSON.stringify({ token, password: PASSWORD, acceptedTermsVersion: CURRENT_TERMS.version }),
  });
  if (!redeemed.ok) throw new Error(`setup link: ${redeemed.status} ${await redeemed.text()}`);
  return { userId: created.user.id, email, personalId: created.personalProfile.id };
}

/** Signs the page's context in (the session cookie lands on the portal's origin through its /v1 proxy). */
export async function signIn(page: Page, person: LivePerson): Promise<void> {
  const { portalOrigin } = liveState();
  const res = await page.request.post('/v1/sessions', { data: { email: person.email, password: PASSWORD }, headers: { origin: portalOrigin } });
  expect(res.ok(), `sign-in ${res.status()}`).toBe(true);
}

/** A sandbox customer on a fresh test clock, as findOrCreateCustomer would find it (email + our metadata). */
export async function customerOnClock(person: LivePerson): Promise<{ customerId: string; clockId: string; now: number }> {
  const now = Math.floor(Date.now() / 1000);
  const clock = await stripeApi('POST', 'test_helpers/test_clocks', { frozen_time: String(now), name: `MUT-362 QA ${person.email}` });
  const customer = await stripeApi('POST', 'customers', {
    email: person.email,
    name: 'Rana Saleh',
    test_clock: clock.id,
    'metadata[mutaba3a_user_id]': person.userId,
    'address[country]': 'IL',
  });
  return { customerId: customer.id, clockId: clock.id, now };
}

/** A paid monthly ILS subscription on that customer (test card), mirrored into the API by the webhook. */
export async function subscribeByApi(customerId: string): Promise<string> {
  await stripeApi('POST', 'payment_methods/pm_card_visa/attach', { customer: customerId }).catch(() => undefined);
  const methods = await stripeApi('GET', 'payment_methods', { customer: customerId, type: 'card' });
  const prices = await stripeApi('GET', 'prices', { 'lookup_keys[]': 'freelancer_list_monthly_ils' });
  const sub = await stripeApi('POST', 'subscriptions', {
    customer: customerId,
    'items[0][price]': prices.data[0].id,
    default_payment_method: methods.data[0].id,
  });
  return sub.id;
}

/** Moves the test clock and waits until Stripe has finished acting on it. */
export async function advanceClock(clockId: string, toUnix: number): Promise<void> {
  await stripeApi('POST', `test_helpers/test_clocks/${clockId}/advance`, { frozen_time: String(toUnix) });
  await expect.poll(async () => (await stripeApi('GET', `test_helpers/test_clocks/${clockId}`)).status, { timeout: 120_000, intervals: [2_000] }).toBe('ready');
}

/**
 * Fills Stripe's hosted Checkout with the always-approved test card and pays. Field ids are Stripe's own (the page
 * isn't ours, so no translated labels to prefer). `taxNumber` fills our custom field; `taxId` Stripe's tax ID.
 */
export async function payOnStripeCheckout(page: Page, opts: { name: string; country: string; taxNumber?: string; taxId?: { type: string; value: string } }): Promise<void> {
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 });
  await page.locator('#cardNumber').fill('4242 4242 4242 4242');
  await page.locator('#cardExpiry').fill('12 / 34');
  await page.locator('#cardCvc').fill('123');
  await page.locator('#billingName').fill(opts.name);
  await page.locator('#billingCountry').selectOption(opts.country);
  const address = page.locator('#billingAddressLine1');
  if (await address.isVisible().catch(() => false)) await address.fill('1 Test Street');
  const city = page.locator('#billingLocality');
  if (await city.isVisible().catch(() => false)) await city.fill('Haifa');
  const postal = page.locator('#billingPostalCode');
  if (await postal.isVisible().catch(() => false)) await postal.fill('3100001');
  if (opts.taxNumber) await page.locator('#business_tax_number').fill(opts.taxNumber);
  if (opts.taxId) {
    const business = page.getByRole('checkbox', { name: /business/i });
    if (await business.isVisible().catch(() => false)) await business.check();
    await page.locator('#taxIdType').selectOption({ value: opts.taxId.type }).catch(() => undefined);
    await page.locator('#taxId').fill(opts.taxId.value);
  }
  await page.locator('button[type="submit"]').click();
}
