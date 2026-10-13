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
    // Language is a radiogroup named by its row label since MUT-139, not a heading
    await expect(main.getByRole('radiogroup', { name: 'Language' })).toBeVisible();

    // Found through main, not the group: the group's name turns Arabic with the page
    await step('Click العربية', async () => {
      const arabic = main.getByRole('radio', { name: 'العربية' });
      await arabic.click();
      await expect(arabic).toHaveAttribute('aria-checked', 'true');
      await expect(html).toHaveAttribute('lang', 'ar');
      await expect(html).toHaveAttribute('dir', 'rtl');
    });

    await step('Click English', async () => {
      const english = main.getByRole('radio', { name: 'English' });
      await english.click();
      await expect(english).toHaveAttribute('aria-checked', 'true');
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
    // Theme is a radiogroup since MUT-139. Scoped to it, so the sidebar's theme
    // toggle button ("Theme: System") is never the one clicked.
    const theme = page.getByRole('main').getByRole('radiogroup', { name: 'Theme' });
    const html = page.locator('html');
    await expect(theme).toBeVisible();

    await step('Click Dark', async () => {
      const dark = theme.getByRole('radio', { name: 'Dark', exact: true });
      await dark.click();
      await expect(dark).toHaveAttribute('aria-checked', 'true');
      await expect(html).toHaveAttribute('data-theme', 'dark');
    });

    await step('Click Light', async () => {
      const light = theme.getByRole('radio', { name: 'Light', exact: true });
      await light.click();
      await expect(light).toHaveAttribute('aria-checked', 'true');
      await expect(html).toHaveAttribute('data-theme', 'light');
    });

    await step('Click System', async () => {
      // System drops the attribute and lets prefers-color-scheme decide
      const system = theme.getByRole('radio', { name: 'System', exact: true });
      await system.click();
      await expect(system).toHaveAttribute('aria-checked', 'true');
      await expect(html).not.toHaveAttribute('data-theme');
    });
  },
);

test('Your data exports one business', { tag: '@web.settings.export' }, async ({ page, step }) => {
  await openFreshApp(page, '/settings');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Your data' })).toBeVisible();

  await step('Open Export a business', async () => {
    await main.getByRole('button', { name: 'Export…' }).click();
    await expect(page.getByRole('dialog', { name: 'Export a business' })).toBeVisible();
  });

  await step('Export the default profile', async () => {
    const dialog = page.getByRole('dialog', { name: 'Export a business' });
    // CSV is the format the dialog picks first
    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Export Default Profile' }).click();
    expect((await download).suggestedFilename()).toMatch(/^mutaba3a-Default-Profile-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
