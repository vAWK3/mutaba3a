import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { openFreshApp, logIncome, localDateFromToday, switchToArabic, enableOptionalArea } from '../../support/app';
import { ar } from '../../support/i18n';
import { attachScreenshot } from '../../support/brand';
import { readBidi, readField } from '../../support/bidi';

/**
 * MUT-109 (TD-048, direction half): direction comes from <html dir> and the dir
 * attribute only, never from a :lang() rule. These specs prove it in a browser,
 * since jsdom runs no cascade: every Arabic amount keeps the place it had before
 * (number on the right, currency on the left), text that must read left to right
 * now does, and English is untouched. Screenshots are attached for the ticket's
 * before/after review.
 */

/** Amount spans in Arabic: the default (USD) profile formats `‏1,200 US$` */
const USD_AMOUNT = /US\$/;
/** Where a standalone Arabic amount sits today, read left to right on screen: currency, then number. Kept by MUT-109 (brief D2). */
const ARABIC_AMOUNT_ON_SCREEN = /^\$US [\d,.]+$/;

const attentionRow = (page: Page, client: string, language: 'en' | 'ar') =>
  page
    .getByRole('region', { name: language === 'en' ? 'Needs Attention' : ar.overview.needsAttention })
    .getByRole('row')
    .filter({ hasText: client });
const clientLink = (page: Page, name: string) => page.getByRole('main').getByRole('row').getByRole('link', { name, exact: true });

/** Acme Studio $1,200 overdue with $200 paid, Beta Labs $300 due in 2 days */
async function logTwoClientsAndAPayment(page: Page) {
  await openFreshApp(page, '/income');
  await logIncome(page, { title: 'Logo redesign', amount: '1200', client: 'Acme Studio', dueDate: localDateFromToday(-5) });
  await logIncome(page, { title: 'Brand book', amount: '300', client: 'Beta Labs', dueDate: localDateFromToday(2) });
  await page.goto('/app/');
  await attentionRow(page, 'Acme Studio', 'en').getByRole('button').click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByLabel('Payment amount')).toBeFocused();
  // The prefill is selected, so typing replaces it
  await page.keyboard.type('200');
  await drawer.getByRole('button', { name: 'Record Payment', exact: true }).click();
  await expect(drawer).toBeHidden();
}

/** Every amount in `scope` is a plain <bdi> that resolves right to left and sits where it always has. */
async function expectArabicAmountsInPlace(scope: Locator, label: string) {
  const amounts = scope.locator('bdi').filter({ hasText: USD_AMOUNT });
  await expect(amounts.first(), `${label}: an amount is on screen`).toBeVisible();
  for (const amount of await amounts.all()) {
    const reading = await readBidi(amount);
    expect.soft(reading.visual, `${label}: amount order`).toMatch(ARABIC_AMOUNT_ON_SCREEN);
    expect.soft(reading.direction, `${label}: ${reading.visual} resolves from its RLM`).toBe('rtl');
    expect.soft(reading.dir, `${label}: ${reading.visual} is a plain <bdi>`).toBeNull();
  }
}

test(
  'Arabic: amounts on Home, Clients and a client profile keep their order and currency position',
  { tag: '@web.direction.amounts' },
  async ({ page, step }) => {
    await step('Log two clients’ income, one overdue with a partial payment, then switch to Arabic', async () => {
      await logTwoClientsAndAPayment(page);
      await switchToArabic(page);
    });

    await step('Home: owed now, needs attention and recent payments', async () => {
      await page.goto('/app/');
      await expect(page.getByTestId('owed-now-amount').first()).toBeVisible();
      await expectArabicAmountsInPlace(page.getByRole('main'), 'Home');
      await attachScreenshot(page, 'ar-home');
    });

    await step('Clients: each client’s amount', async () => {
      await page.goto('/app/clients');
      await expect(clientLink(page, 'Acme Studio')).toBeVisible();
      await expectArabicAmountsInPlace(page.getByRole('main').getByRole('table'), 'Clients');
      await attachScreenshot(page, 'ar-clients');
    });

    await step('A client profile: owed now and the work still owed', async () => {
      await clientLink(page, 'Acme Studio').click();
      await expect(page.getByRole('heading', { level: 1, name: 'Acme Studio' })).toBeVisible();
      await expectArabicAmountsInPlace(page.locator('.client-profile'), 'Client profile');
      await attachScreenshot(page, 'ar-client-profile');
    });
  },
);

test(
  'Arabic: the exchange-rate formula and a client’s email read left to right',
  { tag: '@web.direction.ltr-content' },
  async ({ page, step }) => {
    await step('Open a fresh install (1 USD = 3.70 ILS) and give a client an email', async () => {
      await page.route('https://api.frankfurter.dev/**', (route) =>
        route.fulfill({ json: { amount: 1, base: 'USD', date: '2026-10-14', rates: { ILS: 3.7 } } }),
      );
      await openFreshApp(page, '/income');
      await logIncome(page, { title: 'Logo redesign', amount: '1200', client: 'Acme Studio' });
      await page.goto('/app/clients');
      await clientLink(page, 'Acme Studio').click();
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      const drawer = page.getByRole('dialog');
      await drawer.locator('input[type="email"]').fill('nour.haddad@example.com');
      await drawer.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(drawer).toBeHidden();
      await switchToArabic(page);
    });

    await step('The top bar’s exchange rate reads $1 = ₪3.70', async () => {
      const formula = page.locator('.fx-readout-button .fx-formula');
      await expect(formula).toBeVisible();
      const reading = await readBidi(formula);
      expect(reading).toMatchObject({ direction: 'ltr', dir: 'ltr', visual: '$1 = ₪3.70' });
    });

    await step('The client’s email reads left to right on the profile', async () => {
      await page.goto('/app/clients');
      await clientLink(page, 'Acme Studio').click();
      const email = page.locator('.client-profile-contact-item').filter({ hasText: 'example.com' });
      const reading = await readBidi(email);
      expect(reading).toMatchObject({ direction: 'ltr', dir: 'ltr', visual: 'nour.haddad@example.com' });
      await attachScreenshot(page, 'ar-client-contact');
    });
  },
);

test(
  'Arabic: the income and payment drawers’ amount fields look as before, and the expense amount stays left to right',
  { tag: '@web.direction.amount-inputs' },
  async ({ page, step }) => {
    await step('Log an overdue entry, turn on Expenses and switch to Arabic', async () => {
      await openFreshApp(page, '/income');
      await logIncome(page, { title: 'Logo redesign', amount: '1200', client: 'Acme Studio', dueDate: localDateFromToday(-5) });
      await enableOptionalArea(page, 'Expenses');
      await switchToArabic(page);
    });

    await step('The income drawer: the currency and amount group reads USD | 1,200', async () => {
      await page.goto('/app/income');
      await page.getByRole('main').getByText('Logo redesign').click();
      const group = page.getByTestId('income-amount-group');
      await expect(group).toBeVisible();
      expect(await readField(group)).toMatchObject({ direction: 'ltr', dir: 'ltr' });
      expect(await readField(group.locator('input'))).toMatchObject({ direction: 'ltr', side: 'left' });
      await attachScreenshot(page, 'ar-income-drawer');
      await page.keyboard.press('Escape');
    });

    await step('The payment drawer: the same group', async () => {
      await page.goto('/app/');
      await attentionRow(page, 'Acme Studio', 'ar').getByRole('button').click();
      const field = page.locator('.pay-drawer-amount-field');
      await expect(field).toBeVisible();
      expect(await readField(field)).toMatchObject({ direction: 'ltr', dir: 'ltr' });
      expect(await readField(field.locator('input'))).toMatchObject({ direction: 'ltr', side: 'left' });
      await attachScreenshot(page, 'ar-payment-drawer');
      await page.keyboard.press('Escape');
    });

    await step('The expense form: the amount is a number field, left to right and on the right', async () => {
      await page.goto('/app/expenses');
      await page.getByRole('main').getByRole('button', { name: ar.expenses.addExpense }).click();
      const amount = page.locator('#expense-amount');
      await amount.fill('1200');
      expect(await readField(amount)).toMatchObject({ direction: 'ltr', side: 'right' });
      await attachScreenshot(page, 'ar-expense-form');
    });
  },
);

test(
  'English: amounts and fields are unchanged, and the Arabic business name is typed right to left',
  { tag: '@web.direction.english' },
  async ({ page, step }) => {
    await step('Log an overdue entry in English', async () => {
      await openFreshApp(page, '/income');
      await logIncome(page, { title: 'Logo redesign', amount: '1200', client: 'Acme Studio', dueDate: localDateFromToday(-5) });
    });

    await step('Home’s amounts read $1,200, left to right', async () => {
      await page.goto('/app/');
      const amount = page.getByTestId('owed-now-amount').first();
      expect(await readBidi(amount)).toMatchObject({ direction: 'ltr', visual: '$1,200' });
    });

    await step('The income drawer’s amount group is unchanged', async () => {
      await page.goto('/app/income');
      await page.getByRole('main').getByText('Logo redesign').click();
      expect(await readField(page.getByTestId('income-amount-group').locator('input'))).toMatchObject({ direction: 'ltr', side: 'left' });
      await page.keyboard.press('Escape');
    });

    await step('Settings › + Add Profile: the Arabic business name field is right to left', async () => {
      await page.goto('/app/settings');
      await page.getByRole('main').getByRole('button', { name: '+ Add Profile' }).click();
      const name = page.getByRole('dialog').getByLabel(/Business Name \(Arabic\)/);
      await expect(name).toBeVisible();
      expect(await readField(name)).toMatchObject({ direction: 'rtl', dir: 'rtl', side: 'right' });
      await attachScreenshot(page, 'en-business-profile');
    });
  },
);
