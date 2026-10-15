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

// MUT-226: Planning and the local Retainers area are retired and their data
// dropped. Bookmarks land on Home, and Settings offers no switch for either.
test(
  'old Planning and Retainers links land on Home, and no switch brings either area back',
  { tag: '@web.navigation.retired-areas' },
  async ({ page, step }) => {
    const sidebar = page.locator('aside.sidebar');

    await step('Open a fresh install, then a bookmarked /app/planning?plan=p1', async () => {
      await openFreshApp(page, '/');
      await page.goto('/app/planning?plan=p1');
      await expect(page).toHaveURL(/\/app\/$/);
      await expect(sidebar.getByRole('link', { name: 'Home', exact: true })).toHaveAttribute('aria-current', 'page');
    });

    await step('Open a bookmarked /app/retainers?status=active', async () => {
      await page.goto('/app/retainers?status=active');
      await expect(page).toHaveURL(/\/app\/$/);
      await expect(sidebar.getByRole('link', { name: 'Home', exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(sidebar.getByRole('link', { name: /planning|retainers/i })).toHaveCount(0);
    });

    await step('Open Settings and read the Features switches', async () => {
      await page.goto('/app/settings');
      const features = page.getByTestId('settings-features');
      await expect(features.getByRole('switch')).toHaveCount(4);
      for (const label of ['Expenses', 'Insights', 'Projects', 'Currency conversions']) {
        await expect(features.getByRole('switch', { name: label, exact: true })).toBeVisible();
      }
      await expect(features.getByText(/planning|retainers/i)).toHaveCount(0);
    });
  },
);
