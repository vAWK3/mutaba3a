import { test, expect } from '@playwright/test';

// MUT-5: logging work is title, Tab, amount, Tab, client, Enter, keyboard only.
// Unit tests can't prove the last Enter: the drawer's Save button sits in the
// footer, outside the <form>, linked by form="income-form", and user-event only
// submits through buttons inside the form. A real browser does.
test.describe('Income fast path (MUT-5)', () => {
  test('title, Tab, amount, Tab, client, Enter saves', async ({ page }) => {
    await page.goto('/app/income');

    // Fresh install: "Skip for now" creates the default (USD) profile
    await page.getByRole('button', { name: /skip for now/i }).click();
    await expect(page.getByRole('button', { name: /skip for now/i })).toBeHidden();

    await page.getByRole('button', { name: 'Add Income' }).click();
    const drawer = page.getByRole('dialog').filter({ hasText: 'New Income' });
    await expect(drawer).toBeVisible();

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

    // The only option is "create Acme Studio", already highlighted: Enter picks it.
    // The list is then closed, so the next Enter belongs to the form and saves,
    // even when pressed before the new client has finished saving.
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(drawer).toBeHidden();

    // The work record shows up on the client it was logged for
    await page.goto('/app/clients');
    await page.getByRole('link', { name: 'Acme Studio' }).first().click();
    await expect(page.getByText('Logo redesign')).toBeVisible();
    await expect(page.getByText('$1,200').first()).toBeVisible();
  });

  test('Escape in an open client list closes only the list', async ({ page }) => {
    await page.goto('/app/income');
    await page.getByRole('button', { name: /skip for now/i }).click();
    await page.getByRole('button', { name: 'Add Income' }).click();

    const drawer = page.getByRole('dialog').filter({ hasText: 'New Income' });
    await drawer.getByLabel('What did you do?').fill('Kept work');
    const client = drawer.getByPlaceholder('Search or create client...');
    await client.click();
    await client.pressSequentially('Ne');
    await expect(drawer.getByRole('listbox')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(drawer.getByRole('listbox')).toBeHidden();
    await expect(drawer).toBeVisible();
    await expect(drawer.getByLabel('What did you do?')).toHaveValue('Kept work');
  });
});
