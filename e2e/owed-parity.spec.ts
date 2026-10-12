import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { logIncome, openFreshApp, openNewIncomeDrawer } from './support/app';
import { expectOnlyKnownAxeViolations } from './support/axe';

// MUT-83 (ADR-049): Owed now on Home and on Clients always match. Income with
// no client is counted on both, shown on Clients as a muted "No client" row
// that opens the entries behind it.
test.describe('Owed now parity (MUT-83)', () => {
  const owedNow = (page: Page) =>
    page.getByRole('region', { name: 'Owed now' }).getByTestId('owed-now-amount').allTextContents();

  /** Muted is not faint: the new row and chip pass contrast, though the app shell doesn't yet (TD-009). */
  const contrastViolations = async (page: Page, selector: string) =>
    (await new AxeBuilder({ page }).include(selector).withRules(['color-contrast']).analyze()).violations;

  test.beforeEach(async ({ page }) => {
    await openFreshApp(page, '/income');
    await logIncome(page, { title: 'Logo redesign', amount: '1200', client: 'Acme Studio' });

    const drawer = await openNewIncomeDrawer(page);
    await drawer.getByLabel('What did you do?').fill('Walk-in job');
    await drawer.getByLabel(/^Amount/).fill('300');
    await drawer.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(drawer).toBeHidden();
  });

  test('the Clients strip equals Home, and the No client row makes up the difference', async ({ page }) => {
    await page.goto('/app/');
    await expect(page.getByRole('heading', { name: 'Needs Attention' })).toBeVisible();
    const home = await owedNow(page);
    expect(home).toEqual(['$1,500']);

    await page.goto('/app/clients');
    const noClient = page.getByRole('link', { name: 'No client · 1 entry' });
    await expect(noClient).toBeVisible();
    expect(await owedNow(page)).toEqual(home);

    await expectOnlyKnownAxeViolations(page, 'clients');
    expect(await contrastViolations(page, '.client-index-bucket-row')).toEqual([]);
  });

  test('the No client row opens the unpaid entries with no client, with a chip that clears the filter', async ({ page }) => {
    await page.goto('/app/clients');
    await page.getByRole('link', { name: 'No client · 1 entry' }).click();

    await expect(page).toHaveURL(/\/app\/income\?.*client=none/);
    const chip = page.getByRole('button', { name: 'Clear filter: No client' });
    await expect(chip).toBeVisible();
    const rows = page.getByRole('table').getByRole('row');
    await expect(rows).toHaveCount(2); // header + the one entry
    await expect(rows.nth(1)).toContainText('$300');

    await expectOnlyKnownAxeViolations(page, 'income');
    expect(await contrastViolations(page, '.income-scope-chip')).toEqual([]);

    await chip.click();
    await expect(page).not.toHaveURL(/client=none/);
    await expect(page.getByRole('table').getByRole('row').filter({ hasText: 'Acme Studio' })).toBeVisible();
  });
});
