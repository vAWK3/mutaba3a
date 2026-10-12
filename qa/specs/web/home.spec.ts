import { test, expect } from '../../support/qa';
import { openFreshApp, logIncome, openNewIncomeDrawer } from '../../support/app';
import { expectOnlyKnownAxeViolations } from '../../support/axe';

test('a fresh install\'s Home shows Get Started', { tag: '@web.home.first-run' }, async ({ page, step }) => {
  await step('Open a fresh install at /', async () => {
    await openFreshApp(page, '/');
    await expect(page.getByRole('heading', { name: 'Get Started' })).toBeVisible();
  });

  await step('Check accessibility', async () => {
    await expectOnlyKnownAxeViolations(page, 'homeFirstRun');
  });
});

// MUT-83 (ADR-049): Owed now on Home and on Clients always match. Income with no
// client is counted on both, shown on Clients as a muted "No client" row.
test(
  "Needs Attention's Owed Now matches Clients, including entries with no client",
  { tag: '@web.home.needs-attention-owed-now' },
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

    await step('Open Home and read Owed Now', async () => {
      await page.goto('/app/');
      await expect(page.getByRole('heading', { name: 'Needs Attention' })).toBeVisible();
      const owedNow = await page
        .getByRole('region', { name: 'Owed now' })
        .getByTestId('owed-now-amount')
        .allTextContents();
      expect(owedNow).toEqual(['$1,500']);
    });

    await step('Check accessibility', async () => {
      await expectOnlyKnownAxeViolations(page, 'home');
    });
  },
);
