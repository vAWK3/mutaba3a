import { test, expect } from '@playwright/test';
import { openFreshApp, openNewIncomeDrawer } from './support/app';

// The income drawer by mouse, opened from "+ Add". Income, expense and
// receivable are no longer types picked in one drawer: a receivable is unpaid
// income (Earned or Invoiced) and expenses are an optional area (MUT-12).
// The keyboard fast path is covered by income-fast-path.spec.ts.
test.describe('Income drawer', () => {
  test.beforeEach(async ({ page }) => {
    await openFreshApp(page, '/income');
  });

  test('an amount alone saves an unpaid entry that shows in the Income list', async ({ page }) => {
    const drawer = await openNewIncomeDrawer(page);
    await drawer.getByLabel(/^Amount/).fill('150');
    await drawer.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(drawer).toBeHidden();

    const row = page.getByRole('row').filter({ hasText: '$150' });
    await expect(row).toContainText('No client');
    await expect(row).toContainText('Unpaid');
  });

  test('Save with no amount says "Amount is required" and keeps the drawer open', async ({ page }) => {
    const drawer = await openNewIncomeDrawer(page);
    await drawer.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(drawer.getByText('Amount is required')).toBeVisible();
    await expect(drawer).toBeVisible();
  });

  test('Due Date shows for unpaid income and hides once the status is Received', async ({ page }) => {
    const drawer = await openNewIncomeDrawer(page);
    await drawer.getByRole('button', { name: 'More details' }).click();
    const status = drawer.getByRole('group', { name: 'Status' });
    const dueDate = drawer.getByLabel('Due Date');

    await expect(status.getByRole('button', { name: /^Earned/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(dueDate).toBeVisible();

    await status.getByRole('button', { name: /^Received/ }).click();
    await expect(dueDate).toBeHidden();

    await status.getByRole('button', { name: /^Invoiced/ }).click();
    await expect(dueDate).toBeVisible();
  });
});
