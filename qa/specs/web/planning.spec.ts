import fs from 'node:fs';
import { test, expect } from '../../support/qa';
import { openFreshApp, enableOptionalArea } from '../../support/app';
import type { Locator, Page } from '@playwright/test';

// Planning is an optional area (ADR-032): off on a fresh install, so every test
// turns it on in Settings › Advanced features first, as a user would.

const main = (page: Page) => page.getByRole('main');

/** Turns Planning on, opens it from the sidebar and creates the first plan from the empty state. */
async function createFirstPlan(page: Page): Promise<void> {
  await openFreshApp(page, '/');
  await enableOptionalArea(page, 'Planning');
  await page.getByRole('navigation').getByRole('link', { name: 'Planning' }).click();
  await expect(page).toHaveURL(/\/app\/planning/);
  await expect(main(page).getByRole('heading', { name: 'Start Planning Your Finances' })).toBeVisible();
  await main(page).getByRole('button', { name: 'Create Your First Plan' }).click();
  await expect(main(page).getByText('My Plan', { exact: true })).toBeVisible();
}

/** The New Assumption drawer, opened from the Assumptions panel's + Add. */
async function openNewAssumption(page: Page): Promise<Locator> {
  // The panel header's + Add comes first; each non-empty group has its own + Add below its items
  await main(page).getByRole('button', { name: '+ Add', exact: true }).first().click();
  const drawer = page.getByRole('dialog').filter({ hasText: 'New Assumption' });
  await expect(drawer).toBeVisible();
  return drawer;
}

/** Fills and saves a monthly recurring assumption of `amount` USD in `category`. */
async function addMonthlyAssumption(
  page: Page,
  entry: { category: 'Revenue' | 'Expenses'; label: string; amount: string },
): Promise<void> {
  const drawer = await openNewAssumption(page);
  await drawer.getByRole('button', { name: entry.category, exact: true }).click();
  await drawer.getByPlaceholder('e.g., Monthly retainer income').fill(entry.label);
  await expect(drawer.getByRole('button', { name: 'Recurring', exact: true })).toBeVisible();
  await drawer.getByPlaceholder('0.00').fill(entry.amount);
  await drawer.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(drawer).toBeHidden();
}

/** A summary-strip card's value, by its label. */
const summaryCard = (page: Page, label: string) =>
  main(page).getByText(label, { exact: true }).locator('xpath=..');

test(
  'turn on Planning and create a first plan from the empty state',
  { tag: '@web.planning.create-plan' },
  async ({ page, step }) => {
    await step('Turn on Planning, open it and create your first plan', async () => {
      await createFirstPlan(page);
    });

    await step('The plan opens on its Base scenario with an empty Assumptions panel and a 12-month timeline', async () => {
      await expect(main(page).getByRole('button', { name: 'Base', exact: true })).toBeVisible();
      await expect(main(page).getByRole('heading', { name: 'Assumptions' })).toBeVisible();
      await expect(main(page).getByRole('button', { name: '+ Add Revenue' })).toBeVisible();
      await expect(main(page).getByRole('heading', { name: 'Monthly Cash Flow' })).toBeVisible();
      await expect(main(page).getByText('Ending: $0', { exact: true })).toBeVisible();
    });
  },
);

test(
  'adding plan assumptions through the drawer updates the timeline and the summary',
  { tag: '@web.planning.add-assumption' },
  async ({ page, step }) => {
    await step('Turn on Planning and create a plan', async () => {
      await createFirstPlan(page);
    });

    await step('Add a $1,000 monthly revenue assumption', async () => {
      await addMonthlyAssumption(page, { category: 'Revenue', label: 'Retainer income', amount: '1000' });
    });

    await step('The Revenue group lists it as Monthly, the timeline ends 12 months later at $12,000, and the plan reads self-sustaining', async () => {
      const item = main(page).getByText('Retainer income').locator('xpath=../..');
      await expect(item).toContainText('Monthly');
      await expect(item).toContainText('$1,000');
      await expect(main(page).getByText('Ending: $12,000', { exact: true })).toBeVisible();
      // The card shows one total converted at the live rate: its USD line is the honest check
      await summaryCard(page, 'Avg Monthly Revenue').getByRole('button', { name: 'Show currency breakdown' }).click();
      await expect(page.getByText('USD', { exact: true }).last().locator('xpath=..')).toContainText('$1,000');
      await page.keyboard.press('Escape');
      await expect(main(page).getByText('Your plan is self-sustaining! No external funding needed.')).toBeVisible();
    });

    await step('Add a $400 monthly expense assumption', async () => {
      await addMonthlyAssumption(page, { category: 'Expenses', label: 'Studio rent', amount: '400' });
    });

    await step('The timeline now ends at $7,200 and the plan breaks even', async () => {
      await expect(main(page).getByText('Studio rent')).toBeVisible();
      await expect(main(page).getByText('Ending: $7,200', { exact: true })).toBeVisible();
      await expect(summaryCard(page, 'Break-Even')).not.toContainText('Not reached');
    });
  },
);

test(
  'an assumption opens in its drawer to edit, and can be deleted',
  { tag: '@web.planning.edit-assumption' },
  async ({ page, step }) => {
    await step('Turn on Planning, create a plan and add a $1,000 monthly revenue assumption', async () => {
      await createFirstPlan(page);
      await addMonthlyAssumption(page, { category: 'Revenue', label: 'Retainer income', amount: '1000' });
      await expect(main(page).getByText('Ending: $12,000', { exact: true })).toBeVisible();
    });

    await step('Open the assumption and change its amount to $500', async () => {
      await main(page).getByText('Retainer income').click();
      const drawer = page.getByRole('dialog').filter({ hasText: 'Edit Assumption' });
      await expect(drawer.getByPlaceholder('0.00')).toHaveValue('1000');
      await drawer.getByPlaceholder('0.00').fill('500');
      await drawer.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(drawer).toBeHidden();
      await expect(main(page).getByText('Ending: $6,000', { exact: true })).toBeVisible();
    });

    await step('Open it again and delete it', async () => {
      await main(page).getByText('Retainer income').click();
      const drawer = page.getByRole('dialog').filter({ hasText: 'Edit Assumption' });
      page.once('dialog', (dialog) => void dialog.accept());
      await drawer.getByRole('button', { name: 'Delete', exact: true }).click();
      await expect(drawer).toBeHidden();
      await expect(main(page).getByText('Retainer income')).toHaveCount(0);
      await expect(main(page).getByText('Ending: $0', { exact: true })).toBeVisible();
    });
  },
);

test(
  'Export downloads the projections and the assumptions as CSV',
  { tag: '@web.planning.export' },
  async ({ page, step }) => {
    await step('Turn on Planning, create a plan and add a $1,000 monthly revenue assumption', async () => {
      await createFirstPlan(page);
      await addMonthlyAssumption(page, { category: 'Revenue', label: 'Retainer income', amount: '1000' });
      await expect(main(page).getByText('Ending: $12,000', { exact: true })).toBeVisible();
    });

    await step('Export › Projections (CSV)', async () => {
      await main(page).getByRole('button', { name: 'Export', exact: true }).click();
      const downloading = page.waitForEvent('download');
      await main(page).getByRole('button', { name: 'Projections (CSV)' }).click();
      const download = await downloading;
      expect(download.suggestedFilename()).toMatch(/^My_Plan_\d{4}-\d{2}-\d{2}\.csv$/);
      const rows = fs.readFileSync(await download.path(), 'utf8').replace(/^\uFEFF/, '').split('\n');
      expect(rows[0]).toBe('"Month","Opening Cash","Cash In","Cash Out","Net Flow","Closing Cash","Confidence %"');
      expect(rows).toHaveLength(13);
      expect(rows[1]).toContain('"0.00 USD","1000.00 USD","0.00 USD","1000.00 USD","1000.00 USD"');
      expect(rows[12]).toContain('"11000.00 USD","1000.00 USD","0.00 USD","1000.00 USD","12000.00 USD"');
    });

    await step('Export › Assumptions (CSV)', async () => {
      await main(page).getByRole('button', { name: 'Export', exact: true }).click();
      const downloading = page.waitForEvent('download');
      await main(page).getByRole('button', { name: 'Assumptions (CSV)' }).click();
      const download = await downloading;
      expect(download.suggestedFilename()).toMatch(/^My_Plan_assumptions_\d{4}-\d{2}-\d{2}\.csv$/);
      const rows = fs.readFileSync(await download.path(), 'utf8').replace(/^\uFEFF/, '').split('\n');
      expect(rows[0]).toBe('"Category","Type","Label","Amount","Start Month","End Month","Frequency","Confidence","Notes"');
      expect(rows[1]).toMatch(/^"revenue","recurring","Retainer income","1000\.00 USD","\d{4}-\d{2}","","monthly","likely",""$/);
    });
  },
);

// Product bug: exportPlan.ts multiplies confidenceScore by 100, but planCalculationService already
// returns it as a percentage (75 for "Likely"), so the column reads "7500%". Marked manual in
// planning.yaml; test.fail keeps the run green until the fix lands, then flags this to be unmarked.
test(
  "the projections export's Confidence % column reads the assumption's confidence, 75% for Likely",
  { tag: '@web.planning.export-confidence' },
  async ({ page, step }) => {
    test.fail(true, 'exportPlan.ts scales confidenceScore by 100 twice: Likely exports as 7500%');

    await step('Turn on Planning, create a plan and add a Likely $1,000 monthly revenue assumption', async () => {
      await createFirstPlan(page);
      await addMonthlyAssumption(page, { category: 'Revenue', label: 'Retainer income', amount: '1000' });
      await expect(main(page).getByText('Ending: $12,000', { exact: true })).toBeVisible();
    });

    await step('Export › Projections (CSV) and read the Confidence % column', async () => {
      await main(page).getByRole('button', { name: 'Export', exact: true }).click();
      const downloading = page.waitForEvent('download');
      await main(page).getByRole('button', { name: 'Projections (CSV)' }).click();
      const rows = fs.readFileSync(await (await downloading).path(), 'utf8').replace(/^\uFEFF/, '').split('\n');
      for (const row of rows.slice(1)) expect(row.split(',').at(-1)).toBe('"75%"');
    });
  },
);
