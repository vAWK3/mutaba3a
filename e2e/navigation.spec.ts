import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  // MUT-15: a fresh install's sidebar is the core four; optional areas are
  // off by default, so none of their entries (or the legacy ones) appear.
  test('a fresh install shows Home, Clients, Income, Settings and each one navigates', async ({ page }) => {
    await page.goto('/app/');
    const welcome = page.getByRole('dialog');
    if (await welcome.isVisible().catch(() => false)) {
      await welcome.getByRole('button', { name: /skip for now/i }).click();
      await expect(welcome).toBeHidden();
    }

    const sidebar = page.locator('aside.sidebar');
    await expect(sidebar.locator('a.nav-item')).toHaveText(['Home', 'Clients', 'Income', 'Settings']);
    await expect(sidebar.getByRole('link', { name: /projects|transactions|reports|expenses/i })).toHaveCount(0);

    for (const [name, path] of [
      ['Clients', '/app/clients'],
      ['Income', '/app/income'],
      ['Settings', '/app/settings'],
      ['Home', '/app/'],
    ] as const) {
      await sidebar.getByRole('link', { name, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(sidebar.getByRole('link', { name, exact: true })).toHaveAttribute('aria-current', 'page');
    }
  });

  test('should have responsive sidebar navigation', async ({ page }) => {
    await page.goto('/app/');

    // Check sidebar exists
    const sidebar = page.locator('[class*="sidebar"], [class*="nav"]');
    await expect(sidebar.first()).toBeVisible();
  });
});
