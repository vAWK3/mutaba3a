import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test('should navigate to all main pages', async ({ page }) => {
    await page.goto('/');

    // Verify we're on the Overview page
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { name: /overview/i })).toBeVisible();

    // Navigate to Projects
    await page.getByRole('link', { name: /projects/i }).click();
    await expect(page).toHaveURL('/projects');
    await expect(page.getByRole('heading', { name: /projects/i })).toBeVisible();

    // Navigate to Clients
    await page.getByRole('link', { name: /clients/i }).click();
    await expect(page).toHaveURL('/clients');
    await expect(page.getByRole('heading', { name: /clients/i })).toBeVisible();

    // Navigate to Transactions
    await page.getByRole('link', { name: /transactions/i }).click();
    await expect(page).toHaveURL('/transactions');
    await expect(page.getByRole('heading', { name: /transactions/i })).toBeVisible();

    // Navigate to Reports
    await page.getByRole('link', { name: /reports/i }).click();
    await expect(page).toHaveURL('/reports');
    await expect(page.getByRole('heading', { name: /reports/i })).toBeVisible();

    // Navigate to Settings
    await page.getByRole('link', { name: /settings/i }).click();
    await expect(page).toHaveURL('/settings');
    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible();
  });

  test('should have responsive sidebar navigation', async ({ page }) => {
    await page.goto('/');

    // Check sidebar exists
    const sidebar = page.locator('[class*="sidebar"], [class*="nav"]');
    await expect(sidebar.first()).toBeVisible();
  });
});
