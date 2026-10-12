import { test, expect, type Locator, type Page } from '@playwright/test';
import { logIncome, openFreshApp } from './support/app';
import { expectOnlyKnownAxeViolations } from './support/axe';

// MUT-86 (decision P1): "Paid? Two taps." in a real browser. The drawer's
// footer button sits outside its <form>, linked by form=, so the click and the
// Enter paths are proven here rather than with user-event.
test.describe('Record payment (MUT-86)', () => {
  test.beforeEach(async ({ page }) => {
    await openFreshApp(page, '/income');
    await logIncome(page, { title: 'Logo redesign', amount: '1200', client: 'Acme Studio' });
  });

  function entryRow(page: Page): Locator {
    return page.getByRole('row').filter({ hasText: 'Acme Studio' });
  }

  /** Tap one: the row's Record Payment button opens the drawer */
  async function openPaymentDrawer(page: Page): Promise<Locator> {
    await entryRow(page).getByRole('button', { name: /^Record Payment/ }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByRole('heading', { level: 2 })).toContainText('$1,200');
    await expect(drawer.getByLabel('Payment amount')).toHaveValue('1200');
    await expect(drawer.getByText('Paid in full')).toBeVisible();
    return drawer;
  }

  test('open, then Record Payment: the full amount is recorded and the drawer closes', async ({ page }) => {
    const drawer = await openPaymentDrawer(page);

    await drawer.getByRole('button', { name: 'Record Payment', exact: true }).click();

    await expect(drawer).toBeHidden();
    await expect(entryRow(page).getByRole('button', { name: /^Record Payment/ })).toHaveCount(0);
  });

  test('Enter in the amount field records it', async ({ page }) => {
    const drawer = await openPaymentDrawer(page);

    await expect(drawer.getByLabel('Payment amount')).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(drawer).toBeHidden();
    await expect(entryRow(page).getByRole('button', { name: /^Record Payment/ })).toHaveCount(0);
  });

  test('a partial amount leaves the rest owed', async ({ page }) => {
    const drawer = await openPaymentDrawer(page);

    // The prefill is selected, so typing replaces it
    await page.keyboard.type('200');
    // The amount sits in bidi isolates inside the sentence
    await expect(drawer.getByText(/\$1,000\W* still owed/)).toBeVisible();
    await drawer.getByRole('button', { name: 'Record Payment', exact: true }).click();

    await expect(drawer).toBeHidden();
    await expect(entryRow(page).getByRole('button', { name: /^Record Payment/ })).toContainText('$1,000');
  });

  test('axe, with the date and note fields open', async ({ page }) => {
    const drawer = await openPaymentDrawer(page);
    await drawer.getByRole('button', { name: /Payment date/ }).click();
    await drawer.getByRole('button', { name: 'Add note' }).click();
    await expect(drawer.getByLabel('Notes')).toBeFocused();

    await expectOnlyKnownAxeViolations(page, 'paymentDrawer', '[role="dialog"]');
  });
});
