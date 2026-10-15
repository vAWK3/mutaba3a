import fs from 'node:fs';
import { test, expect, uniq } from '../../support/qa';
import { openFreshApp, enableOptionalArea, logIncome, openNewIncomeDrawer } from '../../support/app';
import type { Page } from '@playwright/test';

// Reports became the Insights page's presets: /reports redirects to /insights,
// which is gated by the optional Insights area (off on a fresh install).

/** Logs an entry that was already paid: Status › Received under More details. */
async function logReceivedIncome(page: Page, entry: { title: string; amount: string }): Promise<void> {
  const drawer = await openNewIncomeDrawer(page);
  await drawer.getByLabel('What did you do?').fill(entry.title);
  await drawer.getByLabel(/^Amount/).fill(entry.amount);
  await drawer.getByRole('button', { name: 'More details' }).click();
  await drawer.getByRole('group', { name: 'Status' }).getByRole('button', { name: /^Received/ }).click();
  await drawer.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(drawer).toBeHidden();
}

/** One of the Insights presets (Summary, Clients, Projects, Expenses, Unpaid). */
const preset = (page: Page, name: string) => page.getByRole('main').getByRole('button', { name, exact: true });

const main = (page: Page) => page.getByRole('main');

test(
  'an old Reports link lands on Insights once it is on, and on Home while it is off',
  { tag: '@web.reports.legacy-link' },
  async ({ page, step }) => {
    await step('Open /reports on a fresh install, Insights off', async () => {
      await openFreshApp(page, '/');
      await page.goto('/app/reports');
      await expect(page).toHaveURL(/\/app\/?$/);
    });

    await step('Turn on Insights in Settings', async () => {
      await enableOptionalArea(page, 'Insights');
    });

    await step('Open /reports again', async () => {
      await page.goto('/app/reports');
      await expect(page).toHaveURL(/\/app\/insights$/);
      for (const name of ['Summary', 'Clients', 'Projects', 'Expenses', 'Unpaid']) {
        await expect(preset(page, name)).toBeVisible();
      }
      await expect(main(page).getByRole('button', { name: 'Export CSV' })).toBeVisible();
    });
  },
);

test(
  'the period and currency filters narrow the report, and each preset shows its own table',
  { tag: '@web.reports.presets' },
  async ({ page, step }) => {
    const client = uniq('Northwind');

    await step('Turn on Insights and log $1,200 owed by a client', async () => {
      await openFreshApp(page, '/');
      await enableOptionalArea(page, 'Insights');
      await page.goto('/app/income');
      await logIncome(page, { title: 'Logo redesign', amount: '1200', client });
      await page.goto('/app/insights');
    });

    await step('Switch the period: Last Month is empty, This Year holds the entry', async () => {
      const unpaid = main(page).getByRole('row').filter({ hasText: 'Unpaid Receivables' });
      await expect(unpaid).toContainText('$1,200');
      const period = page.getByLabel('Period');
      await period.selectOption({ label: 'Last Month' });
      await expect(unpaid).not.toContainText('$1,200');
      await period.selectOption({ label: 'This Year' });
      await expect(unpaid).toContainText('$1,200');
    });

    await step('Summary shows a USD and an ILS column; choose USD and the ILS column goes', async () => {
      // The currency filter has no label of its own: it is the select offering "Both"
      const currency = main(page).getByRole('combobox').filter({ has: page.locator('option', { hasText: 'Both' }) });
      await expect(main(page).getByRole('columnheader', { name: 'ILS' })).toBeVisible();
      await currency.selectOption({ label: 'USD' });
      await expect(main(page).getByRole('columnheader', { name: 'USD' })).toBeVisible();
      await expect(main(page).getByRole('columnheader', { name: 'ILS' })).toHaveCount(0);
      await currency.selectOption({ label: 'Both' });
    });

    await step('Clients lists the client with what it owes', async () => {
      await preset(page, 'Clients').click();
      const row = main(page).getByRole('row').filter({ hasText: client });
      await expect(row).toContainText('$1,200');
    });

    await step('Projects and Expenses say there is nothing yet', async () => {
      await preset(page, 'Projects').click();
      await expect(main(page).getByText('No projects found')).toBeVisible();
      await preset(page, 'Expenses').click();
      await expect(main(page).getByText('No expenses in this period')).toBeVisible();
    });

    await step('Unpaid shows the aging buckets', async () => {
      await preset(page, 'Unpaid').click();
      await expect(page.getByRole('heading', { name: 'Unpaid Receivables Aging' })).toBeVisible();
      // The aging table's first column header also reads "Current (not due)": take the body row, by its count
      await expect(main(page).getByRole('row', { name: /^Current \(not due\) 1 / })).toContainText('$1,200');
    });
  },
);

test(
  'Export CSV downloads the open preset for the chosen dates',
  { tag: '@web.reports.export-csv' },
  async ({ page, step }) => {
    const client = uniq('Northwind');

    await step('Turn on Insights, log $1,200 owed and $300 received', async () => {
      await openFreshApp(page, '/');
      await enableOptionalArea(page, 'Insights');
      await page.goto('/app/income');
      await logIncome(page, { title: 'Logo redesign', amount: '1200', client });
      await logReceivedIncome(page, { title: 'Walk-in job', amount: '300' });
      await page.goto('/app/insights');
      await expect(main(page).getByRole('row').filter({ hasText: 'Paid Income' })).toContainText('$300');
    });

    await step('Click Export CSV on the Summary', async () => {
      const downloading = page.waitForEvent('download');
      await main(page).getByRole('button', { name: 'Export CSV' }).click();
      const download = await downloading;
      expect(download.suggestedFilename()).toMatch(/^insights-summary-\d{4}-\d{2}-01-\d{4}-\d{2}-\d{2}\.csv$/);
      const csv = fs.readFileSync(await download.path(), 'utf8').split('\n');
      expect(csv[0]).toBe('Category,USD,ILS');
      expect(csv).toContain('Paid Income,300,0');
      expect(csv).toContain('Unpaid Receivables,1200,0');
      expect(csv).toContain('Net (Paid - Expenses),300,0');
    });

    await step('Choose Clients and export again', async () => {
      await preset(page, 'Clients').click();
      await expect(main(page).getByRole('row').filter({ hasText: client })).toBeVisible();
      const downloading = page.waitForEvent('download');
      await main(page).getByRole('button', { name: 'Export CSV' }).click();
      const download = await downloading;
      expect(download.suggestedFilename()).toMatch(/^insights-clients-.+\.csv$/);
      const csv = fs.readFileSync(await download.path(), 'utf8');
      expect(csv).toContain('Client,Active Projects,Paid USD,Paid ILS,Unpaid USD,Unpaid ILS');
      expect(csv).toContain(`${client},0,0,0,1200,0`);
    });
  },
);
