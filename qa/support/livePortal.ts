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
  /** MUT-525: this run's launch coupon id, which the API reads; absent from Stripe unless a spec made it. */
  offerCouponId: string;
  /** MUT-532: this run's stay coupon id, which the API reads; made when the env starts. */
  stayCouponId: string;
  /** MUT-534: this run's come-back coupon id, which the API reads; made when the env starts. */
  comebackCouponId: string;
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

type Json = any;

export async function stripeApi(method: 'GET' | 'POST' | 'DELETE', endpoint: string, params: Record<string, string> = {}): Promise<Json> {
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
export async function customerOnClock(person: LivePerson, startAt = Math.floor(Date.now() / 1000)): Promise<{ customerId: string; clockId: string; now: number }> {
  // MUT-531: a clock may start in the past (the spike), so a flow can have months already paid by today.
  const now = startAt;
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

/**
 * A paid subscription on that customer (test card, monthly ILS unless named), mirrored into the API by the webhook.
 * `trialEnd` (MUT-418) starts it `trialing` until then, as our Checkout does during the free trial (ADR-170 R-D2).
 */
export async function subscribeByApi(customerId: string, lookupKey = 'freelancer_list_monthly_ils', trialEnd?: number, coupon?: string, metadata: Record<string, string> = {}): Promise<string> {
  await stripeApi('POST', 'payment_methods/pm_card_visa/attach', { customer: customerId }).catch(() => undefined);
  const methods = await stripeApi('GET', 'payment_methods', { customer: customerId, type: 'card' });
  const prices = await stripeApi('GET', 'prices', { 'lookup_keys[]': lookupKey });
  const sub = await stripeApi('POST', 'subscriptions', {
    customer: customerId,
    'items[0][price]': prices.data[0].id,
    default_payment_method: methods.data[0].id,
    ...(trialEnd ? { trial_end: String(trialEnd) } : {}),
    ...(coupon ? { 'discounts[0][coupon]': coupon } : {}),
    ...Object.fromEntries(Object.entries(metadata).map(([k, v]) => [`metadata[${k}]`, v])),
  });
  return sub.id;
}

/**
 * MUT-525 (R3, R6): this run's launch coupon, made only by the launch-offer specs and deleted by them (absent is the
 * default the other flows rely on). `redeemBy` defaults to three days from now; the offer shown ends an hour before.
 */
export async function createOfferCoupon(redeemBy = Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60): Promise<string> {
  const id = liveState().offerCouponId;
  await deleteOfferCoupon();
  await stripeApi('POST', 'coupons', { id, name: 'Launch offer · عرض الإطلاق', percent_off: '50', duration: 'once', 'applies_to[products][0]': 'mutaba3a_qa_freelancer', redeem_by: String(redeemBy) });
  return id;
}

export async function deleteOfferCoupon(): Promise<void> {
  await stripeApi('DELETE', `coupons/${liveState().offerCouponId}`).catch(() => undefined);
}

/** The person's invoices on a customer, oldest first: total, subtotal and the discount Stripe applied. */
export async function invoicesOf(customerId: string): Promise<{ total: number; subtotal: number; discount: number; reason: string }[]> {
  const listed = await stripeApi('GET', 'invoices', { customer: customerId, limit: '10' });
  return (listed.data as Json[])
    .sort((a, b) => a.created - b.created)
    .map((inv) => ({ total: inv.total, subtotal: inv.subtotal, discount: (inv.total_discount_amounts ?? []).reduce((sum: number, d: Json) => sum + d.amount, 0), reason: inv.billing_reason }));
}

/**
 * MUT-532: a monthly subscriber whose paid month ends `endsInS` seconds from now: the clock starts a calendar month
 * before that, so a pause booked from the period end starts, in real time, while the flow runs (the server's own
 * clock decides whether a pause is running; only Stripe runs on the test clock).
 */
export async function payingUntilSoon(person: LivePerson, endsInS = 120): Promise<{ customerId: string; clockId: string; subscriptionId: string; periodEnd: number }> {
  const end = new Date((Math.floor(Date.now() / 1000) + endsInS) * 1000);
  const start = new Date(end);
  start.setUTCMonth(start.getUTCMonth() - 1);
  const { customerId, clockId } = await customerOnClock(person, Math.floor(start.getTime() / 1000));
  const subscriptionId = await subscribeByApi(customerId);
  const sub = await stripeApi('GET', `subscriptions/${subscriptionId}`);
  return { customerId, clockId, subscriptionId, periodEnd: sub.items.data[0].current_period_end as number };
}

/** Waits, in real time, until the wall clock passes `unix` (the server's clock is the real one). */
export async function waitUntilPast(unix: number): Promise<void> {
  const ms = unix * 1000 - Date.now() + 1_000;
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Moves the test clock and waits until Stripe has finished acting on it. */
export async function advanceClock(clockId: string, toUnix: number): Promise<void> {
  await stripeApi('POST', `test_helpers/test_clocks/${clockId}/advance`, { frozen_time: String(toUnix) });
  await expect.poll(async () => (await stripeApi('GET', `test_helpers/test_clocks/${clockId}`)).status, { timeout: 120_000, intervals: [2_000] }).toBe('ready');
}

/**
 * Fills Stripe's hosted Checkout with the always-approved test card, up to its Subscribe button. Stripe's own fields
 * go by their ids (the page isn't ours); our custom field goes by the bilingual label we gave it. `taxNumber` fills
 * that field; `taxId` Stripe's tax ID.
 */
export async function fillStripeCheckout(page: Page, opts: { name: string; country: string; taxNumber?: string; taxId?: { type: string; value: string } }): Promise<void> {
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 });
  // Where Stripe offers another method too (Amazon Pay in USD), the card form opens only once Card is picked: the
  // whole row is the click area.
  const card = page.locator('[data-testid="card-accordion-item"]');
  if (await card.waitFor({ timeout: 5_000 }).then(() => true, () => false)) await card.click();
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
  if (opts.taxNumber) await page.getByRole('textbox', { name: /^Business tax number/ }).fill(opts.taxNumber);
  if (opts.taxId) {
    const business = page.getByRole('checkbox', { name: /business/i });
    if (await business.isVisible().catch(() => false)) await business.check();
    await page.locator('#taxIdType').selectOption({ value: opts.taxId.type }).catch(() => undefined);
    await page.locator('#taxId').fill(opts.taxId.value);
  }
}

/**
 * Pays the Checkout the page is on through Stripe's API, then follows its success URL back to the portal. Stripe's
 * page runs an hCaptcha on Subscribe that never passes under automation, and QA doesn't work around bot checks
 * (TD-201), so the subscription is made on the customer this Checkout was opened for, with the price it sells.
 * Checks the session first: our person's own customer (D3), subscription mode, the lookup key.
 */
export async function payCheckoutByApi(page: Page, person: LivePerson, lookupKey: string, opts: { trialEnd?: number; offerId?: string } = {}): Promise<{ subscriptionId: string; submitMessage: string }> {
  const sessionId = /\/(cs_test_[A-Za-z0-9]+)/.exec(page.url())?.[1];
  expect(sessionId, 'a Checkout Session in the page URL').toBeTruthy();
  const session = await stripeApi('GET', `checkout/sessions/${sessionId}`, { 'expand[]': 'line_items' });
  expect(session.mode).toBe('subscription');
  expect(session.line_items.data[0].price.lookup_key).toBe(lookupKey);
  const customer = await stripeApi('GET', `customers/${session.customer}`);
  expect(customer.metadata.mutaba3a_user_id).toBe(person.userId);
  // MUT-525: a Checkout carrying the launch coupon puts it and the offer's name (the server's subscription_data, which
  // a retrieved session doesn't show) on the subscription, as paying on the page would.
  const coupon = session.discounts?.[0]?.coupon as string | undefined;
  const subscriptionId = await subscribeByApi(session.customer, lookupKey, opts.trialEnd, coupon, coupon ? { mutaba3a_offer: opts.offerId ?? 'launch-2026' } : {});
  await stripeApi('POST', `checkout/sessions/${sessionId}/expire`);
  await page.goto(session.success_url);
  return { subscriptionId, submitMessage: session.custom_text?.submit?.message ?? '' };
}

// ---- MUT-418: people who start at a real signup, so their free trial is the one the redeem starts ----------------

const DB = { container: 'mutaba3a-test-pg', database: 'mutaba3a_qa_billing' };
const SIGNUP_PASSWORD = 'qa-live-trial-passphrase-long';

export interface TrialPerson extends LivePerson {
  password: string;
}

/** An address the fixture domain checker opens at once (business.example), unique to this run. */
function signupAddress(label: string): string {
  return `qa-trial-${label}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}@business.example`;
}

/** A random client address per signup, so the API's per-IP budget (it trusts one proxy hop here) never adds up. */
const randomIp = () => `10.${[0, 0, 0].map(() => Math.floor(Math.random() * 254) + 1).join('.')}`;

/**
 * Asks for a signup link as the /signup page does (Turnstile's always-pass test secret on this dev API), reads the
 * mail from the memory outbox, and returns the /setup link the person would click.
 */
export async function requestSignup(locale: 'en' | 'ar', label: string): Promise<{ email: string; setupLink: string }> {
  const { apiOrigin, portalOrigin, adminToken } = liveState();
  const email = signupAddress(label);
  const res = await fetch(`${apiOrigin}/v1/signups`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: portalOrigin, 'x-forwarded-for': randomIp() },
    body: JSON.stringify({ email, locale, turnstileToken: 'qa-turnstile-test-token' }),
  });
  expect(res.status, `signup ${await res.clone().text()}`).toBe(202);
  let link: string | undefined;
  await expect
    .poll(async () => {
      const mails = (await fetch(`${apiOrigin}/admin/v1/dev-outbox?to=${encodeURIComponent(email)}`, { headers: { 'x-admin-token': adminToken } }).then((r) => r.json())) as { mails: Array<{ template: string; text: string }> };
      link = mails.mails.filter((m) => m.template === 'finish-signup').at(-1)?.text.match(/https?:\/\/[^\s]+\/setup#[A-Za-z0-9_-]{43}/)?.[0];
      return link !== undefined;
    }, { message: `a finish-signup mail to ${email}`, timeout: 15_000 })
    .toBe(true);
  return { email, setupLink: link! };
}

/** Opens the mail's /setup link and finishes the account in the page's language; returns the signed-in person. */
export async function finishSignupInPage(page: Page, signup: { email: string; setupLink: string }, language: 'en' | 'ar'): Promise<TrialPerson> {
  const copy = language === 'ar'
    ? { finish: 'أكمل إنشاء حسابك', password: 'كلمة المرور الجديدة', terms: /شروط الخدمة/, create: 'أنشئ الحساب' }
    : { finish: 'Finish creating your account', password: 'New password', terms: /terms of service/, create: 'Create account' };
  await page.goto(signup.setupLink);
  await expect(page.getByRole('heading', { level: 1, name: copy.finish })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel(copy.password).fill(SIGNUP_PASSWORD);
  await page.getByRole('checkbox', { name: copy.terms }).check();
  await page.getByRole('button', { name: copy.create }).click();
  await page.waitForURL(/\/p\/[0-9a-f-]{36}/, { timeout: 30_000 });
  const me = await (await page.request.get('/v1/me')).json();
  const personal = me.profiles.find((p: { isPersonalDefault: boolean }) => p.isPersonalDefault);
  return { userId: me.user.id, email: signup.email, personalId: personal.id, password: SIGNUP_PASSWORD };
}

/** Moves the person's trial start in the QA database (no clock route exists): `daysAgo` days before now. */
export function setTrialStartedDaysAgo(userId: string, daysAgo: number): void {
  const sql = `UPDATE users SET "trialStartedAt" = now() - interval '${Number(daysAgo)} days' WHERE id = '${userId.replace(/[^0-9a-f-]/g, '')}'`;
  execFileSync('docker', ['exec', DB.container, 'psql', '-U', 'mutaba3a', '-d', DB.database, '-v', 'ON_ERROR_STOP=1', '-c', sql], { stdio: 'ignore' });
}

/** MUT-533: what the memory mailer "sent" to an address, oldest first. */
export async function outboxOf(email: string): Promise<Array<{ template: string; locale: string; subject: string; text: string; html: string }>> {
  const { apiOrigin, adminToken } = liveState();
  const res = await fetch(`${apiOrigin}/admin/v1/dev-outbox?to=${encodeURIComponent(email)}`, { headers: { 'x-admin-token': adminToken } });
  return ((await res.json()) as { mails: Array<{ template: string; locale: string; subject: string; text: string; html: string }> }).mails;
}

/** MUT-533: runs a mail job now, as the operator's `npm run billing:…-mail` does, through the admin door. */
export async function runMailJob(job: 'card-failed-mail' | 'comeback-mail', dryRun = false): Promise<Json> {
  const { apiOrigin, adminToken } = liveState();
  const res = await fetch(`${apiOrigin}/admin/v1/billing/${job}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': adminToken }, body: JSON.stringify({ dryRun }) });
  expect(res.status, `${job} ${await res.clone().text()}`).toBe(200);
  return res.json();
}

/**
 * MUT-533: a monthly subscriber whose renewal declined `failedAgoS` seconds ago, on a test clock started in the past
 * (MUT-531's spike): paid with a good card, then switched to Stripe's always-declining test card before the renewal
 * (or `pm_card_authenticationRequired`, a card whose bank always wants the person to confirm).
 */
export async function declinedRenewal(person: LivePerson, failedAgoS: number, failingCard = 'pm_card_chargeCustomerFail'): Promise<{ customerId: string; clockId: string; subscriptionId: string }> {
  const nowS = Math.floor(Date.now() / 1000);
  const startAt = nowS - failedAgoS - 31 * 24 * 60 * 60;
  const { customerId, clockId } = await customerOnClock(person, startAt);
  const subscriptionId = await subscribeByApi(customerId);
  const declining = await stripeApi('POST', `payment_methods/${failingCard}/attach`, { customer: customerId });
  await stripeApi('POST', `subscriptions/${subscriptionId}`, { default_payment_method: declining.id });
  const sub = await stripeApi('GET', `subscriptions/${subscriptionId}`);
  // Past the renewal and its first attempt (an hour after the invoice), and no further than now less a minute.
  await advanceClock(clockId, Math.min(sub.items.data[0].current_period_end + 2 * 60 * 60, nowS - 60));
  return { customerId, clockId, subscriptionId };
}

/**
 * MUT-534: a person whose monthly plan took one payment and then ended `endedDaysAgo` days ago, on a test clock started
 * in the past: paid once, cancelled at the period end, the clock run past it.
 */
export async function paidLapse(person: LivePerson, endedDaysAgo: number): Promise<{ customerId: string; clockId: string; subscriptionId: string }> {
  const nowS = Math.floor(Date.now() / 1000);
  const { customerId, clockId } = await customerOnClock(person, nowS - (endedDaysAgo + 31) * 24 * 60 * 60);
  const subscriptionId = await subscribeByApi(customerId);
  await stripeApi('POST', `subscriptions/${subscriptionId}`, { cancel_at_period_end: 'true' });
  const sub = await stripeApi('GET', `subscriptions/${subscriptionId}`);
  await advanceClock(clockId, Math.min(sub.items.data[0].current_period_end + 2 * 60 * 60, nowS - 60));
  return { customerId, clockId, subscriptionId };
}

