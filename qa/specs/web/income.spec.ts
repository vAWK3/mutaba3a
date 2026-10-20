import { test, expect } from '../../support/qa';
import { logIncome, openFreshApp, openNewIncomeDrawer } from '../../support/app';
import { expectOnlyKnownAxeViolations } from '../../support/axe';
import { traceIconScale, readIconScale } from '../../support/motion';

// MUT-5: logging work is title, Tab, amount, Tab, client, Enter, keyboard only.
test(
  'title, Tab, amount, Tab, client, Enter saves',
  { tag: '@web.income.fast-path' },
  async ({ page, step }) => {
    let drawer = page.locator('[role="dialog"]');

    await step('Open a fresh install at /income', async () => {
      await openFreshApp(page, '/income');
    });

    await step('Click Add Income', async () => {
      await page.getByRole('button', { name: 'Add Income' }).click();
      drawer = page.getByRole('dialog').filter({ hasText: 'New Income' });
      await expect(drawer).toBeVisible();
    });

    await step("Type a title, Tab, amount, Tab, a new client's name, Enter, Enter", async () => {
      const title = drawer.getByLabel('What did you do?');
      await expect(title).toBeFocused();
      await page.keyboard.type('Logo redesign');

      await page.keyboard.press('Tab');
      await expect(drawer.getByLabel(/^Amount/)).toBeFocused();
      await page.keyboard.type('1,200');

      await page.keyboard.press('Tab');
      const client = drawer.getByPlaceholder('Search or create client...');
      await expect(client).toBeFocused();
      await page.keyboard.type('Acme Studio');

      // The only option is "create Acme Studio", already highlighted: Enter picks
      // it. While the new client is being saved the field is busy and holds
      // Enter; once it exists the list is closed and the next Enter saves.
      await page.keyboard.press('Enter');
      await expect(client).toHaveValue('Acme Studio');
      await expect(client).not.toHaveAttribute('aria-busy', 'true');
      await page.keyboard.press('Enter');
      await expect(drawer).toBeHidden();
    });

    await step("See the entry on the new client's profile", async () => {
      await page.goto('/app/clients');
      await page.getByRole('link', { name: 'Acme Studio' }).first().click();
      // Read the amount off the entry's own row: on a wide window the profile opens
      // beside the list (MUT-84), whose Owed now strip is hidden but still in the DOM.
      const entry = page.getByRole('row', { name: /Logo redesign/ });
      await expect(entry).toBeVisible();
      await expect(entry.getByText('$1,200', { exact: true }).first()).toBeVisible();
    });
  },
);

test('an amount alone saves an unpaid entry', { tag: '@web.income.create-minimal' }, async ({ page, step }) => {
  await step('Open a fresh install at /income', async () => {
    await openFreshApp(page, '/income');
  });

  let row = page.locator('tr');
  await step('Open the New Income drawer, fill only the amount, and save', async () => {
    const drawer = await openNewIncomeDrawer(page);
    await drawer.getByLabel(/^Amount/).fill('150');
    await drawer.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(drawer).toBeHidden();

    row = page.getByRole('row').filter({ hasText: '$150' });
    await expect(row).toContainText('No client');
    await expect(row).toContainText('Unpaid');
  });

  await step('Check accessibility', async () => {
    await expectOnlyKnownAxeViolations(page, 'income');
  });
});

test(
  'saving with no amount shows a field error, not a crash',
  { tag: '@web.income.validation' },
  async ({ page, step }) => {
    await openFreshApp(page, '/income');

    await step('Open the New Income drawer and save with every field empty', async () => {
      const drawer = await openNewIncomeDrawer(page);
      await drawer.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(drawer.getByText('Amount is required')).toBeVisible();
      await expect(drawer).toBeVisible();
    });
  },
);

test(
  'Due Date shows for Earned/Invoiced income and hides once Received',
  { tag: '@web.income.status-due-date' },
  async ({ page, step }) => {
    await openFreshApp(page, '/income');
    const drawer = await openNewIncomeDrawer(page);

    await step('Expand More details', async () => {
      await drawer.getByRole('button', { name: 'More details' }).click();
    });

    const status = drawer.getByRole('group', { name: 'Status' });
    const dueDate = drawer.getByLabel('Due Date');

    await step('Switch Status between Earned, Received and Invoiced', async () => {
      await expect(status.getByRole('button', { name: /^Earned/ })).toHaveAttribute('aria-pressed', 'true');
      await expect(dueDate).toBeVisible();

      await status.getByRole('button', { name: /^Received/ }).click();
      await expect(dueDate).toBeHidden();

      await status.getByRole('button', { name: /^Invoiced/ }).click();
      await expect(dueDate).toBeVisible();
    });

    await step('Check accessibility', async () => {
      await expectOnlyKnownAxeViolations(page, 'incomeDrawer', '[role="dialog"]');
    });
  },
);

test(
  'in Arabic the amount input stays left-to-right, currency first',
  { tag: '@web.income.rtl-amount' },
  async ({ page, step }) => {
    await step('Switch language to Arabic in Settings', async () => {
      await openFreshApp(page, '/settings');
      await page.getByRole('radio', { name: 'العربية' }).click();
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    });

    await step('Open the New Income drawer', async () => {
      await page.goto('/app/income');
      await page.getByRole('button', { name: 'إضافة إيراد' }).click();
      const drawer = page.getByRole('dialog').filter({ hasText: 'إيراد جديد' });
      await drawer.getByLabel('ماذا أنجزت؟').fill('هوية بصرية');

      // theme.css sets :lang(ar) { direction: rtl } on every element; the group must win
      const group = drawer.getByTestId('income-amount-group');
      await expect(group).toHaveCSS('direction', 'ltr');
      await expect(group.locator('input')).toHaveCSS('direction', 'ltr');
      const prefix = await group.locator('.input-prefix').boundingBox();
      const input = await group.locator('input').boundingBox();
      expect(prefix && input && prefix.x < input.x).toBe(true);
    });
  },
);

test(
  'a successful save shows the animated save-feedback icon in its toast',
  { tag: '@web.income.save-feedback-animation' },
  async ({ page, step }) => {
    await step('Open a fresh install at /income', async () => {
      await openFreshApp(page, '/income');
    });

    await step('Log an income entry for a new client', async () => {
      await traceIconScale(page);
      await logIncome(page, { title: 'Logo redesign', amount: '100', client: 'Acme Studio' });
    });

    await expect(page.locator('.toast-icon [data-part]').first()).toBeVisible();
    // The local app has no firm profiles, so it is always the playful pop: it overshoots, then settles
    await expect.poll(async () => (await readIconScale(page)).last).toBe(1);
    const trace = await readIconScale(page);
    expect(trace.min).toBeLessThan(0.5);
    expect(trace.max).toBeGreaterThan(1.02);
  },
);
