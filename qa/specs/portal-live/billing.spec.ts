import { test, expect } from '../../support/qa';
import { advanceClock, customerOnClock, fillStripeCheckout, finishSignupInPage, payCheckoutByApi, provisionPerson, requestSignup, setTrialStartedDaysAgo, signIn, stripeApi, subscribeByApi } from '../../support/livePortal';
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
    await expect(drawer.getByText('₪49.00')).toBeVisible();
    await expect(drawer.getByText('$16.00')).toBeVisible();
    await expect(drawer.getByText('Prices exclude VAT; VAT is added where the law requires it.')).toBeVisible();
  });
  await step('Press Subscribe and choose Israel, for a business, monthly', async () => {
    await drawer.getByRole('button', { name: 'Subscribe' }).click();
    const form = page.getByRole('dialog', { name: 'Subscribe to Freelancer' });
    await form.getByRole('combobox', { name: 'Billing address country' }).selectOption('IL');
    await form.getByRole('radio', { name: /For a business/ }).check();
    await expect(form.getByText('₪49.00')).toBeVisible();
    await expect(form.getByText(/It's in English; you'll come back here/)).toBeVisible();
  });
  await step('Continue to Stripe’s payment page', async () => {
    await page.getByRole('button', { name: 'Continue to payment' }).click();
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 });
    await expect(page.getByText(/49\.00/).first()).toBeVisible();
  });
  await step('Fill in the test card, an Israeli address and the business tax number', async () => {
    await fillStripeCheckout(page, { name: 'Rana Saleh', country: 'IL', taxNumber: '516000000' });
    await expect(page.getByRole('textbox', { name: 'Business tax number · الرقم الضريبي' })).toHaveValue('516000000');
    await expect(page.getByText(/Prices exclude VAT; VAT is added where the law requires it\./)).toBeVisible();
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
    await expect(drawer.getByText('$160.00')).toBeVisible();
  });
  await step('Fill in Stripe’s page with the test card and a UAE TRN', async () => {
    await page.getByRole('button', { name: 'Continue to payment' }).click();
    await fillStripeCheckout(page, { name: 'Rana Saleh', country: 'AE', taxId: { type: 'ae_trn', value: '123456789012345' } });
    await expect(page.getByText(/160\.00/).first()).toBeVisible();
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
    await expect(form.getByText('$16.00')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue to payment' })).toBeEnabled();
  });
  await step('Continue as a person: Stripe’s page asks for no business tax number', async () => {
    await page.getByRole('button', { name: 'Continue to payment' }).click();
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 });
    await expect(page.getByText(/16\.00/).first()).toBeVisible();
    await expect(page.getByRole('textbox', { name: /^Business tax number/ })).toHaveCount(0);
  });
});

test('Manage billing opens Stripe’s Customer Portal; cancelling keeps the plan until the period ends', { tag: '@portal-live.billing.manage' }, async ({ page, step }) => {
  const person = await provisionPerson('en', 'manage');
  const { customerId } = await customerOnClock(person);
  await subscribeByApi(customerId);
  await signIn(page, person);

  const drawer = await step('Open Billing as a subscriber', async () => {
    const d = await openBilling(page, person.personalId);
    await expect(d.getByText('Active')).toBeVisible({ timeout: 45_000 });
    await expect(d.getByRole('heading', { name: /^Freelancer, renews/ })).toBeVisible();
    return d;
  });
  await step('Press Manage billing and land in Stripe’s Customer Portal', async () => {
    await drawer.getByRole('button', { name: 'Manage billing' }).click();
    await page.waitForURL(/billing\.stripe\.com/, { timeout: 60_000 });
  });
  await step('Cancel the plan in the portal', async () => {
    await page.getByRole('link', { name: /cancel/i }).or(page.getByRole('button', { name: /cancel (plan|subscription)/i })).first().click();
    // The portal asks why first when its configuration collects cancellation reasons; the reason is optional.
    const why = page.getByRole('alertdialog', { name: /cancel your subscription/i });
    if (await why.waitFor({ timeout: 15_000 }).then(() => true, () => false)) {
      await why.getByRole('button', { name: 'Continue to cancellation' }).click();
      await expect(why).toBeHidden({ timeout: 30_000 });
    }
    // Then Review your changes, unless the reason step already confirmed it.
    const confirm = page.getByRole('button', { name: /^cancel (plan|subscription)$/i });
    if (await confirm.waitFor({ timeout: 5_000 }).then(() => true, () => false)) await confirm.click();
  });
  await step('Return to Mutaba3a: the plan ends at the period end', async () => {
    await page.getByRole('link', { name: /return to/i }).first().click();
    await page.waitForURL(/billing=true/, { timeout: 60_000 });
    const back = page.getByRole('dialog', { name: 'Billing' });
    await expect(back.getByRole('heading', { name: /^Your plan ends on/ })).toBeVisible({ timeout: 45_000 });
    await expect(back.getByText('Ending')).toBeVisible();
  });
  await step('Access stays until then: the profile is still Active, paid by Stripe', async () => {
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
    await expect(form.getByText('₪49.00')).toBeVisible();
    await expect(form.getByText(/Your free trial continues: the first charge is on /)).toBeVisible();
    await expect(form.getByText(/It's in English; you'll come back here/)).toBeVisible();
  });
  await step('Continue to Stripe’s page: it shows the free days before the first ₪49.00', async () => {
    await page.getByRole('button', { name: 'Continue to payment' }).click();
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 });
    await expect(page.getByText(/days? free|free trial|trial/i).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/49\.00/).first()).toBeVisible();
  });
  await step('Fill in the test card and an Israeli address (no business tax number for a person)', async () => {
    await fillStripeCheckout(page, { name: 'Rana Saleh', country: 'IL' });
    await expect(page.getByRole('textbox', { name: /^Business tax number/ })).toHaveCount(0);
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
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
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
    await expect(page.getByRole('heading', { level: 1, name: 'نظرة عامة' })).toBeVisible();
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
    await expect(page.getByRole('heading', { level: 1, name: 'نظرة عامة' })).toBeVisible();
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
