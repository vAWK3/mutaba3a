import { test, expect } from '../../support/qa';
import { openFreshApp, logIncome, openNewIncomeDrawer } from '../../support/app';
import { expectOnlyKnownAxeViolations } from '../../support/axe';

// MUT-83 (ADR-049): Owed now on Home and on Clients always match. Income with
// no client is counted on both, shown on Clients as a muted "No client" row
// that opens the entries behind it.
test(
  "the Clients strip's Owed Now equals Home's, including a No client row",
  { tag: '@web.clients.owed-now-parity' },
  async ({ page, step }) => {
    await step('Log one income entry for a client and one with no client', async () => {
      await openFreshApp(page, '/income');
      await logIncome(page, { title: 'Logo redesign', amount: '1200', client: 'Acme Studio' });

      const drawer = await openNewIncomeDrawer(page);
      await drawer.getByLabel('What did you do?').fill('Walk-in job');
      await drawer.getByLabel(/^Amount/).fill('300');
      await drawer.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(drawer).toBeHidden();
    });

    let home: string[] = [];
    await step('Open Home and read Owed Now', async () => {
      await page.goto('/app/');
      home = await page.getByRole('region', { name: 'Owed now' }).getByTestId('owed-now-amount').allTextContents();
      expect(home).toEqual(['$1,500']);
    });

    await step('Open Clients and find the "No client" row', async () => {
      await page.goto('/app/clients');
      const noClient = page.getByRole('link', { name: 'No client · 1 entry' });
      await expect(noClient).toBeVisible();
      const clientsOwedNow = await page
        .getByRole('region', { name: 'Owed now' })
        .getByTestId('owed-now-amount')
        .allTextContents();
      expect(clientsOwedNow).toEqual(home);
    });

    await step('Check accessibility', async () => {
      await expectOnlyKnownAxeViolations(page, 'clients');
    });
  },
);

test(
  'the "No client" row opens Income filtered to that entry, with a clearable chip',
  { tag: '@web.clients.no-client-filter' },
  async ({ page, step }) => {
    await openFreshApp(page, '/income');
    const drawer = await openNewIncomeDrawer(page);
    await drawer.getByLabel(/^Amount/).fill('300');
    await drawer.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(drawer).toBeHidden();

    let chip = page.locator('button');
    await step('Click the "No client" row on Clients', async () => {
      await page.goto('/app/clients');
      await page.getByRole('link', { name: 'No client · 1 entry' }).click();

      await expect(page).toHaveURL(/\/app\/income\?.*client=none/);
      chip = page.getByRole('button', { name: 'Clear filter: No client' });
      await expect(chip).toBeVisible();
      const rows = page.getByRole('table').getByRole('row');
      await expect(rows).toHaveCount(2); // header + the one entry
      await expect(rows.nth(1)).toContainText('$300');
    });

    await step('Clear the filter chip', async () => {
      await chip.click();
      await expect(page).not.toHaveURL(/client=none/);
    });
  },
);

test("a client's profile shows their logged work", { tag: '@web.clients.profile' }, async ({ page, step }) => {
  await openFreshApp(page, '/income');
  await logIncome(page, { title: 'Logo redesign', amount: '1200', client: 'Acme Studio' });

  await step('Open the client from the Clients list', async () => {
    await page.goto('/app/clients');
    await page.getByRole('link', { name: 'Acme Studio' }).first().click();
    await expect(page.getByRole('heading', { name: 'Work and billing' })).toBeVisible();
    await expect(page.getByText('Logo redesign')).toBeVisible();
  });

  await step('Check accessibility', async () => {
    await expectOnlyKnownAxeViolations(page, 'clientProfile');
  });
});
