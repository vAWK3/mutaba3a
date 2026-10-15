import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { openFreshApp, logIncome } from '../../support/app';

/**
 * Currency conversions (MUT-141, an optional area) and the live exchange rate
 * the app reads from Frankfurter. Conversions are off on a fresh install, so
 * every test switches them on first.
 */

/** Settings › Features › "Currency conversions", switched on as a user would. */
async function enableConversions(page: Page): Promise<void> {
  await page.goto('/app/settings');
  const toggle = page.getByRole('switch', { name: 'Currency conversions', exact: true });
  if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
}

async function openConversions(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Conversions', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/conversions$/);
}

/** Opens Log Conversion from the top bar's "+ Add" menu. */
async function openLogConversion(page: Page): Promise<Locator> {
  await page.getByRole('main').getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Conversion' }).click();
  const drawer = page.getByRole('dialog').filter({ hasText: 'Log Conversion' });
  await expect(drawer).toBeVisible();
  return drawer;
}

/** The rates the stubbed Frankfurter API answers with: 1 base = rate ILS. */
const ILS_PER = { USD: 3.7, EUR: 4 } as const;
const RATE_DATE = '2026-10-14';

/** Answers the app's one network call (Frankfurter's latest rates) so the rate shown is known and the run is offline-safe. */
async function stubFrankfurter(page: Page): Promise<void> {
  await page.route('https://api.frankfurter.dev/**', async (route) => {
    const base = (new URL(route.request().url()).searchParams.get('base') ?? 'USD') as keyof typeof ILS_PER;
    await route.fulfill({
      json: { amount: 1, base, date: RATE_DATE, rates: { ILS: ILS_PER[base] ?? 1 } },
    });
  });
}

test(
  'turn on Conversions and log a conversion with its implied rate',
  { tag: '@web.conversions.log' },
  async ({ page, step }) => {
    await step('Open a fresh install and turn on Currency conversions in Settings', async () => {
      await openFreshApp(page, '/settings');
      await enableConversions(page);
    });

    await step('Open Conversions from the sidebar', async () => {
      await openConversions(page);
      await expect(page.getByText('No conversions logged yet')).toBeVisible();
    });

    let drawer = page.getByRole('dialog');
    await step('Add a conversion: 1,000 USD to 3,650 ILS', async () => {
      drawer = await openLogConversion(page);
      await drawer.getByLabel(/^From amount/).fill('1,000');
      await expect(drawer.getByLabel(/^From currency/)).toHaveValue('USD');
      await drawer.getByLabel(/^To amount/).fill('3,650');
      await expect(drawer.getByLabel(/^To currency/)).toHaveValue('ILS');
    });

    await step('Read the implied rate, add a note and save', async () => {
      await expect(drawer.getByText('Rate: 1 USD = 3.6500 ILS')).toBeVisible();
      await drawer.getByLabel('Note', { exact: true }).fill('Bank transfer to shekel account');
      await drawer.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(drawer).toBeHidden();
    });

    await step('See it on the Conversions page', async () => {
      const row = page.getByRole('row').filter({ hasText: 'Bank transfer to shekel account' });
      await expect(row.getByRole('cell').nth(1)).toHaveText('$1,000');
      await expect(row.getByRole('cell').nth(2)).toHaveText('₪3,650');
      await expect(row.getByRole('cell').nth(3)).toHaveText('3.6500');
    });
  },
);

test(
  'a conversion needs both amounts and two different currencies',
  { tag: '@web.conversions.validation' },
  async ({ page, step }) => {
    await step('Turn on Currency conversions and open Log Conversion', async () => {
      await openFreshApp(page, '/settings');
      await enableConversions(page);
      await openConversions(page);
    });

    const drawer = await openLogConversion(page);

    await step('Save with both amounts empty', async () => {
      await drawer.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(drawer.getByText('Amount is required')).toHaveCount(2);
    });

    await step('Fill both amounts but pick USD on both sides, then save', async () => {
      await drawer.getByLabel(/^From amount/).fill('100');
      await drawer.getByLabel(/^To amount/).fill('100');
      await drawer.getByLabel(/^To currency/).selectOption('USD');
      await drawer.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(drawer.getByText('Choose a different currency to convert to')).toBeVisible();
      await expect(drawer).toBeVisible();
    });

    await step('Pick EUR instead and save', async () => {
      await drawer.getByLabel(/^To currency/).selectOption('EUR');
      await expect(drawer.getByText('Rate: 1 USD = 1.0000 EUR')).toBeVisible();
      await drawer.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(drawer).toBeHidden();
    });
  },
);

test(
  'edit a conversion, then delete it',
  { tag: '@web.conversions.edit-delete' },
  async ({ page, step }) => {
    await step('Turn on Currency conversions and log one', async () => {
      await openFreshApp(page, '/settings');
      await enableConversions(page);
      await openConversions(page);
      const drawer = await openLogConversion(page);
      await drawer.getByLabel(/^From amount/).fill('500');
      await drawer.getByLabel(/^To amount/).fill('1,800');
      await drawer.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(drawer).toBeHidden();
    });

    const row = page.getByRole('row').filter({ hasText: '$500' });

    await step('Open the conversion and change what came in', async () => {
      await row.click();
      const drawer = page.getByRole('dialog').filter({ hasText: 'Edit Conversion' });
      await expect(drawer.getByLabel(/^To amount/)).toHaveValue('1800');
      await drawer.getByLabel(/^To amount/).fill('1,850');
      await expect(drawer.getByText('Rate: 1 USD = 3.7000 ILS')).toBeVisible();
      await drawer.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(drawer).toBeHidden();
      await expect(row.getByRole('cell').nth(2)).toHaveText('₪1,850');
      await expect(row.getByRole('cell').nth(3)).toHaveText('3.7000');
    });

    await step('Open it again, delete it and confirm', async () => {
      await row.click();
      const drawer = page.getByRole('dialog').filter({ hasText: 'Edit Conversion' });
      page.once('dialog', (dialog) => void dialog.accept());
      await drawer.getByRole('button', { name: 'Delete', exact: true }).click();
      await expect(drawer).toBeHidden();
      await expect(page.getByText('Conversion deleted')).toBeVisible();
      await expect(page.getByText('No conversions logged yet')).toBeVisible();
    });
  },
);

test(
  "the top bar shows today's exchange rate, and a dollar amount shows its shekel equivalent",
  { tag: '@web.conversions.fx-rate' },
  async ({ page, step }) => {
    await step('Open a fresh install (Frankfurter answers 1 USD = 3.70 ILS, 1 EUR = 4.00 ILS)', async () => {
      await stubFrankfurter(page);
      await openFreshApp(page, '/income');
    });

    await step('Read the exchange rate in the top bar and open it', async () => {
      const readout = page.getByRole('button', { name: 'Exchange rate: $1 = ₪3.70' });
      await expect(readout).toBeVisible();
      await readout.click();
      const panel = page.getByRole('dialog', { name: 'Exchange rate' });
      await expect(panel.getByText('$1 = ₪3.7000')).toBeVisible();
      await expect(panel.getByText('€1 = ₪4.0000')).toBeVisible();
      await expect(panel.getByText('Live', { exact: true })).toHaveCount(2);
      await expect(panel.getByText('Rates for Oct 14, 2026')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
    });

    await step('Log $1,000 of work and hover its amount in the Income list', async () => {
      await logIncome(page, { title: 'Brand audit', amount: '1000', client: 'Tamar Design' });
      const amount = page.getByRole('row', { name: /Brand audit/ }).getByTitle(/^≈/);
      await expect(amount).toHaveText('$1,000');
      await amount.hover();
      await expect(amount).toHaveAttribute('title', '≈ ₪3,700 ($1 = 3.70 ₪, Live)');
    });
  },
);
