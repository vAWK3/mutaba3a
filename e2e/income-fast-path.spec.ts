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
    // While the new client is being saved the field is busy and holds Enter;
    // once it exists the list is closed and the next Enter saves the entry.
    await page.keyboard.press('Enter');
    await expect(client).toHaveValue('Acme Studio');
    await expect(client).not.toHaveAttribute('aria-busy', 'true');
    await page.keyboard.press('Enter');
    await expect(drawer).toBeHidden();

    // The work record shows up on the client it was logged for
    await page.goto('/app/clients');
    await page.getByRole('link', { name: 'Acme Studio' }).first().click();
    await expect(page.getByText('Logo redesign')).toBeVisible();
    await expect(page.getByText('$1,200').first()).toBeVisible();
  });

  test('Enter, Enter straight away creates the client and saves the entry', async ({ page }) => {
    await page.goto('/app/income');
    await page.getByRole('button', { name: /skip for now/i }).click();
    await page.getByRole('button', { name: 'Add Income' }).click();
    const drawer = page.getByRole('dialog').filter({ hasText: 'New Income' });

    await drawer.getByLabel('What did you do?').fill('Site audit');
    await drawer.getByLabel(/^Amount/).fill('300');
    const client = drawer.getByPlaceholder('Search or create client...');
    await client.click();
    await client.pressSequentially('Brand New Ltd');

    // The second Enter lands while the client is still being saved: the field
    // holds it and submits once the client exists.
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(drawer).toBeHidden();

    await page.goto('/app/clients');
    await page.getByRole('link', { name: 'Brand New Ltd' }).first().click();
    await expect(page.getByText('Site audit')).toBeVisible();
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

  test('the amount stays left-to-right, currency first, in Arabic', async ({ page }) => {
    await page.goto('/app/settings');
    await page.getByRole('button', { name: /skip for now/i }).click();
    await page.getByRole('button', { name: 'العربية' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

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
});
