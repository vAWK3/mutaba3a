import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { enableOptionalArea, openFreshApp } from '../../support/app';

// Expenses is an optional area (ADR-032): every test turns it on in Settings first.

/** Turns Expenses on in Settings → Advanced features and opens it from the sidebar. */
async function turnOnExpenses(page: Page): Promise<void> {
  await openFreshApp(page, '/settings');
  await enableOptionalArea(page, 'Expenses');
  await page.getByRole('navigation').getByRole('link', { name: 'Expenses', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/expenses$/);
}

/** Opens a new expense from the top bar's "+ Add" menu. */
async function openNewExpenseDrawer(page: Page): Promise<Locator> {
  await page.getByRole('main').getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Expense' }).click();
  const drawer = page.getByRole('dialog').filter({ hasText: /New (Recurring )?Expense/ });
  await expect(drawer).toBeVisible();
  return drawer;
}

/** Category options appear once the business's default categories are seeded on first open. */
async function pickCategory(drawer: Locator, name: string): Promise<void> {
  const category = drawer.getByLabel(/^Category/);
  await expect(category.getByRole('option', { name })).toHaveCount(1);
  await category.selectOption({ label: name });
}

async function logExpense(page: Page, entry: { amount: string; title: string; category: string }): Promise<void> {
  const drawer = await openNewExpenseDrawer(page);
  await drawer.getByLabel(/^Amount/).fill(entry.amount);
  await drawer.getByLabel('Title').fill(entry.title);
  await pickCategory(drawer, entry.category);
  await drawer.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(drawer).toBeHidden();
}

/**
 * Adds a monthly recurring expense through the drawer, starting on `startDate` with no end.
 * The drawer's Start Date / End Mode labels are not tied to their inputs, so they are found by
 * their input type and their options.
 */
async function addRecurringExpense(page: Page, rule: { title: string; amount: string; startDate: string }): Promise<void> {
  const drawer = await openNewExpenseDrawer(page);
  await drawer.getByRole('button', { name: /^Recurring/ }).click();
  await expect(page.getByRole('dialog').filter({ hasText: 'New Recurring Expense' })).toBeVisible();
  await drawer.getByLabel(/^Amount/).fill(rule.amount);
  await drawer.locator('input[type="date"]').fill(rule.startDate);
  await drawer.locator('select', { has: page.locator('option', { hasText: 'No End' }) }).selectOption({ label: 'No End' });
  await drawer.getByLabel(/^Title/).fill(rule.title);
  await pickCategory(drawer, 'Cloud & Hosting');
  await drawer.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(drawer).toBeHidden();
}

/** The 1st of the month `monthsAgo` months before this one, as YYYY-MM-DD (local). */
function firstOfMonthAgo(monthsAgo: number): string {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
}

/** "August 2026", as the mark-paid drawer names a month (en-US). */
function monthName(isoDate: string): string {
  const [year, month] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function needsAttention(page: Page): Locator {
  return page.getByRole('region', { name: 'Needs Attention' });
}

function expenseRow(page: Page, title: string): Locator {
  return page.getByRole('row').filter({ hasText: title });
}

test(
  'log two expenses from the same vendor; the second reuses the vendor',
  { tag: '@web.expenses.log-expense' },
  async ({ page, step }) => {
    await step('Turn on Expenses in Settings → Advanced features and open Expenses', async () => {
      await turnOnExpenses(page);
      await expect(page.getByText('No expenses found')).toBeVisible();
    });

    await step('Click Add Expense, fill amount, title, a new vendor and a category, save', async () => {
      await page.getByRole('main').getByRole('button', { name: 'Add Expense' }).click();
      const drawer = page.getByRole('dialog').filter({ hasText: 'New Expense' });
      await expect(drawer).toBeVisible();
      await drawer.getByLabel(/^Amount/).fill('42.50');
      await drawer.getByLabel('Title').fill('Server rental');

      const vendor = drawer.getByPlaceholder('Business or vendor name...');
      await vendor.click();
      await vendor.pressSequentially('Hetzner Online GmbH');
      await expect(drawer.getByRole('option', { name: /Create new.*Hetzner Online GmbH/ })).toBeVisible();
      await page.keyboard.press('Enter');
      // Saved under its canonical name, the company suffix dropped
      await expect(vendor).toHaveValue('Hetzner Online');
      await expect(vendor).not.toHaveAttribute('aria-busy', 'true');

      await pickCategory(drawer, 'Cloud & Hosting');
      await drawer.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(drawer).toBeHidden();
      await expect(expenseRow(page, 'Server rental')).toContainText('$42.5');
    });

    await step('Open a new expense and type the same vendor in lower case', async () => {
      const drawer = await openNewExpenseDrawer(page);
      await drawer.getByLabel(/^Amount/).fill('7.50');
      await drawer.getByLabel('Title').fill('Backup storage');

      const vendor = drawer.getByPlaceholder('Business or vendor name...');
      await vendor.click();
      await vendor.pressSequentially('hetzner online gmbh');
      // Same vendor once normalised: offered as is, with no "Create new"
      await expect(drawer.getByRole('option', { name: 'Hetzner Online', exact: true })).toBeVisible();
      await expect(drawer.getByRole('option', { name: /Create new/ })).toHaveCount(0);

      await step('Pick the existing vendor, choose a category and save', async () => {
        await page.keyboard.press('Enter');
        await expect(vendor).toHaveValue('Hetzner Online');
        await pickCategory(drawer, 'Software & Subscriptions');
        await drawer.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(drawer).toBeHidden();
      });
    });

    await step('See both expenses in the ledger and the total', async () => {
      await expect(expenseRow(page, 'Server rental')).toContainText('Cloud & Hosting');
      await expect(expenseRow(page, 'Backup storage')).toContainText('Software & Subscriptions');
      await expect(expenseRow(page, 'Backup storage')).toContainText('$7.5');
      await expect(page.getByRole('main').getByText('$50', { exact: true })).toBeVisible();
    });

    await step('Open the second expense: its vendor is the saved one', async () => {
      await expenseRow(page, 'Backup storage').click();
      const drawer = page.getByRole('dialog').filter({ hasText: 'Edit Expense' });
      await expect(drawer.getByPlaceholder('Business or vendor name...')).toHaveValue('Hetzner Online');
      await drawer.getByRole('button', { name: 'Cancel' }).click();
      await expect(drawer).toBeHidden();
    });

    await step('Switch to the By Category view', async () => {
      await page.getByRole('tab', { name: 'By Category' }).click();
      const groups = page.getByTestId('category-group');
      await expect(groups).toHaveCount(2);
      await expect(groups.filter({ hasText: 'Cloud & Hosting' })).toContainText('Server rental');
      await expect(groups.filter({ hasText: 'Software & Subscriptions' })).toContainText('Backup storage');
    });
  },
);

test(
  'edit an expense from its row, then delete it from the drawer',
  { tag: '@web.expenses.edit-delete' },
  async ({ page, step }) => {
    await step('Turn on Expenses and log one expense', async () => {
      await turnOnExpenses(page);
      await logExpense(page, { amount: '25', title: 'Domain renewal', category: 'Cloud & Hosting' });
      await expect(expenseRow(page, 'Domain renewal')).toContainText('$25');
    });

    await step('Click its row, change the amount to 30 and save', async () => {
      await expenseRow(page, 'Domain renewal').click();
      const drawer = page.getByRole('dialog').filter({ hasText: 'Edit Expense' });
      await expect(drawer).toBeVisible();
      await expect(drawer.getByLabel('Title')).toHaveValue('Domain renewal');
      await expect(drawer.getByLabel(/^Amount/)).toHaveValue('25');
      await drawer.getByLabel(/^Amount/).fill('30');
      await drawer.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(drawer).toBeHidden();
      await expect(expenseRow(page, 'Domain renewal')).toContainText('$30');
    });

    await step('Click the row again, Delete, and confirm', async () => {
      await expenseRow(page, 'Domain renewal').click();
      const drawer = page.getByRole('dialog').filter({ hasText: 'Edit Expense' });
      page.once('dialog', (dialog) => void dialog.accept());
      await drawer.getByRole('button', { name: 'Delete', exact: true }).click();
      await expect(drawer).toBeHidden();
      await expect(page.getByText('Expense deleted successfully')).toBeVisible();
      await expect(page.getByText('No expenses found')).toBeVisible();
    });
  },
);

test(
  'a recurring expense with missed months shows in Needs Attention and Mark paid records each month',
  { tag: '@web.expenses.recurring-mark-paid' },
  async ({ page, step }) => {
    const start = firstOfMonthAgo(2);

    await step('Turn on Expenses and add a monthly recurring expense from the 1st two months ago', async () => {
      await turnOnExpenses(page);
      await addRecurringExpense(page, { title: 'Server hosting', amount: '80', startDate: start });
    });

    const row = needsAttention(page).getByRole('listitem').filter({ hasText: 'Server hosting' });
    await step('See one Needs Attention row for the rule: three months, $240', async () => {
      await expect(needsAttention(page)).toBeVisible();
      await expect(page.getByTestId('recurring-attention-count')).toHaveText('1');
      await expect(row).toContainText(/\$80\W*monthly/); // the amount is bidi-isolated
      await expect(row).toContainText('not marked');
      await expect(row.getByTestId('recurring-attention-amount')).toHaveText('$240');
    });

    await step('Click Mark Paid: the drawer lists the three missed months, all checked', async () => {
      await row.getByRole('button', { name: 'Mark Paid' }).click();
      const drawer = page.getByRole('dialog').filter({ hasText: 'Server hosting' });
      await expect(drawer).toBeVisible();
      for (const monthsAgo of [2, 1, 0]) {
        await expect(drawer.getByRole('checkbox', { name: new RegExp(monthName(firstOfMonthAgo(monthsAgo))) })).toBeChecked();
      }

      await step('Mark 3 paid', async () => {
        await drawer.getByRole('button', { name: 'Mark 3 paid' }).click();
        await expect(drawer).toBeHidden();
      });
    });

    await step("Needs Attention is gone and this month's payment is in the ledger, badged Recurring", async () => {
      await expect(needsAttention(page)).toBeHidden();
      const paid = expenseRow(page, 'Server hosting');
      await expect(paid).toHaveCount(1);
      await expect(paid).toContainText('Recurring');
      await expect(paid).toContainText('$80');
    });
  },
);

test(
  'skip one missed month and snooze the other; the snoozed one moves to Upcoming Expenses',
  { tag: '@web.expenses.recurring-skip-snooze' },
  async ({ page, step }) => {
    const lastMonth = monthName(firstOfMonthAgo(1));
    const thisMonth = monthName(firstOfMonthAgo(0));

    await step('Turn on Expenses and add a monthly recurring expense from the 1st of last month', async () => {
      await turnOnExpenses(page);
      await addRecurringExpense(page, { title: 'Design tool seat', amount: '15', startDate: firstOfMonthAgo(1) });
    });

    const drawer = page.getByRole('dialog').filter({ hasText: 'Design tool seat' });
    await step('Open Mark Paid on its Needs Attention row', async () => {
      const row = needsAttention(page).getByRole('listitem').filter({ hasText: 'Design tool seat' });
      await expect(row.getByTestId('recurring-attention-amount')).toHaveText('$30');
      await row.getByRole('button', { name: 'Mark Paid' }).click();
      await expect(drawer).toBeVisible();
    });

    await step(`Skip ${lastMonth} and confirm`, async () => {
      page.once('dialog', (dialog) => void dialog.accept());
      await drawer.getByRole('button', { name: `Skip ${lastMonth}` }).click();
      await expect(drawer.getByRole('checkbox', { name: new RegExp(lastMonth) })).toHaveCount(0);
      await expect(drawer.getByRole('checkbox', { name: new RegExp(thisMonth) })).toBeVisible();
    });

    await step(`Snooze ${thisMonth} by 7 days`, async () => {
      await drawer.getByRole('button', { name: `Snooze ${thisMonth}` }).click();
      await drawer.getByRole('group', { name: 'Quick picks' }).getByRole('button', { name: 'in 7 days' }).click();
      await drawer.getByRole('button', { name: 'Snooze', exact: true }).click();
      await expect(drawer).toBeHidden();
    });

    await step('Needs Attention is gone; expand Upcoming Expenses', async () => {
      await expect(needsAttention(page)).toBeHidden();
      await page.getByRole('button', { name: /Upcoming Expenses \(1\)/ }).click();
      // One "Design tool seat" once the closed drawer's exit copy has slid away: the forecast card
      const title = page.getByText('Design tool seat', { exact: true });
      await expect(title).toHaveCount(1);
      await expect(title).toBeVisible();
      await expect(page.getByText(/^Snoozed until /)).toBeVisible();
    });
  },
);

// A full backup (src/db/backup.ts) from before MUT-14, when an expense was a kind:'expense'
// row in db.transactions. Nothing in today's app can create such a row; restoring one can.
function legacyBackup(): string {
  const now = new Date().toISOString();
  const profileId = 'qa-legacy-profile';
  return JSON.stringify({
    version: 19,
    timestamp: now,
    tables: {
      businessProfiles: [
        { id: profileId, name: 'Legacy Studio', defaultCurrency: 'USD', isDefault: true, createdAt: now, updatedAt: now },
      ],
      clients: [{ id: 'qa-legacy-client', name: 'Old Client', profileId, createdAt: now, updatedAt: now }],
      projects: [
        { id: 'qa-legacy-project', name: 'Website rebuild', clientId: 'qa-legacy-client', profileId, createdAt: now, updatedAt: now },
      ],
      categories: [{ id: 'qa-legacy-cat', kind: 'expense', name: 'Hosting' }],
      transactions: [
        {
          id: 'qa-legacy-expense',
          kind: 'expense',
          status: 'paid',
          title: 'Staging server',
          clientId: 'qa-legacy-client',
          projectId: 'qa-legacy-project',
          categoryId: 'qa-legacy-cat',
          amountMinor: 4500,
          currency: 'USD',
          occurredAt: now.slice(0, 10),
          paidAt: now,
          profileId,
          createdAt: now,
          updatedAt: now,
        },
      ],
    },
  });
}

test(
  'an expense restored from a pre-MUT-14 backup opens in the legacy expense drawer and saves',
  { tag: '@web.expenses.legacy-edit' },
  async ({ page, step }) => {
    await step('Restore a backup holding a project with an old expense', async () => {
      await openFreshApp(page, '/settings');
      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: 'Restore…' }).click();
      await (await chooser).setFiles({
        name: 'mutaba3a-backup-2025.json',
        mimeType: 'application/json',
        buffer: Buffer.from(legacyBackup()),
      });
      const confirm = page.getByRole('dialog', { name: 'Replace everything with this backup?' });
      await confirm.getByRole('button', { name: 'Replace everything' }).click();
      // The app reloads onto the restored data; its project turns Projects on (MUT-12)
      await expect(page.getByRole('navigation').getByRole('link', { name: 'Projects', exact: true })).toBeVisible();
    });

    await step('Open the project and its Transactions tab', async () => {
      await page.goto('/app/projects/qa-legacy-project');
      await page.getByRole('button', { name: 'Transactions', exact: true }).click();
      await expect(page.getByRole('row').filter({ hasText: 'Staging server' })).toContainText('$45');
    });

    await step('Click the expense row: the Edit Expense drawer opens filled', async () => {
      await page.getByRole('row').filter({ hasText: 'Staging server' }).click();
      const drawer = page.getByRole('dialog').filter({ hasText: 'Edit Expense' });
      await expect(drawer).toBeVisible();
      await expect(drawer.getByLabel('Title')).toHaveValue('Staging server');
      await expect(drawer.getByLabel(/^Amount/)).toHaveValue('45');
      await expect(drawer.getByLabel('Project')).toHaveValue('qa-legacy-project');

      await step('Change the amount to 52 and save', async () => {
        await drawer.getByLabel(/^Amount/).fill('52');
        await drawer.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(drawer).toBeHidden();
      });
    });

    await step("The project's Transactions tab shows the new amount", async () => {
      await expect(page.getByRole('row').filter({ hasText: 'Staging server' })).toContainText('$52');
    });
  },
);
