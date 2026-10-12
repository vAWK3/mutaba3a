import { test, expect } from '../../support/qa';
import { openFreshApp } from '../../support/app';

// MUT-15: a fresh install's sidebar is the core four; optional areas are off by
// default, so none of their entries (or the legacy ones) appear.
test(
  'a fresh install shows Home, Clients, Income, Settings and each one navigates',
  { tag: '@web.navigation.core-sidebar' },
  async ({ page, step }) => {
    const sidebar = page.locator('aside.sidebar');

    await step('Open a fresh install', async () => {
      await openFreshApp(page, '/');
    });

    await step('Read the sidebar items', async () => {
      await expect(sidebar.locator('a.nav-item')).toHaveText(['Home', 'Clients', 'Income', 'Settings']);
      await expect(sidebar.getByRole('link', { name: /projects|transactions|reports|expenses/i })).toHaveCount(0);
    });

    for (const [name, path] of [
      ['Clients', '/app/clients'],
      ['Income', '/app/income'],
      ['Settings', '/app/settings'],
      ['Home', '/app/'],
    ] as const) {
      await step(`Click ${name}`, async () => {
        await sidebar.getByRole('link', { name, exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`${path}$`));
        await expect(sidebar.getByRole('link', { name, exact: true })).toHaveAttribute('aria-current', 'page');
      });
    }
  },
);
