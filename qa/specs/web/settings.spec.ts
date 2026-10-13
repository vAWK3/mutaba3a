import { test, expect } from '../../support/qa';
import { openFreshApp } from '../../support/app';
import { expectOnlyKnownAxeViolations } from '../../support/axe';

test(
  'switches the language to Arabic (right-to-left) and back',
  { tag: '@web.settings.language' },
  async ({ page, step }) => {
    await openFreshApp(page, '/settings');
    const main = page.getByRole('main');
    const html = page.locator('html');
    await expect(main.getByRole('heading', { name: 'Language' })).toBeVisible();

    await step('Click العربية', async () => {
      await main.getByRole('radio', { name: 'العربية' }).click();
      await expect(html).toHaveAttribute('lang', 'ar');
      await expect(html).toHaveAttribute('dir', 'rtl');
    });

    await step('Click English', async () => {
      await main.getByRole('radio', { name: 'English' }).click();
      await expect(html).toHaveAttribute('lang', 'en');
      await expect(html).toHaveAttribute('dir', 'ltr');
    });

    await step('Check accessibility', async () => {
      await expectOnlyKnownAxeViolations(page, 'settings');
    });
  },
);

test(
  'switches between the dark, light and system themes',
  { tag: '@web.settings.theme' },
  async ({ page, step }) => {
    await openFreshApp(page, '/settings');
    // Scoped to main: the sidebar's theme toggle ("Theme: System") sits outside it
    const main = page.getByRole('main');
    const html = page.locator('html');
    await expect(main.getByRole('heading', { name: 'Theme' })).toBeVisible();

    await step('Click Dark', async () => {
      await main.getByRole('button', { name: 'Dark', exact: true }).click();
      await expect(html).toHaveAttribute('data-theme', 'dark');
    });

    await step('Click Light', async () => {
      await main.getByRole('button', { name: 'Light', exact: true }).click();
      await expect(html).toHaveAttribute('data-theme', 'light');
    });

    await step('Click System', async () => {
      // System drops the attribute and lets prefers-color-scheme decide
      await main.getByRole('button', { name: 'System', exact: true }).click();
      await expect(html).not.toHaveAttribute('data-theme');
    });
  },
);

test('Data Management exports the default profile', { tag: '@web.settings.export' }, async ({ page, step }) => {
  await openFreshApp(page, '/settings');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Data Management' })).toBeVisible();

  await step('Open the Export Data dialog', async () => {
    await main.getByRole('button', { name: 'Export JSON' }).click();
    await expect(page.getByRole('dialog', { name: 'Export Data' })).toBeVisible();
  });

  await step('Export the default profile', async () => {
    const dialog = page.getByRole('dialog', { name: 'Export Data' });
    // CSV is the format the dialog picks first
    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Export Default Profile' }).click();
    expect((await download).suggestedFilename()).toMatch(/^mutaba3a-Default-Profile-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
