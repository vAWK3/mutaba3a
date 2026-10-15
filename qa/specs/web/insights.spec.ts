import { test, expect, uniq } from '../../support/qa';
import { openFreshApp, enableOptionalArea, logIncome, openNewIncomeDrawer, localDateFromToday } from '../../support/app';
import type { Page } from '@playwright/test';

// Insights is an optional area (ADR-032): off on a fresh install, so every test
// turns it on in Settings › Advanced features first, as a user would.

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

/** A row of the Insights page's tables, by its first cell's text. */
const insightsRow = (page: Page, name: string) =>
  page.getByRole('main').getByRole('row').filter({ has: page.getByRole('cell', { name, exact: true }) });

test(
  'turn on Insights and see the month summarise logged income',
  { tag: '@web.insights.summary' },
  async ({ page, step }) => {
    const client = uniq('Northwind');

    await step('Turn on Insights in Settings', async () => {
      await openFreshApp(page, '/');
      await enableOptionalArea(page, 'Insights');
    });

    await step('Log $1,200 still owed by a client and $300 already received', async () => {
      await page.goto('/app/income');
      await logIncome(page, { title: 'Logo redesign', amount: '1200', client });
      await logReceivedIncome(page, { title: 'Walk-in job', amount: '300' });
    });

    await step('Open Insights from the sidebar', async () => {
      await page.getByRole('navigation').getByRole('link', { name: 'Insights' }).click();
      await expect(page).toHaveURL(/\/app\/insights$/);
      await expect(page.getByRole('heading', { name: 'Insights' }).first()).toBeVisible();
    });

    await step("This month's Summary: paid, still owed, and net", async () => {
      await expect(insightsRow(page, 'Paid Income')).toContainText('$300');
      await expect(insightsRow(page, 'Unpaid Receivables')).toContainText('$1,200');
      await expect(insightsRow(page, 'Net (Paid - Expenses)')).toContainText('$300');
    });

    await step('The Monthly Trend shows this month with the $300 received', async () => {
      await expect(page.getByRole('heading', { name: 'Monthly Trend' })).toBeVisible();
      const month = new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      await expect(page.getByRole('main').getByText(month, { exact: true })).toBeVisible();
      await expect(page.getByRole('main').getByText('$300', { exact: true }).last()).toBeVisible();
    });
  },
);

test(
  'the Unpaid view ages what clients owe and totals it by client',
  { tag: '@web.insights.unpaid-aging' },
  async ({ page, step }) => {
    const client = uniq('Acme');

    await step('Turn on Insights and log $500 that fell due 10 days ago', async () => {
      await openFreshApp(page, '/');
      await enableOptionalArea(page, 'Insights');
      await page.goto('/app/income');
      await logIncome(page, { title: 'Late invoice', amount: '500', client, dueDate: localDateFromToday(-10) });
    });

    await step('Open Insights and choose Unpaid', async () => {
      await page.goto('/app/insights');
      await page.getByRole('main').getByRole('button', { name: 'Unpaid', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Unpaid Receivables Aging' })).toBeVisible();
    });

    await step('The entry sits in the 1-30 days overdue bucket', async () => {
      const bucket = insightsRow(page, '1-30 days overdue');
      await expect(bucket.getByRole('cell').nth(1)).toHaveText('1');
      await expect(bucket).toContainText('$500');
      await expect(insightsRow(page, 'Current (not due)').getByRole('cell').nth(1)).toHaveText('0');
    });

    await step('Outstanding by Client lists the client with one entry', async () => {
      await expect(page.getByRole('heading', { name: 'Outstanding by Client' })).toBeVisible();
      // The Outstanding by Project table names the client too, in its second column
      const row = page.getByRole('main').getByRole('row', { name: new RegExp(`^${client} `) });
      await expect(row.getByRole('cell').nth(1)).toHaveText('1');
      await expect(row).toContainText('$500');
    });
  },
);
