import { test, expect } from '../../support/qa';
import { OFFICE_A, office } from '../../support/portal';
import { FakeApi } from '../../support/portalApi';
import { openYou, youRow } from '../../support/you';

/**
 * Change your own password (MUT-237): You › Account's drawer (MUT-425; was the account menu). The
 * in-memory API (qa/support/portalApi.ts) keeps the account's current
 * password, so a wrong guess is refused the way the server refuses it.
 */

const CURRENT = 'the-current-password';
const NEW_PASSWORD = 'a brand new long password';

async function openDrawer(page: import('@playwright/test').Page) {
  await openYou(page, 'account');
  await youRow(page, 'Change password').click();
  await expect(page.getByRole('dialog', { name: 'Change password' })).toBeVisible();
  await expect(page).toHaveURL(/changePassword=true/);
}

test('Change your password from You › Account; it closes with a toast and nothing else changes', { tag: '@portal.account.change-password' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], currentPassword: CURRENT });
  const dialog = page.getByRole('dialog', { name: 'Change password' });

  await step('Open Change password from You › Account', async () => {
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

test('You › App ends with Get the app: the iPhone and Android links name the portal', { tag: '@portal.account.get-the-app' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')] });
  const menu = page.getByRole('main');

  await step('Open You › App', async () => {
    await api.open(page, `/p/${OFFICE_A}/clients`);
    await openYou(page, 'app');
  });

  await step('"Get the iPhone app" opens the App Store in a new tab, saying it came from the portal', async () => {
    const ios = menu.getByRole('link', { name: /Get the iPhone app/ });
    const href = new URL((await ios.getAttribute('href'))!);
    expect(href.hostname).toBe('apps.apple.com');
    expect(href.searchParams.get('ct')).toBe('mutaba3a-portal');
    await expect(ios).toHaveAttribute('target', '_blank');
  });

  await step('"Get the Android app" is the last row and opens the Play Store in a new tab, saying it came from the portal', async () => {
    const android = menu.getByRole('link', { name: /Get the Android app/ });
    const raw = (await android.getAttribute('href'))!;
    const href = new URL(raw);
    expect(href.hostname).toBe('play.google.com');
    expect(href.searchParams.get('id')).toBe('com.barmajiyat.mutaba3a');
    expect(href.searchParams.get('referrer')).toContain('utm_campaign=mutaba3a-portal');
    await expect(android).toHaveAttribute('target', '_blank');
    await expect(menu.locator('.hp-you-row').last()).toHaveAttribute('href', raw);
  });
});
