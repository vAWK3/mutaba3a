import { test, expect } from '../../support/qa';
import { OFFICE_A, office } from '../../support/portal';
import { FakeApi } from '../../support/portalApi';

/**
 * Change your own password (MUT-237): the account menu's drawer. The
 * in-memory API (qa/support/portalApi.ts) keeps the account's current
 * password, so a wrong guess is refused the way the server refuses it.
 */

const CURRENT = 'the-current-password';
const NEW_PASSWORD = 'a brand new long password';

async function openDrawer(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /^Account/ }).click();
  await page.getByRole('menuitem', { name: 'Change password' }).click();
  await expect(page.getByRole('dialog', { name: 'Change password' })).toBeVisible();
  await expect(page).toHaveURL(/changePassword=true/);
}

test('Change your password from the account menu; it closes with a toast and nothing else changes', { tag: '@portal.account.change-password' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], currentPassword: CURRENT });
  const dialog = page.getByRole('dialog', { name: 'Change password' });

  await step('Open Change password from the account menu, over the current page', async () => {
    await api.open(page, `/p/${OFFICE_A}/clients`);
    await openDrawer(page);
    await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
  });

  await step('Enter the current password and a new one, and Save', async () => {
    await dialog.getByLabel('Current password').fill(CURRENT);
    await dialog.getByLabel('New password').fill(NEW_PASSWORD);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Password changed')).toBeVisible();
    await expect(dialog).toBeHidden();
    expect(api.last('POST', /^\/v1\/me\/password$/)?.body).toEqual({ currentPassword: CURRENT, newPassword: NEW_PASSWORD });
  });
});

test('A wrong current password shows a banner and keeps what was typed', { tag: '@portal.account.wrong-current-password' }, async ({ page }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], currentPassword: CURRENT });
  await api.open(page, `/p/${OFFICE_A}/clients`);
  await openDrawer(page);
  const dialog = page.getByRole('dialog', { name: 'Change password' });

  await dialog.getByLabel('Current password').fill('not the right one');
  await dialog.getByLabel('New password').fill(NEW_PASSWORD);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Current password is wrong.');
  await expect(dialog.getByLabel('New password')).toHaveValue(NEW_PASSWORD);
});

test('A new password under 12 characters is refused inline, before anything is sent', { tag: '@portal.account.password-rule' }, async ({ page }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], currentPassword: CURRENT });
  await api.open(page, `/p/${OFFICE_A}/clients`);
  await openDrawer(page);
  const dialog = page.getByRole('dialog', { name: 'Change password' });

  await dialog.getByLabel('Current password').fill(CURRENT);
  await dialog.getByLabel('New password').fill('short');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('Use at least 12 characters.')).toBeVisible();
  expect(api.log.filter((c) => c.method === 'POST' && c.path === '/v1/me/password')).toHaveLength(0);
});
