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
const CHECKOUT = /^\/v1\/billing\/checkout-session$/;

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
    await expect(plans.getByRole('radio', { name: /^مستقل.*\$/ })).toBeVisible();
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

/* MUT-705: the plan picker's opening plan, a paid plan's Billing, its read-only businesses and its cap prompts. */

const THIRD = '55555555-5555-4555-8555-555555555553';
const FOURTH = '55555555-5555-4555-8555-555555555554';
const FIFTH = '55555555-5555-4555-8555-555555555555';

async function openBilling(page: import('@playwright/test').Page, language: 'en' | 'ar' = 'en') {
  await openYou(page, 'account');
  await youRow(page, language === 'ar' ? 'الاشتراك' : 'Billing').click();
  return page.getByRole('dialog', { name: language === 'ar' ? 'الاشتراك' : 'Billing' });
}

test('See plans opens on the smallest plan that covers the businesses owned; Firm says staff is coming', { tag: '@portal.plans.plan-recommended' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio'), office(THIRD, 'Nour Print'), personal], starter: { plans: {}, businesses: { active: [OFFICE_A], readOnly: [THIRD] } } });

  await step('As a Starter person who owns two businesses, open Billing and choose See plans', async () => {
    await api.open(page, `/p/${OFFICE_A}`);
    const plans = await seePlans(page);
    await expect(plans.getByRole('radio', { name: /^Business/ })).toBeChecked();
    await expect(plans.getByText('6 businesses · 1000 documents · 2000 scans a month · Staff: coming soon')).toBeVisible();
  });
});

test("On Business, Billing names the plan and shows this month's documents and scans; at 90% the meter turns butter with Upgrade to Firm", { tag: '@portal.plans.paid-billing' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio'), personal], paid: { plan: 'business', documents: 230, scans: 41 } });

  await step('As a Business subscriber with 230 of 250 documents this month, open Billing', async () => {
    await api.open(page, `/p/${OFFICE_A}`);
    const billing = await openBilling(page);
    await expect(billing.getByRole('heading', { name: /^Business, renews/ })).toBeVisible();
    const documents = billing.getByTestId('meter-documents');
    await expect(documents).toContainText('Documents this month');
    await expect(documents).toContainText('230 of 250');
    await expect(documents).toHaveAttribute('data-tone', 'butter');
    await expect(documents.getByRole('button', { name: 'Upgrade to Firm' })).toBeVisible();
    const scans = billing.getByTestId('meter-scans');
    await expect(scans).toContainText('41 of 500');
    await expect(scans.getByRole('button', { name: /^Upgrade/ })).toHaveCount(0);
  });

  await step('In Arabic, open Billing', async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await api.open(page, `/p/${OFFICE_A}`, 'ar');
    const billing = await openBilling(page, 'ar');
    await expect(billing.getByRole('heading', { name: /^تجاري، يتجدد في/ })).toBeVisible();
    await expect(billing.getByTestId('meter-documents')).toContainText('230 من 250');
    await expect(billing.getByRole('button', { name: 'الترقية إلى مؤسسة' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectNoHorizontalOverflow(page, 'Billing on Business, Arabic');
  });
});

test('On Business with four businesses, Billing lists the read-only one and why; Choose which businesses stay active counts to 3 and saves', { tag: '@portal.plans.paid-read-only' }, async ({ page, step }) => {
  const api = new FakeApi({
    profiles: [office(OFFICE_A, 'Nour Studio'), office(THIRD, 'Nour Print'), office(FOURTH, 'Nour Books'), office(FIFTH, 'Nour Cafe'), personal],
    paid: { plan: 'business', businesses: { active: [OFFICE_A, THIRD, FOURTH], readOnly: [FIFTH] } },
  });
  let billing!: import('@playwright/test').Locator;

  await step('As a Business subscriber with four businesses, one read-only, open Billing', async () => {
    await api.open(page, `/p/${OFFICE_A}`);
    billing = await openBilling(page);
    const section = billing.getByTestId('read-only-businesses');
    await expect(section).toContainText('Business includes 3 businesses');
    await expect(section).toContainText('Nour Cafe');
  });

  await step('Choose "Choose which businesses stay active", untick one active business and tick the read-only one', async () => {
    await billing.getByRole('button', { name: 'Choose which businesses stay active' }).click();
    const list = billing.getByTestId('business-checklist');
    await expect(list).toContainText('3 of 3');
    await expect(list.getByRole('checkbox', { name: /Nour Cafe/ })).toBeDisabled();
    await list.getByRole('checkbox', { name: /Nour Books/ }).uncheck();
    await expect(list).toContainText('2 of 3');
    await list.getByRole('checkbox', { name: /Nour Cafe/ }).check();
    await expect(list).toContainText('3 of 3');
    await expect(list.getByRole('checkbox', { name: /Nour Books/ })).toBeDisabled();
  });

  await step('Choose Save', async () => {
    await billing.getByRole('button', { name: 'Save' }).click();
    await expect(billing.getByTestId('read-only-businesses')).toContainText('Nour Books');
    expect(api.calls('PUT', /^\/v1\/billing\/active-businesses$/)[0]!.body).toEqual({ organizationIds: [OFFICE_A, THIRD, FIFTH] });
  });
});

test('On Solo, a second business names Business and its price with Upgrade to Business; Home\'s line from 90% offers it too', { tag: '@portal.plans.paid-cap-prompts' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio'), personal], paid: { plan: 'solo', documents: 46 } });

  await step('As a Solo subscriber with 46 of 50 documents, open Home', async () => {
    await api.open(page, `/p/${OFFICE_A}`);
    const line = page.getByTestId('usage-nudge');
    await expect(line).toContainText('46 of 50 documents this month');
    await expect(line.getByRole('button', { name: 'Upgrade to Business' })).toBeVisible();
  });

  await step('Open New profile', async () => {
    await api.open(page, `/p/${OFFICE_A}?newProfile=true`);
    const notice = page.getByRole('dialog', { name: 'New profile' }).getByTestId('plan-limit-notice');
    await expect(notice).toContainText('Solo includes 1 business');
    await expect(notice.getByTestId('next-plan-line')).toHaveText('Business · ₪89.00 + VAT a month');
    await expect(notice.getByRole('button', { name: 'Upgrade to Business' })).toBeVisible();
  });

  await step('Choose Upgrade to Business', async () => {
    await page.getByTestId('plan-limit-notice').getByRole('button', { name: 'Upgrade to Business' }).click();
    await expect(page.getByRole('dialog', { name: 'Billing' })).toBeVisible();
  });
});
