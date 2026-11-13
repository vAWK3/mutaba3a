import { test, expect } from '../../support/qa';
import {
  advanceClock,
  createOfferCoupon,
  customerOnClock,
  declinedRenewal,
  deleteOfferCoupon,
  fillStripeCheckout,
  stripeFormFrame,
  finishSignupInPage,
  invoicesOf,
  liveState,
  outboxOf,
  paidLapse,
  payCheckoutByApi,
  payingUntilSoon,
  provisionPerson,
  requestSignup,
  runMailJob,
  setTrialStartedDaysAgo,
  signIn,
  stripeApi,
  subscribeByApi,
  untilSubscriptionMirrored,
  waitUntilPast,
} from '../../support/livePortal';
import { openYou } from '../../support/you';

/**
 * MUT-362 (eng review D8 B): Settings › Billing on a real dev API and Stripe's real sandbox pages, started by
 * support/billing-live.mjs. Each test makes its own person; money moves only in the sandbox, on test cards.
 */

const DAY_S = 24 * 60 * 60;

async function openBilling(page: import('@playwright/test').Page, personalId: string) {
  await page.goto(`/p/${personalId}`);
  // MUT-425: Billing is a row on You › Account (was the account menu)
  await openYou(page, 'account');
  await page.getByRole('button', { name: /^Billing|^الاشتراك/ }).click();
  return page.getByRole('dialog', { name: /^Billing$|^الاشتراك$/ });
}

test('Subscribe in shekels from Israel as a business, pay with a test card, and come back subscribed', { tag: '@portal-live.billing.subscribe' }, async ({ page, step }) => {
  const person = await provisionPerson('en', 'ils');
  await signIn(page, person);

  const drawer = await step('Open Billing from You › Account', async () => openBilling(page, person.personalId));
  await step('Read where I stand, the prices and the rules before anything else', async () => {
    await expect(drawer.getByRole('button', { name: 'Subscribe' })).toBeVisible();
    await expect(drawer.getByText('₪29.00')).toBeVisible();
    await expect(drawer.getByText('$9.00')).toBeVisible();
    await expect(drawer.getByText('Prices exclude VAT; VAT is added where the law requires it.')).toBeVisible();
  });
  await step('Press Subscribe and choose Israel, for a business, monthly', async () => {
    await drawer.getByRole('button', { name: 'Subscribe' }).click();
    const form = page.getByRole('dialog', { name: 'Subscribe to Freelancer' });
    await form.getByRole('combobox', { name: 'Billing address country' }).selectOption('IL');
    await form.getByRole('radio', { name: /For a business/ }).check();
    await expect(form.getByText('₪29.00')).toBeVisible();
    await expect(form.getByText(/It's in English; you'll come back here/)).toBeVisible();
  });
  await step('Continue to Stripe’s payment page', async () => {
    await page.getByRole('button', { name: 'Continue to payment' }).click();
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 });
    await expect(page.getByText(/29\.00/).first()).toBeVisible();
  });
  await step('Fill in the test card, an Israeli address and the business tax number', async () => {
    await fillStripeCheckout(page, { name: 'Rana Saleh', country: 'IL', taxNumber: '516000000' });
    await expect(((await stripeFormFrame(page)) ?? page).getByRole('textbox', { name: 'Business tax number · الرقم الضريبي' })).toHaveValue('516000000');
    await expect(((await stripeFormFrame(page)) ?? page).getByText(/Prices exclude VAT; VAT is added where the law requires it\./)).toBeVisible();
  });
  await step('Pay (through Stripe’s API: its page blocks automated payment, TD-201)', async () => {
    await payCheckoutByApi(page, person, 'freelancer_list_monthly_ils');
  });
  await step('Come back to the portal: confirming, then subscribed', async () => {
    await page.waitForURL(/checkout=success/, { timeout: 90_000 });
    const back = page.getByRole('dialog', { name: 'Billing' });
    await expect(back.locator('.hp-banner', { hasText: "You're subscribed. Thank you." })).toBeVisible({ timeout: 45_000 });
    await expect(back.getByRole('button', { name: 'Manage billing' })).toBeVisible();
  });
});

test('Subscribe in dollars from the Emirates as a business with a tax ID', { tag: '@portal-live.billing.subscribe-usd' }, async ({ page, step }) => {
  const person = await provisionPerson('en', 'usd');
  await signIn(page, person);
  const drawer = await step('Open Billing and press Subscribe', async () => {
    const d = await openBilling(page, person.personalId);
    await d.getByRole('button', { name: 'Subscribe' }).click();
    return page.getByRole('dialog', { name: 'Subscribe to Freelancer' });
  });
  await step('Choose the Emirates, for a business, yearly', async () => {
    await drawer.getByRole('combobox', { name: 'Billing address country' }).selectOption('AE');
    await drawer.getByRole('radio', { name: /For a business/ }).check();
    await drawer.getByRole('radio', { name: 'Yearly · 2 months free' }).click();
    await expect(drawer.getByText('$90.00')).toBeVisible();
  });
  await step('Fill in Stripe’s page with the test card and a UAE TRN', async () => {
    await page.getByRole('button', { name: 'Continue to payment' }).click();
    await fillStripeCheckout(page, { name: 'Rana Saleh', country: 'AE', taxId: { type: 'ae_trn', value: '123456789012345' } });
    await expect(page.getByText(/90\.00/).first()).toBeVisible();
  });
  await step('Pay (through Stripe’s API: its page blocks automated payment, TD-201)', async () => {
    await payCheckoutByApi(page, person, 'freelancer_list_yearly_usd');
  });
  await step('Come back subscribed', async () => {
    await page.waitForURL(/checkout=success/, { timeout: 90_000 });
    await expect(page.getByRole('dialog', { name: 'Billing' }).locator('.hp-banner', { hasText: "You're subscribed. Thank you." })).toBeVisible({ timeout: 45_000 });
  });
});

test('A person in any country goes straight on to the card; a business still gives its tax number', { tag: '@portal-live.billing.consumer-everywhere' }, async ({ page, step }) => {
  const person = await provisionPerson('en', 'jo');
  await signIn(page, person);
  const form = await step('Open Billing and press Subscribe', async () => {
    const d = await openBilling(page, person.personalId);
    await d.getByRole('button', { name: 'Subscribe' }).click();
    return page.getByRole('dialog', { name: 'Subscribe to Freelancer' });
  });
  await step('Choose Jordan, for myself', async () => {
    await form.getByRole('combobox', { name: 'Billing address country' }).selectOption('JO');
    await expect(form.getByText('No tax number needed, in any country')).toBeVisible();
    await expect(form.getByText(/We can't sell to individuals/)).toHaveCount(0);
    await expect(form.getByText('$9.00')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue to payment' })).toBeEnabled();
  });
  await step('Continue as a person: Stripe’s page asks for no business tax number', async () => {
    await page.getByRole('button', { name: 'Continue to payment' }).click();
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 });
    await expect(page.getByText(/\$9\.00/).first()).toBeVisible();
    await expect(((await stripeFormFrame(page)) ?? page).getByRole('textbox', { name: /^Business tax number/ })).toHaveCount(0);
  });
});

test('Manage billing opens Stripe’s Customer Portal for the card and invoices; cancelling is MTB3A’s own', { tag: '@portal-live.billing.manage' }, async ({ page, step }) => {
  const person = await provisionPerson('en', 'manage');
  const { customerId } = await customerOnClock(person);
  await subscribeByApi(customerId);
  await signIn(page, person);
  await untilSubscriptionMirrored(page);

  const drawer = await step('Open Billing as a subscriber', async () => {
    const d = await openBilling(page, person.personalId);
    await expect(d.getByText('Active')).toBeVisible({ timeout: 45_000 });
    await expect(d.getByRole('heading', { name: /^Freelancer, renews/ })).toBeVisible();
    await expect(d.getByText("Change your card or see invoices, on Stripe's page (in English).")).toBeVisible();
    return d;
  });
  await step('Press Manage billing and land in Stripe’s Customer Portal', async () => {
    await drawer.getByRole('button', { name: 'Manage billing' }).click();
    await page.waitForURL(/billing\.stripe\.com/, { timeout: 60_000 });
    await expect(page.getByText(/payment method/i).first()).toBeVisible({ timeout: 30_000 });
  });
  await step('Stripe’s portal offers no cancel (MUT-532 D8)', async () => {
    await expect(page.getByRole('link', { name: /cancel/i }).or(page.getByRole('button', { name: /cancel (plan|subscription)/i }))).toHaveCount(0);
  });
  await step('Return to MTB3A: the plan is still Active', async () => {
    await page.getByRole('link', { name: /return to/i }).first().click();
    await page.waitForURL(/billing=true/, { timeout: 60_000 });
    const back = page.getByRole('dialog', { name: 'Billing' });
    await expect(back.getByRole('heading', { name: /^Freelancer, renews/ })).toBeVisible({ timeout: 45_000 });
    const me = await (await page.request.get('/v1/me')).json();
    expect(me.profiles.find((p: { id: string }) => p.id === person.personalId)?.billing).toMatchObject({ state: 'ACTIVE', source: 'STRIPE' });
  });
});

test('After the cancelled period ends the account is read-only and Subscribe comes back', { tag: '@portal-live.billing.manage-ended' }, async ({ page, step }) => {
  const person = await provisionPerson('en', 'ended');
  const { customerId, clockId, now } = await customerOnClock(person);
  const subscriptionId = await subscribeByApi(customerId);
  await stripeApi('POST', `subscriptions/${subscriptionId}`, { cancel_at_period_end: 'true' });
  await signIn(page, person);

  await step('See the plan ending while the period runs', async () => {
    const d = await openBilling(page, person.personalId);
    await expect(d.getByRole('heading', { name: /^Your plan ends on/ })).toBeVisible({ timeout: 45_000 });
  });
  await step('Let the period run out (the sandbox clock moves past it)', async () => {
    await advanceClock(clockId, now + 33 * DAY_S);
  });
  await step('Open Billing again: read-only, with Subscribe', async () => {
    await page.reload();
    const d = await openBilling(page, person.personalId);
    await expect(d.getByRole('heading', { name: 'Your plan has ended' })).toBeVisible({ timeout: 60_000 });
    await expect(d.getByText('Read-only')).toBeVisible();
    await expect(d.getByRole('button', { name: 'Subscribe' })).toBeVisible();
  });
});

test('Billing in Arabic on a 375 px phone', { tag: '@portal-live.billing.rtl-375' }, async ({ page, step }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const person = await provisionPerson('ar', 'rtl');
  await signIn(page, person);
  await step('Open Billing in Arabic', async () => {
    await page.goto(`/p/${person.personalId}?billing=true`);
    const d = page.getByRole('dialog', { name: 'الاشتراك' });
    await expect(d.getByRole('button', { name: 'اشترك' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
  await step('Open the Subscribe step and choose Israel, for a business', async () => {
    // MUT-361: a provisioned person with no grant is read-only, so the page's banner has its own Subscribe too.
    await page.getByRole('dialog', { name: 'الاشتراك' }).getByRole('button', { name: 'اشترك' }).click();
    const form = page.getByRole('dialog', { name: 'الاشتراك في المستقل' });
    await form.getByRole('combobox', { name: 'بلد عنوان الفوترة' }).selectOption('IL');
    await form.getByRole('radio', { name: /لعمل تجاري/ }).check();
    await expect(form.locator('bdi', { hasText: '₪' })).toBeVisible();
  });
  await step('Nothing overflows, and Continue spans the footer', async () => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const button = page.getByRole('button', { name: 'المتابعة إلى الدفع' });
    const box = await button.boundingBox();
    expect(box && box.width).toBeGreaterThan(300);
  });
});

/**
 * MUT-418: the first run after a real signup (memory outbox, fixture domains, Turnstile's test secret on this dev
 * API): "Your 14-day free trial has started", a card recommended and skippable, the trial kept when a card is added.
 */
const PORTAL_LANGUAGE_KEY = 'mutaba3a-portal-language';

test('A new signup lands on the trial step; adding a card keeps the trial and the first charge is its end', { tag: '@portal-live.billing.trial-start' }, async ({ page, step }) => {
  await page.addInitScript((key) => localStorage.setItem(key, 'en'), PORTAL_LANGUAGE_KEY);
  const signup = await requestSignup('en', 'start');
  const person = await step('Finish creating the account from the signup mail', async () => finishSignupInPage(page, signup, 'en'));
  const welcome = page.getByRole('dialog', { name: 'Your free trial' });
  await step('Land on "Your 14-day free trial has started", with its end date and Add a card now (recommended)', async () => {
    await expect(page).toHaveURL(new RegExp(`/p/${person.personalId}\\?billing=true&step=welcome$`));
    await expect(welcome.getByRole('heading', { name: 'Your 14-day free trial has started' })).toBeVisible({ timeout: 30_000 });
    await expect(welcome.getByText(/^It ends on /)).toBeVisible();
    await expect(welcome.getByText(/You won't be charged until .+\. Cancel any time before then\./)).toBeVisible();
    await expect(welcome.getByRole('button', { name: 'Not now' })).toBeVisible();
  });
  const billing = await (await page.request.get('/v1/billing')).json();
  const trialEnd = Math.floor(Date.parse(billing.trial.endsAt) / 1000);
  await step('Press Add a card now; choose Israel, for myself, monthly', async () => {
    await welcome.getByRole('button', { name: 'Add a card now (recommended)' }).click();
    const form = page.getByRole('dialog', { name: 'Subscribe to Freelancer' });
    await form.getByRole('combobox', { name: 'Billing address country' }).selectOption('IL');
    await expect(form.getByRole('radio', { name: /For yourself/ })).toBeChecked();
    await expect(form.getByText('₪29.00')).toBeVisible();
    await expect(form.getByText(/Your free trial continues: the first charge is on /)).toBeVisible();
    await expect(form.getByText(/It's in English; you'll come back here/)).toBeVisible();
  });
  await step('Continue to Stripe’s page: it shows the free days before the first ₪29.00', async () => {
    await page.getByRole('button', { name: 'Continue to payment' }).click();
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 });
    await expect(page.getByText(/days? free|free trial|trial/i).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/29\.00/).first()).toBeVisible();
  });
  await step('Fill in the test card and an Israeli address (no business tax number for a person)', async () => {
    await fillStripeCheckout(page, { name: 'Rana Saleh', country: 'IL' });
    await expect(((await stripeFormFrame(page)) ?? page).getByRole('textbox', { name: /^Business tax number/ })).toHaveCount(0);
  });
  await step('Add the card (through Stripe’s API on this Checkout’s customer and price, with the trial: TD-201)', async () => {
    await payCheckoutByApi(page, person, 'freelancer_list_monthly_ils', { trialEnd });
  });
  await step('Come back: card added, first charge on the trial’s end', async () => {
    await page.waitForURL(/checkout=success/, { timeout: 90_000 });
    const back = page.getByRole('dialog', { name: 'Billing' });
    await expect(back.locator('.hp-banner', { hasText: "You're subscribed. Thank you." })).toBeVisible({ timeout: 45_000 });
    await expect(back.getByRole('heading', { name: /^Card added\. Your first charge is on / })).toBeVisible({ timeout: 45_000 });
  });
  await step('Stripe holds a trialing subscription whose first charge is the trial end; the profile is paid by Stripe', async () => {
    const customers = await stripeApi('GET', 'customers', { email: person.email });
    const subs = await stripeApi('GET', 'subscriptions', { customer: customers.data[0].id, status: 'all' });
    const live = subs.data.find((s: { status: string }) => s.status === 'trialing');
    expect(live?.trial_end).toBe(trialEnd);
    const me = await (await page.request.get('/v1/me')).json();
    expect(me.profiles.find((p: { id: string }) => p.id === person.personalId)?.billing).toMatchObject({ state: 'ACTIVE', source: 'STRIPE' });
  });
  await step('Home again: neither the trial step nor the trial banner comes back', async () => {
    await page.goto(`/p/${person.personalId}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Owed' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Your free trial' })).toHaveCount(0);
  });
});

test('The Home trial banner in Arabic on a 375 px phone: Not now, hide, the last 3 days, then gone once a card is on file', { tag: '@portal-live.billing.trial-banner' }, async ({ page, step }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.addInitScript((key) => localStorage.setItem(key, 'ar'), PORTAL_LANGUAGE_KEY);
  const signup = await requestSignup('ar', 'banner');
  const person = await step('Finish creating the account from the signup mail, in Arabic', async () => finishSignupInPage(page, signup, 'ar'));
  const noOverflow = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const welcome = page.getByRole('dialog', { name: 'تجربتك المجانية' });
  await step('The trial step opens in Arabic, right to left, and nothing overflows', async () => {
    await expect(welcome.getByRole('heading', { name: 'بدأت تجربتك المجانية لمدة 14 يومًا' })).toBeVisible({ timeout: 30_000 });
    await expect(welcome.getByRole('button', { name: 'أضف بطاقة الآن (موصى به)' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');
    await noOverflow();
  });
  const banner = page.getByRole('region', { name: 'تجربتك المجانية' });
  await step('Press Not now: Home, with the days left in the trial and Add a card', async () => {
    // The usage question (MUT-155) has its own "ليس الآن" on the page: this is the step's.
    await welcome.getByRole('button', { name: 'ليس الآن' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/p/${person.personalId}$`));
    await expect(banner.getByText(/14/).first()).toBeVisible();
    await expect(banner.getByRole('button', { name: 'أضف بطاقة' })).toBeVisible();
    await noOverflow();
  });
  await step('Hide it for 3 days: gone, and still gone after a reload (the step doesn’t return either)', async () => {
    await banner.getByRole('button', { name: 'إخفاء لمدة 3 أيام' }).click();
    await expect(banner).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'المستحق' })).toBeVisible();
    await expect(banner).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
  await step('In the trial’s last 3 days it comes back and can’t be hidden', async () => {
    setTrialStartedDaysAgo(person.userId, 12);
    await page.reload();
    await expect(banner.getByText('بقي يومان من تجربتك المجانية')).toBeVisible();
    await expect(banner.getByRole('button', { name: 'إخفاء لمدة 3 أيام' })).toHaveCount(0);
    await noOverflow();
  });
  await step('Once a card is on file the banner is gone', async () => {
    const { customerId } = await customerOnClock(person);
    const me = await (await page.request.get('/v1/me')).json();
    const until = me.profiles.find((p: { id: string }) => p.id === person.personalId).billing.until;
    await subscribeByApi(customerId, 'freelancer_list_monthly_ils', Math.floor(Date.parse(until) / 1000));
    await expect
      .poll(async () => (await (await page.request.get('/v1/me')).json()).profiles.find((p: { id: string }) => p.id === person.personalId).billing.source, { timeout: 60_000, intervals: [2_000] })
      .toBe('STRIPE');
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'المستحق' })).toBeVisible();
    await expect(banner).toHaveCount(0);
  });
});

test('After the trial the API refuses writes and the portal is read-only; from day 30 only Subscribe and the records export answer', { tag: '@portal-live.billing.lapse-gate' }, async ({ page, step }) => {
  await page.addInitScript((key) => localStorage.setItem(key, 'en'), PORTAL_LANGUAGE_KEY);
  const signup = await requestSignup('en', 'lapse');
  const person = await step('Sign up and skip the card', async () => {
    const signedUp = await finishSignupInPage(page, signup, 'en');
    const welcome = page.getByRole('dialog', { name: 'Your free trial' });
    await welcome.getByRole('button', { name: 'Not now' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    return signedUp;
  });
  const origin = new URL(page.url()).origin;
  const asPerson = { 'x-mutaba3a-profile': person.personalId, origin };
  const banner = page.getByRole('region', { name: 'Your plan' });

  await step('Twenty days later, open Expenses and try to record one anyway', async () => {
    setTrialStartedDaysAgo(person.userId, 20);
    await page.goto(`/p/${person.personalId}/expenses`);
    await expect(banner.getByText('This profile is read-only')).toBeVisible();
    await expect(banner.getByText(/the profile locks until you subscribe/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Record expense' })).toHaveCount(0);
    const refused = await page.request.post('/v1/expenses', {
      headers: { ...asPerson, 'idempotency-key': crypto.randomUUID() },
      data: { amount: '12.00', currency: 'ILS', occurredOn: '2026-10-05', title: 'Paper' },
    });
    expect(refused.status()).toBe(402);
    expect((await refused.json()).error).toMatchObject({ code: 'SUBSCRIPTION_LAPSED', details: { profileId: person.personalId, state: 'READ_ONLY', source: 'TRIAL' } });
  });

  await step('Thirty-one days later, open the portal and download my records', async () => {
    setTrialStartedDaysAgo(person.userId, 31);
    await page.goto(`/p/${person.personalId}`);
    await expect(page.getByRole('heading', { name: 'Subscribe or download your records' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Subscribe' })).toBeVisible();
    const read = await page.request.get('/v1/expenses', { headers: asPerson });
    expect(read.status()).toBe(402);
    expect((await read.json()).error.details.state).toBe('LOCKED');
    await page.getByRole('button', { name: 'Download my records' }).click();
    const yourData = page.getByRole('dialog', { name: 'Your data' });
    const exported = page.waitForResponse((res) => new URL(res.url()).pathname === '/v1/records-export');
    await yourData.getByRole('button', { name: 'Download my records' }).click();
    expect((await exported).status()).toBe(200);
  });
});

// ---- MUT-525: the launch offer (ADR-237). This run's coupon exists only inside these tests (R3, R6) ----------------

/** A new signup in English who pressed Not now on the trial step: on Home, trial running, no card. */
async function trialist(page: import('@playwright/test').Page, label: string) {
  await page.addInitScript((key) => localStorage.setItem(key, 'en'), PORTAL_LANGUAGE_KEY);
  const person = await finishSignupInPage(page, await requestSignup('en', label), 'en');
  const welcome = page.getByRole('dialog', { name: 'Your free trial' });
  await expect(welcome.getByRole('button', { name: 'Not now' })).toBeVisible({ timeout: 30_000 });
  await welcome.getByRole('button', { name: 'Not now' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  return person;
}

const subscribeForm = (page: import('@playwright/test').Page) => page.getByRole('dialog', { name: 'Subscribe to Freelancer' });
const checkoutSessionOf = (page: import('@playwright/test').Page) => /\/(cs_test_[A-Za-z0-9]+)/.exec(page.url())?.[1] ?? '';

test.describe('the launch offer (MUT-525)', () => {
  // The coupon is this run's shared sandbox state: one test at a time, and it never outlives the test.
  test.describe.configure({ mode: 'serial' });
  test.afterEach(async () => deleteOfferCoupon());

  test('Launch offer - a trialist picks Yearly, sees ₪290 → ₪145, and pays ₪145 for the first year', { tag: '@portal-live.billing.launch-offer-yearly' }, async ({ page, step }) => {
    await step('The launch coupon runs in Stripe: 50% once, on the Freelancer product, three days left', async () => createOfferCoupon());
    const person = await step('Sign up, press Not now, and move the trial to its last day (no trial to carry)', async () => {
      const p = await trialist(page, 'offer-yearly');
      setTrialStartedDaysAgo(p.userId, 13);
      await page.reload();
      return p;
    });
    const banner = page.getByRole('region', { name: 'Your free trial' });
    await step('Home’s trial line offers 50% off a yearly plan, in place of Add a card', async () => {
      await expect(banner.getByRole('button', { name: /^50% off a yearly plan until / })).toBeVisible({ timeout: 30_000 });
      await expect(banner.getByRole('button', { name: 'Add a card' })).toHaveCount(0);
    });
    const form = subscribeForm(page);
    await step('Press it: Subscribe opens on Yearly · −50% with the launch line', async () => {
      await banner.getByRole('button', { name: /^50% off a yearly plan until / }).click();
      await expect(form.getByRole('radio', { name: 'Yearly · −50%' })).toBeChecked();
      await expect(form.getByText(/^Launch offer: 50% off your first year on Yearly, until .+\.$/)).toBeVisible();
    });
    await step('Choose Israel: ₪145.00 before a struck ₪290.00, and what is paid today and from when', async () => {
      await form.getByRole('combobox', { name: 'Billing address country' }).selectOption('IL');
      await expect(form.locator('s', { hasText: '₪290.00' }).first()).toBeVisible();
      await expect(form.getByText('₪145.00').first()).toBeVisible();
      await expect(form.getByText(/^You pay ₪145\.00 today for your first year, then ₪290\.00 a year from .+\.$/)).toBeVisible();
    });
    await step('Continue to Stripe’s page: the coupon is on it, with our Arabic offer line above Pay', async () => {
      await page.getByRole('button', { name: 'Continue to payment' }).click();
      await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 });
      await expect(page.getByText(/Launch offer/).first()).toBeVisible({ timeout: 30_000 });
      // Stripe's custom text sits inside its form frame since 2026-11.
      await expect(((await stripeFormFrame(page)) ?? page).getByText(/عرض الإطلاق: .*145.* عن سنتك الأولى/)).toBeVisible();
      const session = await stripeApi('GET', `checkout/sessions/${checkoutSessionOf(page)}`);
      expect(session.discounts?.[0]?.coupon).toBeTruthy();
    });
    await step('Fill in the test card and an Israeli address, then pay (through Stripe’s API with the coupon, TD-201)', async () => {
      await fillStripeCheckout(page, { name: 'Rana Saleh', country: 'IL' });
      await payCheckoutByApi(page, person, 'freelancer_list_yearly_ils');
    });
    await step('Back in the portal: subscribed, launch offer applied; the first invoice is ₪145.00 with a ₪145.00 discount', async () => {
      await page.waitForURL(/checkout=success/, { timeout: 90_000 });
      const back = page.getByRole('dialog', { name: 'Billing' });
      await expect(back.locator('.hp-banner', { hasText: "You're subscribed. Launch offer applied." })).toBeVisible({ timeout: 45_000 });
      const customers = await stripeApi('GET', 'customers', { email: person.email });
      const [first] = await invoicesOf(customers.data[0].id);
      expect(first).toMatchObject({ subtotal: 29000, discount: 14500, total: 14500 });
    });
  });

  test('Launch offer - Monthly shows no offer price and Stripe charges the full monthly price', { tag: '@portal-live.billing.launch-offer-monthly' }, async ({ page, step }) => {
    await step('The launch coupon runs in Stripe', async () => createOfferCoupon());
    const person = await step('Sign up and press Not now', async () => trialist(page, 'offer-monthly'));
    const form = subscribeForm(page);
    await step('Open Billing and press Subscribe: it opens on Yearly while the offer applies', async () => {
      await page.goto(`/p/${person.personalId}?billing=true&step=subscribe`);
      await expect(form.getByRole('radio', { name: 'Yearly · −50%' })).toBeChecked({ timeout: 30_000 });
    });
    await step('Switch to Monthly and choose Israel: ₪29.00, no struck price, and the hint that Yearly is 50% off', async () => {
      await form.getByRole('radio', { name: 'Monthly' }).click();
      await form.getByRole('combobox', { name: 'Billing address country' }).selectOption('IL');
      await expect(form.getByText('₪29.00').first()).toBeVisible();
      await expect(form.locator('s')).toHaveCount(0);
      await expect(form.getByText(/^Yearly is 50% off the first year until .+\.$/)).toBeVisible();
    });
    await step('Continue to Stripe’s page: ₪29.00 a month, no discount, no coupon on the Checkout', async () => {
      await page.getByRole('button', { name: 'Continue to payment' }).click();
      await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 });
      await expect(page.getByText(/29\.00/).first()).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(/Launch offer/)).toHaveCount(0);
      const session = await stripeApi('GET', `checkout/sessions/${checkoutSessionOf(page)}`);
      expect(session.discounts ?? []).toEqual([]);
    });
  });

  test('Launch offer - ended early mid-Subscribe, the drawer says so before any charge; the next Checkout is at full price', { tag: '@portal-live.billing.launch-offer-ended' }, async ({ page, step }) => {
    await step('The launch coupon runs in Stripe', async () => createOfferCoupon());
    const person = await step('Sign up and press Not now', async () => trialist(page, 'offer-ended'));
    const form = subscribeForm(page);
    await step('Open Subscribe: Yearly with the offer; choose Israel', async () => {
      await page.goto(`/p/${person.personalId}?billing=true&step=subscribe`);
      await expect(form.getByRole('radio', { name: 'Yearly · −50%' })).toBeChecked({ timeout: 30_000 });
      await form.getByRole('combobox', { name: 'Billing address country' }).selectOption('IL');
      await expect(form.getByText('₪145.00').first()).toBeVisible();
    });
    await step('The operator deletes the coupon: the campaign ends early', async () => deleteOfferCoupon());
    await step('Press Continue: no Checkout, and the drawer says the offer has ended and the yearly price', async () => {
      await page.getByRole('button', { name: 'Continue to payment' }).click();
      await expect(page.getByText('The launch offer has ended. The yearly price is ₪290.00.')).toBeVisible({ timeout: 30_000 });
      expect(page.url()).not.toMatch(/checkout\.stripe\.com/);
    });
    await step('Press Continue again: Stripe’s page at ₪290.00 a year, no discount', async () => {
      await page.getByRole('button', { name: 'Continue to payment' }).click();
      await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 });
      await expect(page.getByText(/290\.00/).first()).toBeVisible({ timeout: 30_000 });
      const session = await stripeApi('GET', `checkout/sessions/${checkoutSessionOf(page)}`);
      expect(session.discounts ?? []).toEqual([]);
    });
    await step('Home: the trial line is back to Add a card, and /v1/billing has no offer', async () => {
      await page.goto(`/p/${person.personalId}`);
      const banner = page.getByRole('region', { name: 'Your free trial' });
      await expect(banner.getByRole('button', { name: 'Add a card' })).toBeVisible({ timeout: 30_000 });
      await expect(banner.getByRole('button', { name: /50% off/ })).toHaveCount(0);
      expect((await (await page.request.get('/v1/billing')).json()).offer).toBeNull();
    });
  });

  test('Launch offer - with more than 48 hours of trial left the trial carries over and the first paid invoice is ₪145', { tag: '@portal-live.billing.launch-offer-trial-carry' }, async ({ page, step }) => {
    await step('The launch coupon runs in Stripe', async () => createOfferCoupon());
    const person = await step('Sign up (14 days of trial) and press Not now', async () => trialist(page, 'offer-carry'));
    const billing = await (await page.request.get('/v1/billing')).json();
    const trialEnd = Math.floor(Date.parse(billing.trial.endsAt) / 1000);
    const form = subscribeForm(page);
    await step('Open Subscribe and choose Israel: the trial continues, ₪145.00 on its last day, then ₪290.00 a year', async () => {
      await page.goto(`/p/${person.personalId}?billing=true&step=subscribe`);
      await expect(form.getByRole('radio', { name: 'Yearly · −50%' })).toBeChecked({ timeout: 30_000 });
      await form.getByRole('combobox', { name: 'Billing address country' }).selectOption('IL');
      await expect(form.getByText(/^Your free trial continues\. On .+ you pay ₪145\.00 for your first year, then ₪290\.00 a year from .+\.$/)).toBeVisible();
    });
    await step('Continue to Stripe’s page and fill in the test card', async () => {
      await page.getByRole('button', { name: 'Continue to payment' }).click();
      await fillStripeCheckout(page, { name: 'Rana Saleh', country: 'IL' });
    });
    await step('Add the card (through Stripe’s API with the trial’s end and the coupon, TD-201)', async () => {
      await payCheckoutByApi(page, person, 'freelancer_list_yearly_ils', { trialEnd });
    });
    await step('Back: card added, first charge on the trial’s end, launch offer applied', async () => {
      await page.waitForURL(/checkout=success/, { timeout: 90_000 });
      const back = page.getByRole('dialog', { name: 'Billing' });
      await expect(back.locator('.hp-banner', { hasText: "You're subscribed. Launch offer applied." })).toBeVisible({ timeout: 45_000 });
      await expect(back.getByRole('heading', { name: /^Card added\. Your first charge is on / })).toBeVisible({ timeout: 45_000 });
    });
    // Checkout can't use a test-clock customer (Stripe's customer list leaves them out), so the trial is ended through
    // Stripe's API instead: the first paid period is billed at once, as on the trial's last day.
    await step('End the trial in Stripe: ₪0 for the trial, then ₪145.00 with a ₪145.00 discount', async () => {
      const customerId = (await stripeApi('GET', 'customers', { email: person.email })).data[0].id as string;
      const subs = await stripeApi('GET', 'subscriptions', { customer: customerId, status: 'trialing' });
      expect(subs.data[0]?.trial_end).toBe(trialEnd);
      await stripeApi('POST', `subscriptions/${subs.data[0].id}`, { trial_end: 'now' });
      await expect.poll(async () => (await invoicesOf(customerId)).length, { timeout: 60_000, intervals: [2_000] }).toBeGreaterThanOrEqual(2);
      const [trialInvoice, firstPaid] = await invoicesOf(customerId);
      expect(trialInvoice).toMatchObject({ total: 0 });
      expect(firstPaid).toMatchObject({ subtotal: 29000, discount: 14500, total: 14500 });
    });
  });
});

/** MUT-531: a monthly subscriber whose clock started a month and three hours back, so two payments have gone through by now. */
async function payingTwoMonths(person: Awaited<ReturnType<typeof provisionPerson>>) {
  const { customerId, clockId } = await customerOnClock(person, Math.floor(Date.now() / 1000) - 31 * DAY_S - 3 * 60 * 60);
  const subscriptionId = await subscribeByApi(customerId);
  // Two minutes short of now: Stripe prorates on the clock, and the server takes a preview over 30 minutes old as stale.
  await advanceClock(clockId, Math.floor(Date.now() / 1000) - 120);
  return { customerId, subscriptionId };
}

test('Switch to yearly from the 2nd payment - the line names the saving, Stripe\'s preview is what is charged, no discount', { tag: '@portal-live.billing.yearly-switch' }, async ({ page, step }) => {
  const person = await provisionPerson('en', 'switch');
  const { customerId, subscriptionId } = await step('A monthly subscriber in shekels has paid two months (the sandbox clock runs a month)', async () => {
    const paying = await payingTwoMonths(person);
    await expect.poll(async () => (await invoicesOf(paying.customerId)).filter((i) => i.total > 0).length, { timeout: 60_000 }).toBe(2);
    return paying;
  });
  await signIn(page, person);

  const drawer = await step('Open Billing: the line says what a year saves', async () => {
    const d = await openBilling(page, person.personalId);
    await expect(d.getByText('Switch to yearly and save ₪58.00 a year')).toBeVisible({ timeout: 45_000 });
    return d;
  });
  const due = await step('Press Switch to yearly and read the preview', async () => {
    await drawer.getByRole('button', { name: 'Switch to yearly' }).click();
    const sheet = page.getByRole('dialog', { name: 'Switch to yearly' });
    await expect(sheet.getByText(/₪290\.00 a year, renewing on/)).toBeVisible({ timeout: 45_000 });
    const line = await sheet.getByText(/^You pay ₪[\d,.]+ today/).textContent();
    const amount = Number(/₪([\d,.]+)/.exec(line ?? '')?.[1]?.replace(/,/g, ''));
    expect(amount).toBeGreaterThan(0);
    expect(amount).toBeLessThan(290);
    return amount;
  });
  await step('Press Pay and switch', async () => {
    await page.getByRole('button', { name: /^Pay ₪[\d,.]+ and switch$/ }).click();
    const back = page.getByRole('dialog', { name: 'Billing' });
    await expect(back.getByText(/^You're on the yearly plan\. It renews on .* at ₪290\.00\.$/)).toBeVisible({ timeout: 45_000 });
    // Stripe keeps the billing day: the year renews on its anniversary, at the list price (MUT-525 DD3's line).
    await expect(back.getByText(/^Renews at ₪290\.00 on /)).toBeVisible({ timeout: 45_000 });
  });
  await step('Stripe holds the yearly price with no discount; today\'s invoice is the previewed amount; the profile stays paid', async () => {
    const sub = await stripeApi('GET', `subscriptions/${subscriptionId}`);
    expect(sub.items.data[0].price.lookup_key).toBe('freelancer_list_yearly_ils');
    expect(sub.discounts).toEqual([]);
    const last = (await invoicesOf(customerId)).at(-1)!;
    expect(last.total).toBe(Math.round(due * 100));
    expect(last.discount).toBe(0);
    const me = await (await page.request.get('/v1/me')).json();
    expect(me.profiles.find((p: { id: string }) => p.id === person.personalId)?.billing).toMatchObject({ state: 'ACTIVE', source: 'STRIPE' });
  });
});

test('Switch to yearly - no line before the 2nd payment', { tag: '@portal-live.billing.yearly-switch-early' }, async ({ page, step }) => {
  const person = await provisionPerson('en', 'switch-early');
  const { customerId } = await customerOnClock(person);
  await subscribeByApi(customerId);
  await signIn(page, person);
  await untilSubscriptionMirrored(page);
  await step('Open Billing after the first payment: Active, Manage billing, no switch line', async () => {
    const d = await openBilling(page, person.personalId);
    await expect(d.getByRole('heading', { name: /^Freelancer, renews/ })).toBeVisible({ timeout: 45_000 });
    await expect(d.getByRole('button', { name: 'Manage billing' })).toBeVisible();
    await expect(d.getByRole('button', { name: 'Switch to yearly' })).toHaveCount(0);
    const res = await page.request.get('/v1/billing/yearly-switch');
    expect(res.status()).toBe(409);
    expect((await res.json()).error.details).toEqual({ reason: 'SWITCH_NOT_AVAILABLE', why: 'TOO_EARLY' });
  });
});

/*
 * MUT-532 (ADR-240): pause instead of cancel, the stay offer and MTB3A's own cancel flow. The server decides on its own
 * clock whether a pause runs, so the pause flows start a plan whose paid month ends two minutes from now.
 */
const HOUR_S = 60 * 60;
const cancelStep = (page: import('@playwright/test').Page) => page.getByRole('dialog', { name: 'Cancel plan' });

async function startCancel(page: import('@playwright/test').Page, drawer: import('@playwright/test').Locator, reason: string) {
  await drawer.getByRole('button', { name: 'Cancel plan' }).click();
  const flow = cancelStep(page);
  await expect(flow.getByRole('heading', { name: 'Why are you cancelling?' })).toBeVisible();
  await flow.getByRole('radio', { name: reason }).check();
  return flow;
}

async function writeExpense(page: import('@playwright/test').Page, profileId: string) {
  return page.request.post('/v1/expenses', {
    headers: { origin: liveState().portalOrigin, 'x-mutaba3a-profile': profileId, 'idempotency-key': crypto.randomUUID() },
    data: { amount: '12.00', currency: 'ILS', occurredOn: new Date().toISOString().slice(0, 10), title: 'Paper' },
  });
}

async function pauseByApi(page: import('@playwright/test').Page, months: 1 | 2 | 3) {
  const res = await page.request.post('/v1/billing/pause', { headers: { origin: liveState().portalOrigin }, data: { months, reason: 'unused' } });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as { from: string; until: string };
}

async function billingOf(page: import('@playwright/test').Page, profileId: string) {
  const me = await (await page.request.get('/v1/me')).json();
  return me.profiles.find((p: { id: string }) => p.id === profileId)?.billing;
}

test('Pause instead of cancelling - booked from the paid month’s end, read-only while it runs, back on its own', { tag: '@portal-live.billing.pause' }, async ({ page, step }) => {
  test.setTimeout(12 * 60_000);
  const person = await provisionPerson('en', 'pause');
  const { customerId, clockId, subscriptionId, periodEnd } = await step('A monthly subscriber whose paid month ends in two minutes', async () => payingUntilSoon(person));
  await signIn(page, person);
  await untilSubscriptionMirrored(page);

  const drawer = await step('Open Billing and press Cancel plan', async () => {
    const d = await openBilling(page, person.personalId);
    await expect(d.getByRole('heading', { name: /^Freelancer, renews/ })).toBeVisible({ timeout: 45_000 });
    return d;
  });
  const flow = await step('Pick "I don’t use it enough" and press Continue', async () => {
    const f = await startCancel(page, drawer, "I don't use it enough");
    await page.getByRole('button', { name: 'Continue' }).click();
    return f;
  });
  await step('Pause instead: 1, 2 or 3 months, each with its restart date; pick 2 months', async () => {
    await expect(flow.getByRole('heading', { name: 'Pause instead of cancelling?' })).toBeVisible({ timeout: 30_000 });
    await expect(flow.getByRole('radio', { name: /^1 month, restarts on / })).toBeVisible();
    await expect(flow.getByRole('radio', { name: /^3 months, restarts on / })).toBeVisible();
    await expect(flow.getByText(/^The pause starts on .+, when the month you paid for ends\.$/)).toBeVisible();
    await expect(flow.getByText('You can pause once a year.')).toBeVisible();
    await flow.getByRole('radio', { name: /^2 months, restarts on / }).check();
  });
  const resumesAt = await step('Press Pause my plan: Billing says when it pauses, Stripe holds it', async () => {
    await page.getByRole('button', { name: 'Pause my plan' }).click();
    const back = page.getByRole('dialog', { name: 'Billing' });
    await expect(back.getByRole('heading', { name: /^Your plan pauses on / })).toBeVisible({ timeout: 45_000 });
    await expect(back.getByText('Pause booked')).toBeVisible();
    await expect(back.getByRole('button', { name: "Don't pause" })).toBeVisible();
    const sub = await stripeApi('GET', `subscriptions/${subscriptionId}`);
    expect(sub.pause_collection.behavior).toBe('void');
    expect(sub.metadata.mutaba3a_pause_from).toBe(new Date(periodEnd * 1000).toISOString());
    return sub.pause_collection.resumes_at as number;
  });
  await step('The paid month ends: Stripe voids the invoice, and Billing says paused until the restart', async () => {
    // Stripe finalizes a cycle's invoice about an hour after making it; the pause voids it then (the spike).
    await advanceClock(clockId, periodEnd + 2 * HOUR_S);
    await waitUntilPast(periodEnd);
    await expect.poll(async () => (await stripeApi('GET', 'invoices', { customer: customerId, limit: '1' })).data[0]?.status, { timeout: 60_000, intervals: [2_000] }).toBe('void');
    expect(await invoicesOf(customerId)).toHaveLength(2);
    await page.goto(`/p/${person.personalId}?billing=true`);
    await expect(page.getByRole('dialog', { name: 'Billing' }).getByRole('heading', { name: /^Paused until / })).toBeVisible({ timeout: 45_000 });
  });
  await step('The profile is read-only while paused: the banner says so, adding is refused, the export still answers', async () => {
    await page.goto(`/p/${person.personalId}/expenses`);
    const banner = page.getByRole('region', { name: 'Your plan' });
    await expect(banner.getByText(/^Your plan is paused until .+\. You can see and download everything; adding and changing come back when it restarts\.$/)).toBeVisible({ timeout: 45_000 });
    await expect(banner.getByRole('button', { name: 'Resume now' })).toBeVisible();
    await expect(banner.getByRole('button', { name: 'Subscribe' })).toHaveCount(0);
    const refused = await writeExpense(page, person.personalId);
    expect(refused.status()).toBe(402);
    expect((await refused.json()).error.details).toMatchObject({ state: 'READ_ONLY', source: 'STRIPE', paused: true });
    expect((await page.request.get('/v1/records-export', { headers: { 'x-mutaba3a-profile': person.personalId } })).status()).toBe(200);
    expect(await billingOf(page, person.personalId)).toMatchObject({ state: 'READ_ONLY', paused: true });
  });
  await step('Two months on, Stripe restarts billing on its own: ₪29.00 charged, Active again', async () => {
    await advanceClock(clockId, periodEnd + 31 * DAY_S);
    await advanceClock(clockId, resumesAt + 2 * HOUR_S);
    await expect.poll(async () => (await stripeApi('GET', `subscriptions/${subscriptionId}`)).pause_collection, { timeout: 60_000, intervals: [2_000] }).toBeNull();
    await expect.poll(async () => (await invoicesOf(customerId)).at(-1)?.total, { timeout: 60_000, intervals: [2_000] }).toBe(2900);
    await expect.poll(async () => (await billingOf(page, person.personalId))?.state, { timeout: 60_000, intervals: [2_000] }).toBe('ACTIVE');
    await page.goto(`/p/${person.personalId}?billing=true`);
    await expect(page.getByRole('dialog', { name: 'Billing' }).getByRole('heading', { name: /^Freelancer, renews/ })).toBeVisible({ timeout: 45_000 });
  });
});

test('Resume now during a pause - a month charged today, writable again', { tag: '@portal-live.billing.pause-resume-now' }, async ({ page, step }) => {
  test.setTimeout(8 * 60_000);
  const person = await provisionPerson('en', 'resume');
  const { customerId, clockId, subscriptionId, periodEnd } = await payingUntilSoon(person);
  await signIn(page, person);
  await untilSubscriptionMirrored(page);
  await step('A monthly subscriber has paused for a month, and the pause is running', async () => {
    await expect.poll(async () => (await billingOf(page, person.personalId))?.source, { timeout: 45_000 }).toBe('STRIPE');
    await pauseByApi(page, 1);
    await advanceClock(clockId, periodEnd + 60);
    await waitUntilPast(periodEnd);
  });
  const drawer = await step('Open Billing: paused until the restart, with Resume now', async () => {
    const d = await openBilling(page, person.personalId);
    await expect(d.getByRole('heading', { name: /^Paused until / })).toBeVisible({ timeout: 45_000 });
    return d;
  });
  await step('Press Resume now: the confirm says what it charges today', async () => {
    await drawer.getByRole('button', { name: 'Resume now' }).click();
    await expect(drawer.getByText('You pay ₪29.00 today, and your plan renews monthly from today.')).toBeVisible();
  });
  await step('Press Resume now again: ₪29.00 charged today, Active, and adding works again', async () => {
    await drawer.getByRole('group').getByRole('button', { name: 'Resume now' }).click();
    await expect(drawer.getByRole('heading', { name: /^Freelancer, renews/ })).toBeVisible({ timeout: 45_000 });
    const sub = await stripeApi('GET', `subscriptions/${subscriptionId}`);
    expect(sub.pause_collection).toBeNull();
    const last = (await invoicesOf(customerId)).at(-1)!;
    expect(last).toMatchObject({ total: 2900, reason: 'manual' });
    await expect.poll(async () => (await billingOf(page, person.personalId))?.state, { timeout: 45_000 }).toBe('ACTIVE');
    expect((await writeExpense(page, person.personalId)).status()).toBe(201);
  });
});

test('A second Cancel within 12 months of a pause offers no pause', { tag: '@portal-live.billing.pause-once-a-year' }, async ({ page, step }) => {
  test.setTimeout(8 * 60_000);
  const person = await provisionPerson('en', 'pause-again');
  const { clockId, periodEnd } = await payingUntilSoon(person);
  await signIn(page, person);
  await untilSubscriptionMirrored(page);
  await step('A monthly subscriber paused, and resumed', async () => {
    await expect.poll(async () => (await billingOf(page, person.personalId))?.source, { timeout: 45_000 }).toBe('STRIPE');
    await pauseByApi(page, 1);
    await advanceClock(clockId, periodEnd + 60);
    await waitUntilPast(periodEnd);
    const resumed = await page.request.delete('/v1/billing/pause', { headers: { origin: liveState().portalOrigin } });
    expect(await resumed.json()).toMatchObject({ resumed: 'now', payment: 'charged' });
  });
  await step('Cancel plan again: after the reason comes the stay offer, not the pause', async () => {
    const drawer = await openBilling(page, person.personalId);
    await expect(drawer.getByRole('heading', { name: /^Freelancer, renews/ })).toBeVisible({ timeout: 45_000 });
    const flow = await startCancel(page, drawer, 'Something else');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(flow.getByRole('heading', { name: 'Stay with 50% off for 2 months' })).toBeVisible({ timeout: 30_000 });
    await expect(flow.getByRole('heading', { name: 'Pause instead of cancelling?' })).toHaveCount(0);
    expect((await (await page.request.get('/v1/billing/retention')).json()).pause).toBeNull();
  });
});

test('The stay offer - half price for 2 months, once per person ever', { tag: '@portal-live.billing.stay-offer' }, async ({ page, step }) => {
  test.setTimeout(8 * 60_000);
  const person = await provisionPerson('en', 'stay');
  const { customerId, clockId, now } = await customerOnClock(person);
  const subscriptionId = await subscribeByApi(customerId);
  await signIn(page, person);
  await untilSubscriptionMirrored(page);
  const drawer = await step('Open Billing as a monthly subscriber', async () => {
    const d = await openBilling(page, person.personalId);
    await expect(d.getByRole('heading', { name: /^Freelancer, renews/ })).toBeVisible({ timeout: 45_000 });
    return d;
  });
  const flow = await step('Cancel plan: "It costs too much", Continue, then No, keep cancelling on the pause', async () => {
    const f = await startCancel(page, drawer, 'It costs too much');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'No, keep cancelling' }).click();
    return f;
  });
  await step('The stay offer: 50% off for 2 months, ₪14.50 instead of ₪29.00', async () => {
    await expect(flow.getByRole('heading', { name: 'Stay with 50% off for 2 months' })).toBeVisible();
    await expect(flow.getByText(/^You pay ₪14\.50 a month instead of ₪29\.00, then ₪29\.00 a month again\. You can still cancel any time\.$/)).toBeVisible();
    await expect(flow.getByText(/^A one-time offer\. If you cancel, your plan ends on .+\.$/)).toBeVisible();
  });
  await step('Press Keep my plan at ₪14.50: done, and Stripe holds the stay coupon', async () => {
    await page.getByRole('button', { name: 'Keep my plan at ₪14.50' }).click();
    const back = page.getByRole('dialog', { name: 'Billing' });
    await expect(back.getByText('Done. Your next 2 months are ₪14.50 each.')).toBeVisible({ timeout: 45_000 });
    const sub = await stripeApi('GET', `subscriptions/${subscriptionId}`, { 'expand[0]': 'discounts' });
    expect(sub.discounts.map((d: { source?: { coupon?: string }; coupon?: { id: string } }) => d.source?.coupon ?? d.coupon?.id)).toEqual([liveState().stayCouponId]);
  });
  await step('The next month is invoiced at ₪14.50', async () => {
    await advanceClock(clockId, now + 31 * DAY_S + HOUR_S);
    await expect.poll(async () => (await invoicesOf(customerId)).at(-1)?.total, { timeout: 60_000, intervals: [2_000] }).toBe(1450);
  });
  await step('Cancel plan again: no stay offer this time, only Confirm cancel', async () => {
    await page.goto(`/p/${person.personalId}?billing=true`);
    const again = page.getByRole('dialog', { name: 'Billing' });
    const f = await startCancel(page, again, 'It costs too much');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'No, keep cancelling' }).click();
    await expect(f.getByRole('heading', { name: 'Cancel your plan?' })).toBeVisible();
    await expect(f.getByRole('heading', { name: /^Stay with/ })).toHaveCount(0);
    await f.getByRole('button', { name: 'Keep my plan' }).click();
  });
});

test('Cancel with a reason - the plan stays on to the period end, and Keep my plan takes it back', { tag: '@portal-live.billing.cancel-reason' }, async ({ page, step }) => {
  const person = await provisionPerson('en', 'cancel');
  const { customerId } = await customerOnClock(person);
  const subscriptionId = await subscribeByApi(customerId);
  await signIn(page, person);
  await untilSubscriptionMirrored(page);
  const drawer = await step('Open Billing as a monthly subscriber', async () => {
    const d = await openBilling(page, person.personalId);
    await expect(d.getByRole('heading', { name: /^Freelancer, renews/ })).toBeVisible({ timeout: 45_000 });
    return d;
  });
  await step('Cancel plan: "I’m moving to another tool" and a comment, Continue', async () => {
    const flow = await startCancel(page, drawer, "I'm moving to another tool");
    await flow.getByRole('textbox', { name: /Anything else/ }).fill('Going with a spreadsheet');
    await page.getByRole('button', { name: 'Continue' }).click();
  });
  await step('No, keep cancelling on the pause; No, cancel my plan on the stay offer', async () => {
    await page.getByRole('button', { name: 'No, keep cancelling' }).click();
    await page.getByRole('button', { name: 'No, cancel my plan' }).click();
  });
  await step('The plan ends at the period end; Stripe has the reason and the comment', async () => {
    const back = page.getByRole('dialog', { name: 'Billing' });
    await expect(back.getByRole('heading', { name: /^Your plan ends on/ })).toBeVisible({ timeout: 45_000 });
    await expect(back.getByText('Ending')).toBeVisible();
    const sub = await stripeApi('GET', `subscriptions/${subscriptionId}`);
    expect(sub.cancel_at_period_end).toBe(true);
    expect(sub.cancellation_details).toMatchObject({ feedback: 'switched_service', comment: 'Going with a spreadsheet' });
    expect(await billingOf(page, person.personalId)).toMatchObject({ state: 'ACTIVE', source: 'STRIPE' });
  });
  await step('Press Keep my plan: it renews again', async () => {
    const back = page.getByRole('dialog', { name: 'Billing' });
    await back.getByRole('button', { name: 'Keep my plan' }).click();
    await expect(back.getByRole('heading', { name: /^Freelancer, renews/ })).toBeVisible({ timeout: 45_000 });
    expect((await stripeApi('GET', `subscriptions/${subscriptionId}`)).cancel_at_period_end).toBe(false);
  });
});

/*
 * MUT-533 (ADR-242): our own failed-card mail, ar + en. The renewal declines on Stripe's always-declining test card;
 * the hourly job is run through its operator door; the memory mailer's outbox is the inbox.
 */
test('A declined renewal - one Arabic mail within the hour, no amount or card; Update card opens Stripe’s card form', { tag: '@portal-live.billing.card-failed-mail' }, async ({ page, step }) => {
  const person = await provisionPerson('ar', 'cardfail');
  const { subscriptionId } = await step('A monthly subscriber’s renewal declines (the sandbox clock reaches it)', async () => {
    const declined = await declinedRenewal(person, 2 * 60 * 60);
    await expect.poll(async () => (await stripeApi('GET', `subscriptions/${declined.subscriptionId}`)).status, { timeout: 60_000 }).toBe('past_due');
    return declined;
  });
  const mail = await step('The hourly job runs: one mail in Arabic', async () => {
    await expect.poll(async () => {
      await runMailJob('card-failed-mail');
      return (await outboxOf(person.email)).filter((m) => m.template === 'card-failed').length;
    }, { timeout: 60_000 }).toBe(1);
    const [m] = (await outboxOf(person.email)).filter((x) => x.template === 'card-failed');
    expect(m!.locale).toBe('ar');
    expect(m!.subject).toBe('لم تنجح عملية الدفع ببطاقتك');
    expect(m!.text).toContain('يبقى حسابك مفتوحًا بالكامل');
    // No amount, currency or card digits; the links (which carry this env's port) aside.
    expect(m!.text.replace(/https?:\/\/\S+/g, '')).not.toMatch(/₪|\$|\d{4}/);
    return m!;
  });
  await step('Running the job again sends nothing new', async () => {
    await runMailJob('card-failed-mail');
    expect((await outboxOf(person.email)).filter((m) => m.template.startsWith('card-failed'))).toHaveLength(1);
  });
  await signIn(page, person);
  const drawer = await step('Open the mail’s button: Billing says the last payment didn’t go through', async () => {
    const link = /href="([^"]*\?billing=true[^"]*)"/.exec(mail.html)?.[1];
    expect(link).toBeTruthy();
    await page.goto(link!.replace(/&amp;/g, '&'));
    const d = page.getByRole('dialog', { name: 'الاشتراك' });
    await expect(d.getByText('لم نتمكن من تحصيل دفعتك الأخيرة')).toBeVisible({ timeout: 45_000 });
    return d;
  });
  await step('Press Update card: Stripe opens its card form', async () => {
    await drawer.getByRole('button', { name: 'حدّث البطاقة' }).click();
    await page.waitForURL(/billing\.stripe\.com/, { timeout: 45_000 });
    await expect(page.locator('iframe[name^="__privateStripeFrame"]').first()).toBeVisible({ timeout: 45_000 });
  });
  await step('Enter a good card and save it: Stripe brings the person back to Billing', async () => {
    const card = page.frameLocator('iframe[name^="__privateStripeFrame"]').first();
    await card.locator('input[name="number"]').fill('4242424242424242');
    await card.locator('input[name="expiry"]').fill('12 / 34');
    await card.locator('input[name="cvc"]').fill('123');
    const postal = card.locator('input[name="postalCode"]');
    if (await postal.isVisible().catch(() => false)) await postal.fill('9100000');
    await page.getByRole('button', { name: /^(Add|Save|Update|إضافة|حفظ|تحديث)/ }).last().click();
    await page.waitForURL(/portal=card/, { timeout: 60_000 });
  });
  await step('The open invoice is paid on the new card, and Billing shows the plan Active again', async () => {
    await expect.poll(async () => (await stripeApi('GET', `subscriptions/${subscriptionId}`)).status, { timeout: 90_000 }).toBe('active');
    const back = page.getByRole('dialog', { name: 'الاشتراك' });
    await expect(back.getByText('لم نتمكن من تحصيل دفعتك الأخيرة')).toBeHidden({ timeout: 45_000 });
    await expect(back.getByRole('button', { name: 'حدّث البطاقة' })).toBeHidden();
  });
});

test('A renewal the bank wants confirmed (3-D Secure) - no MTB3A mail; Stripe’s own confirm-payment mail covers it', { tag: '@portal-live.billing.card-failed-3ds' }, async ({ step }) => {
  const person = await provisionPerson('en', 'card3ds');
  await step('A monthly subscriber’s renewal needs the person to confirm it with their bank', async () => {
    const pending = await declinedRenewal(person, 2 * 60 * 60, 'pm_card_authenticationRequired');
    await expect.poll(async () => (await stripeApi('GET', `subscriptions/${pending.subscriptionId}`)).status, { timeout: 60_000 }).toBe('past_due');
  });
  await step('The hourly job runs: it sees the plan and skips it as needing authentication, and mails nothing', async () => {
    await expect.poll(async () => {
      const { rows } = await runMailJob('card-failed-mail', true);
      return rows.find((r: { email: string }) => r.email === person.email)?.skip ?? null;
    }, { timeout: 60_000 }).toBe('needs-authentication');
    await runMailJob('card-failed-mail');
    expect((await outboxOf(person.email)).filter((m) => m.template.startsWith('card-failed'))).toHaveLength(0);
  });
});

test('A declined renewal a week on - exactly one reminder, then nothing more for that invoice', { tag: '@portal-live.billing.card-failed-reminder' }, async ({ step }) => {
  const person = await provisionPerson('en', 'cardremind');
  await step('A monthly subscriber’s renewal first declined over a week ago, and Stripe is still retrying', async () => {
    const declined = await declinedRenewal(person, 8 * 24 * 60 * 60);
    await expect.poll(async () => (await stripeApi('GET', `subscriptions/${declined.subscriptionId}`)).status, { timeout: 90_000 }).toBe('past_due');
  });
  await step('The hourly job runs twice: one reminder, no first mail (only the current stage)', async () => {
    await expect.poll(async () => {
      await runMailJob('card-failed-mail');
      return (await outboxOf(person.email)).filter((m) => m.template.startsWith('card-failed')).length;
    }, { timeout: 60_000 }).toBe(1);
    await runMailJob('card-failed-mail');
    const mails = (await outboxOf(person.email)).filter((m) => m.template.startsWith('card-failed'));
    expect(mails.map((m) => m.template)).toEqual(['card-failed-reminder']);
    expect(mails[0]!.subject).toBe('Your card still isn’t going through');
    expect(mails[0]!.text).toMatch(/your plan ends within \d+ days? at most/);
  });
  await step('A third run sends nothing more for the invoice', async () => {
    await runMailJob('card-failed-mail');
    expect((await outboxOf(person.email)).filter((m) => m.template.startsWith('card-failed'))).toHaveLength(1);
  });
});

/*
 * MUT-534 (ADR-243): the come-back offer. A paid monthly plan ended 31 days ago on a sandbox clock started in the past;
 * the daily job is run through its operator door; this run's come-back coupon is ₪20 / $6 off the first invoice.
 */
async function comebackMailed(person: Awaited<ReturnType<typeof provisionPerson>>) {
  await expect.poll(async () => {
    await runMailJob('comeback-mail');
    return (await outboxOf(person.email)).filter((m) => m.template === 'comeback-offer').length;
  }, { timeout: 90_000 }).toBe(1);
  return (await outboxOf(person.email)).find((m) => m.template === 'comeback-offer')!;
}

async function comebackCheckout(page: import('@playwright/test').Page, mail: { html: string }, country: string, yearly: boolean) {
  const link = /href="([^"]*step=subscribe[^"]*)"/.exec(mail.html)?.[1];
  expect(link).toBeTruthy();
  await page.goto(link!.replace(/&amp;/g, '&'));
  const sheet = page.getByRole('dialog', { name: 'Subscribe to Freelancer' });
  await sheet.getByRole('combobox', { name: 'Billing address country' }).selectOption(country);
  if (yearly) await sheet.getByRole('radio', { name: /^Yearly/ }).click();
  return sheet;
}

test('The come-back offer - mailed 30 days after a paid plan ended; the first month back is ₪9, then ₪29', { tag: '@portal-live.billing.comeback-offer' }, async ({ page, step }) => {
  const person = await provisionPerson('en', 'back');
  const { customerId } = await step('A monthly subscriber paid once; the plan ended 31 days ago', async () => {
    const lapse = await paidLapse(person, 31);
    await expect.poll(async () => (await stripeApi('GET', `subscriptions/${lapse.subscriptionId}`)).status, { timeout: 60_000 }).toBe('canceled');
    return lapse;
  });
  const mail = await step('The daily job runs: one mail, the records are still here, ₪9 the first month back', async () => {
    const m = await comebackMailed(person);
    expect(m.subject).toBe('Your MTB3A records are still here');
    expect(m.text).toContain('Come back for ₪9 for your first month, then ₪29 a month. Prefer a year? Your first year is ₪270, then ₪290.');
    return m;
  });
  await signIn(page, person);
  const sheet = await step('Open the mail’s button: Subscribe says welcome back, ₪9.00 then ₪29.00 a month', async () => {
    const s = await comebackCheckout(page, mail, 'IL', false);
    await expect(s.getByText(/^Welcome back: your first month is ₪9\.00, then ₪29\.00 a month\.$/)).toBeVisible({ timeout: 45_000 });
    return s;
  });
  await step('Continue to payment: Stripe’s page says the welcome-back price; the first invoice takes ₪20 off ₪29', async () => {
    await sheet.getByRole('button', { name: 'Continue to payment' }).click();
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 45_000 });
    const { submitMessage } = await payCheckoutByApi(page, person, 'freelancer_list_monthly_ils', { offerId: 'comeback-2026' });
    expect(submitMessage).toContain('Welcome-back offer: \u2068₪9\u2069 for your first month, then \u2068₪29\u2069 a month.');
    await expect.poll(async () => (await invoicesOf(customerId)).at(-1), { timeout: 60_000 }).toMatchObject({ subtotal: 2900, discount: 2000 });
  });
  await step('Once back, the offer is gone and the job mails nothing more', async () => {
    await expect.poll(async () => (await (await page.request.get('/v1/billing')).json()).comeback, { timeout: 60_000 }).toBeNull();
    await runMailJob('comeback-mail');
    expect((await outboxOf(person.email)).filter((m) => m.template === 'comeback-offer')).toHaveLength(1);
  });
});

test('The come-back offer on Yearly - the same ₪20 off the first year, ₪270 then ₪290', { tag: '@portal-live.billing.comeback-yearly' }, async ({ page, step }) => {
  const person = await provisionPerson('en', 'backyear');
  const { customerId } = await step('A monthly subscriber paid once; the plan ended 31 days ago, and the job mailed them', async () => {
    const lapse = await paidLapse(person, 31);
    await expect.poll(async () => (await stripeApi('GET', `subscriptions/${lapse.subscriptionId}`)).status, { timeout: 60_000 }).toBe('canceled');
    return lapse;
  });
  const mail = await comebackMailed(person);
  await signIn(page, person);
  await step('Pick Yearly: welcome back, ₪270.00 the first year, then ₪290.00', async () => {
    const sheet = await comebackCheckout(page, mail, 'IL', true);
    await expect(sheet.getByText(/^Welcome back: your first year is ₪270\.00, then ₪290\.00 a year\.$/)).toBeVisible({ timeout: 45_000 });
    await sheet.getByRole('button', { name: 'Continue to payment' }).click();
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 45_000 });
  });
  await step('Stripe charges the first year less ₪20', async () => {
    await payCheckoutByApi(page, person, 'freelancer_list_yearly_ils', { offerId: 'comeback-2026' });
    await expect.poll(async () => (await invoicesOf(customerId)).at(-1), { timeout: 60_000 }).toMatchObject({ subtotal: 29000, discount: 2000 });
  });
});

test('The come-back offer in dollars - a shekel payer coming back from abroad sees and pays $3.00, then $9.00', { tag: '@portal-live.billing.comeback-usd' }, async ({ page, step }) => {
  const person = await provisionPerson('en', 'backusd');
  await step('A shekel subscriber paid once; the plan ended 31 days ago, and the job mailed them', async () => {
    const lapse = await paidLapse(person, 31);
    await expect.poll(async () => (await stripeApi('GET', `subscriptions/${lapse.subscriptionId}`)).status, { timeout: 60_000 }).toBe('canceled');
  });
  const mail = await comebackMailed(person);
  await signIn(page, person);
  await step('Pick a country outside Israel: the welcome-back price is in dollars', async () => {
    const sheet = await comebackCheckout(page, mail, 'GB', false);
    await expect(sheet.getByText(/^Welcome back: your first month is \$3\.00, then \$9\.00 a month\.$/)).toBeVisible({ timeout: 45_000 });
    await sheet.getByRole('button', { name: 'Continue to payment' }).click();
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 45_000 });
  });
  await step('Stripe’s page carries the come-back coupon in dollars', async () => {
    const { submitMessage } = await payCheckoutByApi(page, person, 'freelancer_list_monthly_usd', { offerId: 'comeback-2026' });
    expect(submitMessage).toContain('Welcome-back offer: \u2068$3\u2069 for your first month, then \u2068$9\u2069 a month.');
  });
});

test('The come-back offer at day 90 - the second mail, its own subject, still ₪9 the first month back', { tag: '@portal-live.billing.comeback-day-90' }, async ({ step }) => {
  const person = await provisionPerson('ar', 'back90');
  await step('A monthly subscriber paid once; the plan ended 91 days ago', async () => {
    const lapse = await paidLapse(person, 91);
    await expect.poll(async () => (await stripeApi('GET', `subscriptions/${lapse.subscriptionId}`)).status, { timeout: 60_000 }).toBe('canceled');
  });
  await step('The daily job runs: the day-90 mail, in Arabic, names the price in its subject', async () => {
    const mail = await comebackMailed(person);
    expect(mail.locale).toBe('ar');
    expect(mail.subject).toBe('عُد إلى متابعة بـ \u2068₪9\u2069 لشهرك الأول');
    expect(mail.text).toContain('سجلاتك ما زالت هنا');
  });
});

