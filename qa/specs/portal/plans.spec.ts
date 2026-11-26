import { test, expect } from '../../support/qa';
import { expectNoHorizontalOverflow } from '../../support/brand';
import { OFFICE_A, OFFICE_B, office, type StubProfile } from '../../support/portal';
import { FakeApi } from '../../support/portalApi';
import { openYou, youRow } from '../../support/you';

/**
 * MUT-702 Part B (ADR-288, wireframes v3): Subscribe with Solo, Business and Firm on sale, on the FakeApi's Starter seed
 * with `plans` (PLAN_CHECKOUT on). Stripe's page is stubbed; the body the portal sent is asserted.
 */

const personal: StubProfile = { ...office(OFFICE_B, 'Personal'), type: 'PERSONAL', personalDefault: true };
const CHECKOUT = '/v1/billing/checkout-session';

async function seePlans(page: import('@playwright/test').Page, language: 'en' | 'ar' = 'en') {
  await openYou(page, 'account');
  await youRow(page, language === 'ar' ? 'الاشتراك' : 'Billing').click();
  await page.getByRole('button', { name: language === 'ar' ? 'اطّلع على الخطط' : 'See plans' }).click();
  return page.getByRole('dialog', { name: language === 'ar' ? 'اشترك' : 'Subscribe' });
}

async function fillAddress(step: import('@playwright/test').Locator, country: string, line1: string, city: string, postal: string) {
  await step.getByRole('combobox', { name: 'Country' }).fill(country);
  await step.getByRole('textbox', { name: 'Address' }).fill(line1);
  await step.getByRole('textbox', { name: 'City' }).fill(city);
  await step.getByRole('textbox', { name: 'Postal code' }).fill(postal);
}

test('On Starter, See plans lists Solo, Business and Firm; an Israeli address prices them in shekels + VAT and Continue opens Stripe with the plan and the address', { tag: '@portal.plans.subscribe-plan' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio'), personal], starter: { plans: {} } });
  let plans!: import('@playwright/test').Locator;

  await step('As a Starter person, open Billing and choose See plans', async () => {
    await api.open(page, `/p/${OFFICE_A}`);
    plans = await seePlans(page);
    await expect(plans.getByRole('radio', { name: /^Solo · ₪39\.00 or \$12\.00 a month/ })).toBeChecked();
    await expect(plans.getByRole('radio', { name: /^Business · ₪89\.00 or \$27\.00 a month/ })).toBeVisible();
    await expect(plans.getByRole('radio', { name: /^Firm · ₪249\.00 or \$75\.00 a month/ })).toBeVisible();
    await expect(plans.getByText('1 business · 50 documents · 100 scans a month')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue to payment' })).toBeDisabled();
  });

  await step('Choose Business, type Israel as the country, and fill in the street, city and postal code', async () => {
    await plans.getByRole('radio', { name: /^Business/ }).check();
    await fillAddress(plans, 'Israel', 'Az-Zahra St. 18', 'Jerusalem', '9100000');
    await expect(plans.getByRole('radio', { name: /^Business · ₪89\.00 \+ VAT a month/ })).toBeChecked();
    await expect(page.getByRole('button', { name: 'Continue to payment' })).toBeEnabled();
    await expectNoHorizontalOverflow(page, 'Subscribe with plans');
  });

  await step('Choose Continue to payment', async () => {
    await page.route('https://checkout.stripe.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Stripe Checkout (QA)</title>' }));
    await page.getByRole('button', { name: 'Continue to payment' }).click();
    await expect(page).toHaveURL(/checkout\.stripe\.com/);
    expect(api.calls('POST', CHECKOUT)[0]!.body).toMatchObject({ plan: 'business', interval: 'month', country: 'IL', buyer: 'person', address: { country: 'IL', line1: 'Az-Zahra St. 18', city: 'Jerusalem', postalCode: '9100000' } });
  });
});

test('The billing country is typed and must match a country; a misspelling says No match, Arabic names match', { tag: '@portal.plans.typed-country' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio'), personal], starter: { plans: {} } });

  await step('As a Starter person on See plans, type "Isreal" as the country and fill in the rest', async () => {
    await api.open(page, `/p/${OFFICE_A}`);
    const plans = await seePlans(page);
    await fillAddress(plans, 'Isreal', 'Rainbow St. 12', 'Amman', '11181');
    await expect(plans.getByText('No match')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue to payment' })).toBeDisabled();
  });

  await step('Correct it to Jordan', async () => {
    const plans = page.getByRole('dialog', { name: 'Subscribe' });
    await plans.getByRole('combobox', { name: 'Country' }).fill('Jordan');
    await expect(plans.getByRole('radio', { name: /^Solo · \$12\.00 a month/ })).toBeVisible();
    await expect(plans.getByText(/\+ VAT/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Continue to payment' })).toBeEnabled();
  });

  await step('In Arabic, type «الأردن»', async () => {
    await api.open(page, `/p/${OFFICE_A}`, 'ar');
    const plans = await seePlans(page, 'ar');
    await plans.getByRole('combobox', { name: 'البلد' }).fill('الأردن');
    await expect(plans.getByRole('radio', { name: /^مستقل/ })).toContainText('$');
    await expect(plans.getByText('لا يوجد تطابق')).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });
});

test("A returning payer's billing address is filled in from the last one", { tag: '@portal.plans.address-prefilled' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio'), personal], starter: { plans: { billingAddress: { country: 'JO', line1: 'Rainbow St. 12', city: 'Amman', postalCode: '11181' } } } });

  await step('As a Starter person who paid before from Amman, open See plans', async () => {
    await api.open(page, `/p/${OFFICE_A}`);
    const plans = await seePlans(page);
    await expect(plans.getByRole('combobox', { name: 'Country' })).toHaveValue('Jordan');
    await expect(plans.getByRole('textbox', { name: 'Address' })).toHaveValue('Rainbow St. 12');
    await expect(plans.getByRole('textbox', { name: 'City' })).toHaveValue('Amman');
    await expect(plans.getByRole('textbox', { name: 'Postal code' })).toHaveValue('11181');
    await expect(page.getByRole('button', { name: 'Continue to payment' })).toBeEnabled();
  });
});
