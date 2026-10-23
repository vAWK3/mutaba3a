import { test, expect } from '../../support/qa';
import { advanceClock, customerOnClock, payOnStripeCheckout, provisionPerson, signIn, stripeApi, subscribeByApi } from '../../support/livePortal';

/**
 * MUT-362 (eng review D8 B): Settings › Billing on a real dev API and Stripe's real sandbox pages, started by
 * support/billing-live.mjs. Each test makes its own person; money moves only in the sandbox, on test cards.
 */

const DAY_S = 24 * 60 * 60;

async function openBilling(page: import('@playwright/test').Page, personalId: string) {
  await page.goto(`/p/${personalId}`);
  await page.getByRole('button', { name: /^Account|^الحساب/ }).click();
  await page.getByRole('menuitem', { name: /^Billing$|^الاشتراك$/ }).click();
  return page.getByRole('dialog', { name: /^Billing$|^الاشتراك$/ });
}

test('Subscribe in shekels from Israel as a business, pay with a test card, and come back subscribed', { tag: '@portal-live.billing.subscribe' }, async ({ page, step }) => {
  const person = await provisionPerson('en', 'ils');
  await signIn(page, person);

  const drawer = await step('Open Billing from the account menu', async () => openBilling(page, person.personalId));
  await step('Read where I stand, the prices and the rules before anything else', async () => {
    await expect(drawer.getByRole('button', { name: 'Subscribe' })).toBeVisible();
    await expect(drawer.getByText('₪39.00')).toBeVisible();
    await expect(drawer.getByText('$10.00')).toBeVisible();
    await expect(drawer.getByText('Prices exclude VAT; VAT is added where the law requires it.')).toBeVisible();
  });
  await step('Press Subscribe and choose Israel, for a business, monthly', async () => {
    await drawer.getByRole('button', { name: 'Subscribe' }).click();
    const form = page.getByRole('dialog', { name: 'Subscribe to Freelancer' });
    await form.getByRole('combobox', { name: 'Billing address country' }).selectOption('IL');
    await form.getByRole('radio', { name: /For a business/ }).check();
    await expect(form.getByText('₪39.00')).toBeVisible();
    await expect(form.getByText(/It's in English; you'll come back here/)).toBeVisible();
  });
  await step('Continue to Stripe’s payment page', async () => {
    await page.getByRole('button', { name: 'Continue to payment' }).click();
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 });
    await expect(page.getByText(/39\.00/).first()).toBeVisible();
  });
  await step('Pay with the test card, an Israeli address and the business tax number', async () => {
    await payOnStripeCheckout(page, { name: 'Rana Saleh', country: 'IL', taxNumber: '516000000' });
  });
  await step('Come back to the portal: confirming, then subscribed', async () => {
    await page.waitForURL(/checkout=success/, { timeout: 90_000 });
    const back = page.getByRole('dialog', { name: 'Billing' });
    await expect(back.getByText("You're subscribed. Thank you.")).toBeVisible({ timeout: 45_000 });
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
    await expect(drawer.getByText('$100.00')).toBeVisible();
  });
  await step('Pay on Stripe’s page with the test card and a UAE TRN', async () => {
    await page.getByRole('button', { name: 'Continue to payment' }).click();
    await payOnStripeCheckout(page, { name: 'Rana Saleh', country: 'AE', taxId: { type: 'ae_trn', value: '123456789012345' } });
  });
  await step('Come back subscribed', async () => {
    await page.waitForURL(/checkout=success/, { timeout: 90_000 });
    await expect(page.getByRole('dialog', { name: 'Billing' }).getByText("You're subscribed. Thank you.")).toBeVisible({ timeout: 45_000 });
  });
});

test('A person outside the countries open to consumers never reaches the card form; a business can go on', { tag: '@portal-live.billing.business-only' }, async ({ page, step }) => {
  const person = await provisionPerson('en', 'jo');
  await signIn(page, person);
  const form = await step('Open Billing and press Subscribe', async () => {
    const d = await openBilling(page, person.personalId);
    await d.getByRole('button', { name: 'Subscribe' }).click();
    return page.getByRole('dialog', { name: 'Subscribe to Freelancer' });
  });
  await step('Choose Jordan, for myself', async () => {
    await form.getByRole('combobox', { name: 'Billing address country' }).selectOption('JO');
    await expect(form.getByText(/We can't sell to individuals in Jordan yet/)).toBeVisible();
    await expect(form.getByRole('link', { name: 'Contact us' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue to payment' })).toBeDisabled();
  });
  await step('Switch to buying for a business', async () => {
    await form.getByRole('radio', { name: /For a business/ }).check();
    await expect(form.getByText('$10.00')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue to payment' })).toBeEnabled();
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
    await expect(page.getByRole('dialog', { name: 'Billing' }).getByRole('heading', { name: /^Your plan ends on/ })).toBeVisible({ timeout: 45_000 });
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
    await page.getByRole('button', { name: 'اشترك' }).click();
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
