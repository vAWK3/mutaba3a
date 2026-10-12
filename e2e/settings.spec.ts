import { test, expect } from '@playwright/test';
import { openFreshApp } from './support/app';

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await openFreshApp(page, '/settings');
  });

  test('switches the language to Arabic (right-to-left) and back', async ({ page }) => {
    const main = page.getByRole('main');
    const html = page.locator('html');
    await expect(main.getByRole('heading', { name: 'Language' })).toBeVisible();

    await main.getByRole('button', { name: 'العربية' }).click();
    await expect(html).toHaveAttribute('lang', 'ar');
    await expect(html).toHaveAttribute('dir', 'rtl');

    await main.getByRole('button', { name: 'English' }).click();
    await expect(html).toHaveAttribute('lang', 'en');
    await expect(html).toHaveAttribute('dir', 'ltr');
  });

  test('switches between the dark, light and system themes', async ({ page }) => {
    // Scoped to main: the FX banner has its own "System" button
    const main = page.getByRole('main');
    const html = page.locator('html');
    await expect(main.getByRole('heading', { name: 'Theme' })).toBeVisible();

    await main.getByRole('button', { name: 'Dark', exact: true }).click();
    await expect(html).toHaveAttribute('data-theme', 'dark');

    await main.getByRole('button', { name: 'Light', exact: true }).click();
    await expect(html).toHaveAttribute('data-theme', 'light');

    // System drops the attribute and lets prefers-color-scheme decide
    await main.getByRole('button', { name: 'System', exact: true }).click();
    await expect(html).not.toHaveAttribute('data-theme');
  });

  test('Data Management exports the default profile', async ({ page }) => {
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: 'Data Management' })).toBeVisible();

    await main.getByRole('button', { name: 'Export JSON' }).click();
    const dialog = page.getByRole('dialog', { name: 'Export Data' });
    await expect(dialog).toBeVisible();

    // CSV is the format the dialog picks first
    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Export Default Profile' }).click();
    expect((await download).suggestedFilename()).toMatch(/^mutaba3a-Default-Profile-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
