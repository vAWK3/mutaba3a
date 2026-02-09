import { test, expect } from '@playwright/test';

test.describe('Settings', () => {
  test('should show language settings', async ({ page }) => {
    await page.goto('/settings');

    // Check language section exists
    await expect(page.getByText(/language/i)).toBeVisible();
  });

  test('should show theme settings', async ({ page }) => {
    await page.goto('/settings');

    // Check theme section exists
    await expect(page.getByText(/theme/i)).toBeVisible();
    await expect(page.getByText(/light/i)).toBeVisible();
    await expect(page.getByText(/dark/i)).toBeVisible();
  });

  test('should show data management section', async ({ page }) => {
    await page.goto('/settings');

    // Check data management section exists
    await expect(page.getByText(/data management/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /export/i })).toBeVisible();
  });

  test('should toggle between themes', async ({ page }) => {
    await page.goto('/settings');

    // Find and click the dark theme option
    const darkThemeButton = page.getByRole('button', { name: /dark/i });
    await darkThemeButton.click();

    // Verify dark theme is applied (check for dark class on html/body)
    await expect(page.locator('html').or(page.locator('body'))).toHaveAttribute('data-theme', 'dark');

    // Click light theme
    const lightThemeButton = page.getByRole('button', { name: /light/i });
    await lightThemeButton.click();

    // Verify light theme is applied
    await expect(page.locator('html').or(page.locator('body'))).toHaveAttribute('data-theme', 'light');
  });
});
