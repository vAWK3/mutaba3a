import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { openFreshApp, logIncome } from '../../support/app';

// The plumbing under every screen: Dexie storage, the repository, the query
// wiring and the shared UI kit. These flows break when any of it does.
function row(page: Page, title: string): Locator {
  return page.getByRole('row').filter({ hasText: title });
}

test(
  'what you log is still there after a reload',
  { tag: '@web.foundation.persists' },
  async ({ page, step }) => {
    await step('Open a fresh install at /income', async () => {
      await openFreshApp(page, '/income');
    });

    await step('Log "Logo redesign" for Acme Studio, $1,200', async () => {
      await logIncome(page, { title: 'Logo redesign', amount: '1200', client: 'Acme Studio' });
    });

    await step('Log "Brand audit" for Beta Labs, $500, and record its payment in full', async () => {
      await logIncome(page, { title: 'Brand audit', amount: '500', client: 'Beta Labs' });
      await row(page, 'Brand audit').getByRole('button', { name: /^Record Payment/ }).click();
      const drawer = page.getByRole('dialog');
      await drawer.getByRole('button', { name: 'Record Payment', exact: true }).click();
      await expect(drawer).toBeHidden();
    });

    await step('Reload the page', async () => {
      await page.reload();
    });

    await step('Both entries are back, each in the state it was left in', async () => {
      const unpaid = row(page, 'Logo redesign');
      const paid = row(page, 'Brand audit');
      await expect(unpaid).toContainText('Acme Studio');
      await expect(unpaid).toContainText('$1,200');
      await expect(unpaid.getByRole('button', { name: /^Record Payment/ })).toBeVisible();
      await expect(paid).toContainText('Beta Labs');
      await expect(paid).toContainText('$500');
      await expect(paid.getByRole('button', { name: /^Record Payment/ })).toHaveCount(0);
    });
  },
);

test(
  "a row's menu opens, and Duplicate opens a prefilled new entry",
  { tag: '@web.foundation.row-actions-duplicate' },
  async ({ page, step }) => {
    await openFreshApp(page, '/income');
    await logIncome(page, { title: 'Logo redesign', amount: '1200', client: 'Acme Studio' });

    await step("Open the row's ⋯ menu", async () => {
      await row(page, 'Logo redesign').getByRole('button', { name: 'Actions' }).click();
      const menu = page.getByRole('menu');
      await expect(menu.getByRole('menuitem', { name: 'Mark Paid' })).toBeVisible();
      await expect(menu.getByRole('menuitem', { name: 'Duplicate' })).toBeVisible();
    });

    const drawer = page.getByRole('dialog').filter({ hasText: 'New Income' });
    await step('Pick Duplicate', async () => {
      await page.getByRole('menuitem', { name: 'Duplicate' }).click();
      await expect(drawer).toBeVisible();
      await expect(drawer.getByLabel('What did you do?')).toHaveValue('Logo redesign');
      await expect(drawer.getByLabel(/^Amount/)).toHaveValue(/1,?200/);
    });

    await step('Save the drawer', async () => {
      await drawer.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(drawer).toBeHidden();
      await expect(row(page, 'Logo redesign')).toHaveCount(2);
    });
  },
);
