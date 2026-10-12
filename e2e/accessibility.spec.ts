import { test, expect } from '@playwright/test';
import { logIncome, openFreshApp, openNewIncomeDrawer } from './support/app';
import { expectOnlyKnownAxeViolations } from './support/axe';

// Axe on the core surfaces (MUT-15): Home, Clients, a client's profile,
// Income, Settings and the income drawer. Projects and Insights are optional
// areas, off on a fresh install, so their routes send you home.
// Each surface may only break the rules listed for it in support/axe.ts (TD-009).
test.describe('Accessibility', () => {
  test.describe('on a fresh install', () => {
    test('Home, first run (Get Started)', async ({ page }) => {
      await openFreshApp(page, '/');
      await expect(page.getByRole('heading', { name: 'Get Started' })).toBeVisible();

      await expectOnlyKnownAxeViolations(page, 'homeFirstRun');
    });

    test('Settings', async ({ page }) => {
      await openFreshApp(page, '/settings');
      await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Data Management' })).toBeVisible();

      await expectOnlyKnownAxeViolations(page, 'settings');
    });

    test('Income drawer, with More details open', async ({ page }) => {
      await openFreshApp(page, '/income');
      const drawer = await openNewIncomeDrawer(page);
      await drawer.getByRole('button', { name: 'More details' }).click();
      await expect(drawer.getByRole('group', { name: 'Status' })).toBeVisible();

      await expectOnlyKnownAxeViolations(page, 'incomeDrawer', '[role="dialog"]');
    });
  });

  // One logged entry, so each page renders its real content, not an empty state
  test.describe('with an entry logged', () => {
    test.beforeEach(async ({ page }) => {
      await openFreshApp(page, '/income');
      await logIncome(page, { title: 'Logo redesign', amount: '1200', client: 'Acme Studio' });
    });

    test('Home', async ({ page }) => {
      await page.goto('/app/');
      await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Needs Attention' })).toBeVisible();

      await expectOnlyKnownAxeViolations(page, 'home');
    });

    test('Clients', async ({ page }) => {
      await page.goto('/app/clients');
      await expect(page.getByRole('link', { name: 'Acme Studio' }).first()).toBeVisible();

      await expectOnlyKnownAxeViolations(page, 'clients');
    });

    test('Client profile', async ({ page }) => {
      await page.goto('/app/clients');
      await page.getByRole('link', { name: 'Acme Studio' }).first().click();
      await expect(page.getByRole('heading', { name: 'Work and billing' })).toBeVisible();
      await expect(page.getByText('Logo redesign')).toBeVisible();

      await expectOnlyKnownAxeViolations(page, 'clientProfile');
    });

    test('Income', async ({ page }) => {
      await page.goto('/app/income');
      await expect(page.getByRole('row').filter({ hasText: 'Acme Studio' })).toBeVisible();

      await expectOnlyKnownAxeViolations(page, 'income');
    });
  });
});
