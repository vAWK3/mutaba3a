import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { openFreshApp, logIncome } from '../../support/app';
import { expectOnlyKnownAxeViolations } from '../../support/axe';

// MUT-86 (decision P1): "Paid? Two taps." The row's Record Payment button opens
// PartialPaymentDrawer with the full remaining balance prefilled.
function entryRow(page: Page): Locator {
  return page.getByRole('row').filter({ hasText: 'Acme Studio' });
}

async function openPaymentDrawer(page: Page): Promise<Locator> {
  await entryRow(page).getByRole('button', { name: /^Record Payment/ }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('heading', { level: 2 })).toContainText('$1,200');
  await expect(drawer.getByLabel('Payment amount')).toHaveValue('1200');
  await expect(drawer.getByText('Paid in full')).toBeVisible();
  return drawer;
}

test(
  'Record Payment on an unpaid row settles it in full in two clicks',
  { tag: '@web.record-payment.full-settle' },
  async ({ page, step }) => {
    await openFreshApp(page, '/income');
    await logIncome(page, { title: 'Logo redesign', amount: '1200', client: 'Acme Studio' });

    const drawer = await step('Click the row\'s Record Payment button', () => openPaymentDrawer(page));

    await step('Click Record Payment in the drawer', async () => {
      await drawer.getByRole('button', { name: 'Record Payment', exact: true }).click();
      await expect(drawer).toBeHidden();
      await expect(entryRow(page).getByRole('button', { name: /^Record Payment/ })).toHaveCount(0);
    });
  },
);

test(
  'Enter in the focused payment-amount field records it',
  { tag: '@web.record-payment.enter-submits' },
  async ({ page, step }) => {
    await openFreshApp(page, '/income');
    await logIncome(page, { title: 'Logo redesign', amount: '1200', client: 'Acme Studio' });
    const drawer = await openPaymentDrawer(page);

    await step('Press Enter with the prefilled amount focused', async () => {
      await expect(drawer.getByLabel('Payment amount')).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(drawer).toBeHidden();
      await expect(entryRow(page).getByRole('button', { name: /^Record Payment/ })).toHaveCount(0);
    });
  },
);

test(
  'a partial amount leaves the rest owed, visible on the row',
  { tag: '@web.record-payment.partial' },
  async ({ page, step }) => {
    await openFreshApp(page, '/income');
    await logIncome(page, { title: 'Logo redesign', amount: '1200', client: 'Acme Studio' });
    const drawer = await openPaymentDrawer(page);

    await step('Replace the amount with less than the full balance, then Record Payment', async () => {
      // The prefill is selected, so typing replaces it
      await page.keyboard.type('200');
      // The amount sits in bidi isolates inside the sentence
      await expect(drawer.getByText(/\$1,000\W* still owed/)).toBeVisible();
      await drawer.getByRole('button', { name: 'Record Payment', exact: true }).click();
      await expect(drawer).toBeHidden();
      await expect(entryRow(page).getByRole('button', { name: /^Record Payment/ })).toContainText('$1,000');
    });
  },
);

test(
  'the drawer has no new accessibility violations with the date and note fields open',
  { tag: '@web.record-payment.axe-expanded' },
  async ({ page, step }) => {
    await openFreshApp(page, '/income');
    await logIncome(page, { title: 'Logo redesign', amount: '1200', client: 'Acme Studio' });
    const drawer = await openPaymentDrawer(page);

    await step('Open the Payment date field and the Add note field', async () => {
      await drawer.getByRole('button', { name: /Payment date/ }).click();
      await drawer.getByRole('button', { name: 'Add note' }).click();
      await expect(drawer.getByLabel('Notes')).toBeFocused();
    });

    await step('Check accessibility', async () => {
      await expectOnlyKnownAxeViolations(page, 'paymentDrawer', '[role="dialog"]');
    });
  },
);
