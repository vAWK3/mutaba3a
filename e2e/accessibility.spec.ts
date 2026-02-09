import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Accessibility', () => {
  test('Overview page should not have any automatically detectable accessibility issues', async ({ page }) => {
    await page.goto('/');

    // Wait for page to be ready
    await expect(page.getByRole('heading', { name: /overview/i })).toBeVisible();

    const accessibilityScanResults = await new AxeBuilder({ page })
      .exclude('.recharts-wrapper') // Exclude charts as they have known issues
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('Transactions page should not have any automatically detectable accessibility issues', async ({ page }) => {
    await page.goto('/transactions');

    // Wait for page to be ready
    await expect(page.getByRole('heading', { name: /transactions/i })).toBeVisible();

    const accessibilityScanResults = await new AxeBuilder({ page })
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('Projects page should not have any automatically detectable accessibility issues', async ({ page }) => {
    await page.goto('/projects');

    // Wait for page to be ready
    await expect(page.getByRole('heading', { name: /projects/i })).toBeVisible();

    const accessibilityScanResults = await new AxeBuilder({ page })
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('Clients page should not have any automatically detectable accessibility issues', async ({ page }) => {
    await page.goto('/clients');

    // Wait for page to be ready
    await expect(page.getByRole('heading', { name: /clients/i })).toBeVisible();

    const accessibilityScanResults = await new AxeBuilder({ page })
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('Reports page should not have any automatically detectable accessibility issues', async ({ page }) => {
    await page.goto('/reports');

    // Wait for page to be ready
    await expect(page.getByRole('heading', { name: /reports/i })).toBeVisible();

    const accessibilityScanResults = await new AxeBuilder({ page })
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('Settings page should not have any automatically detectable accessibility issues', async ({ page }) => {
    await page.goto('/settings');

    // Wait for page to be ready
    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible();

    const accessibilityScanResults = await new AxeBuilder({ page })
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('Transaction drawer should have proper ARIA labels', async ({ page }) => {
    await page.goto('/transactions');

    // Open the transaction drawer
    await page.getByRole('button', { name: /add transaction|new/i }).click();

    // Wait for drawer to open
    await expect(page.getByText(/new transaction/i)).toBeVisible();

    // Run accessibility check on the drawer
    const accessibilityScanResults = await new AxeBuilder({ page })
      .include('[role="dialog"], .drawer, [class*="drawer"]') // Focus on drawer
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });
});
