import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { openFreshApp, openNewIncomeDrawer, logIncome, enableOptionalArea } from '../../support/app';

/**
 * Retainers (MUT-12 optional area): recurring agreements whose schedule of
 * payment periods is projected ahead, and matched against received income.
 * The area is off on a fresh install, so every test switches it on first.
 */

/** A local YYYY-MM-DD for the `day` of the month `offset` months from this one (0 = the last day of the month before). */
function localMonthDay(offset: number, day: number): string {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() + offset, day);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${String(date.getDate()).padStart(2, '0')}`;
}

// Starts on the 1st of last month, pays on the 1st, ends with next month: two
// periods already due (last month's and this month's) and one upcoming.
const START_DATE = localMonthDay(-1, 1);
const END_DATE = localMonthDay(2, 0);

/** The drawer's unlabelled <select> that offers this option. */
function selectWithOption(page: Page, drawer: Locator, option: string): Locator {
  return drawer.getByRole('combobox').filter({ has: page.getByRole('option', { name: option, exact: true }) });
}

async function openRetainers(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Retainers', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/retainers$/);
}

/** Fills and saves the New Retainer drawer for an existing client; returns the retainer's title. */
async function createRetainer(page: Page, client: string, amount: string): Promise<string> {
  await page.getByRole('button', { name: /New Retainer/ }).click();
  const drawer = page.getByRole('dialog').filter({ hasText: 'New Retainer' });
  await expect(drawer).toBeVisible();

  await selectWithOption(page, drawer, 'Select client...').selectOption({ label: client });
  const title = `${client} retainer`;
  await expect(drawer.getByPlaceholder('e.g. Monthly retainer')).toHaveValue(title);
  await drawer.getByPlaceholder('0.00').fill(amount);
  await selectWithOption(page, drawer, '28').selectOption('1');
  await drawer.locator('input[type="date"]').first().fill(START_DATE);
  await drawer.locator('input[type="date"]').nth(1).fill(END_DATE);

  await drawer.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(drawer).toBeHidden();
  return title;
}

/** Logs an entry already received (paid today) for a new client. */
async function logReceivedIncome(page: Page, entry: { title: string; amount: string; client: string }): Promise<void> {
  const drawer = await openNewIncomeDrawer(page);
  await drawer.getByLabel('What did you do?').fill(entry.title);
  await drawer.getByLabel(/^Amount/).fill(entry.amount);
  const client = drawer.getByPlaceholder('Search or create client...');
  await client.click();
  await client.pressSequentially(entry.client);
  await page.keyboard.press('Enter');
  await expect(client).toHaveValue(entry.client);
  await expect(client).not.toHaveAttribute('aria-busy', 'true');
  await drawer.getByRole('button', { name: 'More details' }).click();
  await drawer.getByRole('group', { name: 'Status' }).getByRole('button', { name: /^Received/ }).click();
  await drawer.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(drawer).toBeHidden();
}

/** The Overview/Schedule panel beside the table, once a row is selected. */
function inspector(page: Page, title: string): Locator {
  return page.locator('aside').filter({ has: page.getByRole('heading', { name: title, level: 3 }) });
}

test(
  'turn on Retainers and create a retainer for a client',
  { tag: '@web.retainers.create' },
  async ({ page, step }) => {
    await step('Open a fresh install and turn on Retainers in Settings', async () => {
      await openFreshApp(page, '/settings');
      await enableOptionalArea(page, 'Retainers');
    });

    await step('Log some work for a new client', async () => {
      await page.goto('/app/income');
      await logIncome(page, { title: 'Discovery call', amount: '300', client: 'Cedar Labs' });
    });

    await step('Open Retainers from the sidebar', async () => {
      await openRetainers(page);
      await expect(page.getByText('No retainers found')).toBeVisible();
    });

    await step('Open New Retainer, pick the client, type an amount', async () => {
      await page.getByRole('button', { name: /New Retainer/ }).click();
      const drawer = page.getByRole('dialog').filter({ hasText: 'New Retainer' });
      await selectWithOption(page, drawer, 'Select client...').selectOption({ label: 'Cedar Labs' });
      await expect(drawer.getByPlaceholder('e.g. Monthly retainer')).toHaveValue('Cedar Labs retainer');
      await expect(drawer.getByText('Enter amount and start date to see schedule')).toBeVisible();
      await drawer.getByPlaceholder('0.00').fill('2000');
    });

    await step('Read the schedule preview, then save', async () => {
      const drawer = page.getByRole('dialog').filter({ hasText: 'New Retainer' });
      await expect(drawer.getByText('Schedule Preview')).toBeVisible();
      await expect(drawer.getByText('$2,000', { exact: true })).toHaveCount(6);
      await expect(drawer.getByText('and more...')).toBeVisible();
      await drawer.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(drawer).toBeHidden();
    });

    await step('See the retainer in the list as a monthly draft', async () => {
      const row = page.getByRole('row', { name: /Cedar Labs retainer/ });
      await expect(row.getByRole('cell')).toHaveText([
        'Draft',
        'Cedar Labs retainer',
        'Cedar Labs',
        '$2,000',
        'Monthly',
        /\S/,
        '-',
      ]);
    });
  },
);

test(
  'activate a retainer and see its schedule of due and upcoming periods',
  { tag: '@web.retainers.schedule' },
  async ({ page, step }) => {
    let title = '';

    await step('Turn on Retainers and log work for a new client', async () => {
      await openFreshApp(page, '/settings');
      await enableOptionalArea(page, 'Retainers');
      await page.goto('/app/income');
      await logIncome(page, { title: 'Kickoff', amount: '100', client: 'Harbor Co' });
    });

    await step('Create a monthly retainer from last month to next month, paid on the 1st', async () => {
      await openRetainers(page);
      title = await createRetainer(page, 'Harbor Co', '1500');
    });

    await step('Select the retainer and activate it', async () => {
      await page.getByRole('row', { name: new RegExp(title) }).click();
      const panel = inspector(page, title);
      await expect(panel.getByText('Draft')).toBeVisible();
      await panel.getByRole('button', { name: 'Activate' }).click();
      await expect(panel.getByRole('button', { name: 'Pause' })).toBeVisible();
    });

    await step('Read the schedule: two periods due, one upcoming', async () => {
      const panel = inspector(page, title);
      await expect(panel.getByText('Due', { exact: true })).toHaveCount(2);
      await expect(panel.getByText('Upcoming', { exact: true })).toHaveCount(1);
      await expect(panel.getByText('$1,500', { exact: true })).toHaveCount(4); // the overview's amount + three periods

      const row = page.getByRole('row', { name: new RegExp(title) });
      await expect(row.getByRole('cell').first()).toHaveText('Active');
      await expect(row.getByRole('cell').last()).toHaveText('$3,000');
    });
  },
);

test(
  'match a received payment to a retainer period',
  { tag: '@web.retainers.match-payment' },
  async ({ page, step }) => {
    let title = '';

    await step('Turn on Retainers and log a received payment from a new client', async () => {
      await openFreshApp(page, '/settings');
      await enableOptionalArea(page, 'Retainers');
      await page.goto('/app/income');
      await logReceivedIncome(page, { title: 'September retainer payment', amount: '1200', client: 'Olive Studio' });
    });

    await step('Create and activate a retainer for the same client', async () => {
      await openRetainers(page);
      title = await createRetainer(page, 'Olive Studio', '1200');
      await page.getByRole('row', { name: new RegExp(title) }).click();
      await inspector(page, title).getByRole('button', { name: 'Activate' }).click();
      await expect(page.getByRole('row', { name: new RegExp(title) }).getByRole('cell').last()).toHaveText('$2,400');
    });

    const drawer = page.getByRole('dialog').filter({ hasText: /Select Transaction|Select Payment Period|Confirm Match|Payment Matched!/ });

    await step('Click Match Payment and pick the received payment', async () => {
      await page.getByRole('button', { name: 'Match Payment' }).click();
      await expect(drawer.getByText('Choose an income transaction to match with a retainer payment')).toBeVisible();
      await drawer.getByRole('button', { name: /September retainer payment/ }).click();
    });

    await step('Pick a due period of the retainer', async () => {
      await expect(drawer.getByText('Choose the payment period to link this transaction to')).toBeVisible();
      await drawer.getByRole('button', { name: new RegExp(`${title}.*Olive Studio`) }).first().click();
    });

    await step('Confirm the match', async () => {
      await expect(drawer.getByRole('heading', { name: 'Confirm Match', level: 4 })).toBeVisible();
      await drawer.getByRole('button', { name: 'Confirm Match' }).click();
      await expect(drawer.getByText('Transaction linked to retainer period successfully')).toBeVisible();
      await expect(page.getByText('Payment matched successfully')).toBeVisible();
      await expect(drawer).toBeHidden();
    });

    await step('See the period received and less due now', async () => {
      const panel = inspector(page, title);
      await expect(panel.getByText('Received', { exact: true })).toHaveCount(1);
      await expect(panel.getByText('Due', { exact: true })).toHaveCount(1);
      await expect(page.getByRole('row', { name: new RegExp(title) }).getByRole('cell').last()).toHaveText('$1,200');
    });
  },
);

test(
  'pause, resume and end a retainer, then archive it',
  { tag: '@web.retainers.lifecycle' },
  async ({ page, step }) => {
    let title = '';
    const accept = () => page.once('dialog', (dialog) => void dialog.accept());

    await step('Turn on Retainers, log work for a new client and create an active retainer', async () => {
      await openFreshApp(page, '/settings');
      await enableOptionalArea(page, 'Retainers');
      await page.goto('/app/income');
      await logIncome(page, { title: 'Audit', amount: '200', client: 'Pine Partners' });
      await openRetainers(page);
      title = await createRetainer(page, 'Pine Partners', '900');
      await page.getByRole('row', { name: new RegExp(title) }).click();
      await inspector(page, title).getByRole('button', { name: 'Activate' }).click();
    });

    const panel = inspector(page, title);
    const status = page.getByRole('row', { name: new RegExp(title) }).getByRole('cell').first();

    await step('Pause it and confirm', async () => {
      accept();
      await panel.getByRole('button', { name: 'Pause' }).click();
      await expect(status).toHaveText('Paused');
      await expect(panel.getByText('Canceled', { exact: true })).toHaveCount(1); // the upcoming period
    });

    await step('Resume it', async () => {
      await panel.getByRole('button', { name: 'Resume' }).click();
      await expect(status).toHaveText('Active');
    });

    await step('End it and confirm', async () => {
      accept();
      await panel.getByRole('button', { name: 'End' }).click();
      await expect(status).toHaveText('Ended');
      await expect(panel.getByRole('button', { name: 'Pause' })).toHaveCount(0);
    });

    await step('Edit it and archive it', async () => {
      await panel.getByRole('button', { name: 'Edit' }).click();
      const drawer = page.getByRole('dialog').filter({ hasText: 'Edit Retainer' });
      await expect(drawer.getByPlaceholder('e.g. Monthly retainer')).toHaveValue(title);
      accept();
      await drawer.getByRole('button', { name: 'Archive' }).click();
      await expect(drawer).toBeHidden();
      await expect(page.getByRole('row', { name: new RegExp(title) })).toHaveCount(0);
      await expect(page.getByText('No retainers found')).toBeVisible();
    });
  },
);
