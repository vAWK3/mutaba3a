import { test, expect } from '../../support/qa';
import { FIRM, OFFICE_A, OFFICE_B, office } from '../../support/portal';
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

test('The account menu ends with Get the app: the iPhone and Android links name the portal', { tag: '@portal.account.get-the-app' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')] });
  const menu = page.getByRole('menu', { name: 'Account' });

  await step('Open the account menu', async () => {
    await api.open(page, `/p/${OFFICE_A}/clients`);
    await page.getByRole('button', { name: /^Account/ }).click();
    await expect(menu).toBeVisible();
  });

  await step('"Get the iPhone app" opens the App Store in a new tab, saying it came from the portal', async () => {
    const ios = menu.getByRole('menuitem', { name: /Get the iPhone app/ });
    const href = new URL((await ios.getAttribute('href'))!);
    expect(href.hostname).toBe('apps.apple.com');
    expect(href.searchParams.get('ct')).toBe('mutaba3a-portal');
    await expect(ios).toHaveAttribute('target', '_blank');
  });

  await step('"Get the Android app" is the last row and opens the Play Store in a new tab, saying it came from the portal', async () => {
    const android = menu.getByRole('menuitem', { name: /Get the Android app/ });
    const raw = (await android.getAttribute('href'))!;
    const href = new URL(raw);
    expect(href.hostname).toBe('play.google.com');
    expect(href.searchParams.get('id')).toBe('com.barmajiyat.mutaba3a');
    expect(href.searchParams.get('referrer')).toContain('utm_campaign=mutaba3a-portal');
    await expect(android).toHaveAttribute('target', '_blank');
    await expect(menu.locator('[role^="menuitem"]').last()).toHaveAttribute('href', raw);
  });
});

// ---- MUT-333: Close my account ------------------------------------------------------------------

const PHONE = { width: 375, height: 812 };
const PARTNER = { userId: '11111111-1111-4111-8111-111111111111', name: 'Lina Saleh', email: 'lina@studio.ps', creator: false };
const ME_OWNER = { userId: '99999999-9999-4999-8999-999999999999', name: 'Nour Haddad', email: 'nour@office.ps', creator: true };
const closingProfiles = () => [
  office(OFFICE_A, 'Nour Studio'),
  { ...office(OFFICE_B, 'Haddad & Saleh'), owners: [ME_OWNER, PARTNER] },
  { id: FIRM, name: 'Haddad & Partners', type: null, owned: false, writerOfRecord: 'MALAFAT' as const },
];

async function openCloseAccount(page: import('@playwright/test').Page, menuName = /^Account/, item = 'Close my account') {
  await page.getByRole('button', { name: menuName }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

test('Close my account from the account menu, with the password; the closing page takes over', { tag: '@portal.account.close' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: closingProfiles(), currentPassword: CURRENT });
  const dialog = page.getByRole('dialog', { name: 'Close my account' });

  await step('From the account menu, choose Close my account', async () => {
    await api.open(page, `/p/${OFFICE_A}/clients`);
    await openCloseAccount(page);
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/closeAccount=true/);
    await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
    await expect(dialog.getByText('nour@office.ps')).toBeVisible();
  });

  await step('Read what is deleted and what is kept, and that Download my records is offered first', async () => {
    await expect(dialog.getByText('These profiles, with every record and receipt in them: Nour Studio.')).toBeVisible();
    await expect(dialog.getByText('Haddad & Saleh passes to Lina Saleh, with everything in it.')).toBeVisible();
    await expect(dialog.getByText('Haddad & Partners keeps the records you added, without your name. Only your access ends.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Download my records' })).toBeVisible();
  });

  await step('Enter a wrong password and Close my account, then the right one', async () => {
    await dialog.getByLabel('Your password').fill('not the password');
    await dialog.getByRole('button', { name: 'Close my account' }).click();
    await expect(dialog.getByRole('alert')).toContainText('That password is wrong.');
    expect(api.closure).toBeNull();
    await dialog.getByLabel('Your password').fill(CURRENT);
    await dialog.getByRole('button', { name: 'Close my account' }).click();
    await expect(page.getByRole('heading', { name: 'Your account is closing' })).toBeVisible();
    await expect(page.getByText(/We'll delete your account and its records on .+ \d{4}\./)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Keep my account' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    expect(api.last('POST', /^\/v1\/me\/closure$/)?.body).toEqual({ password: CURRENT });
  });
});

test('Signing in while the account is closing shows only the closing page; Keep my account brings everything back', { tag: '@portal.account.close-cancel' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: closingProfiles(), closure: { requestedAt: '2026-11-01T09:00:00.000Z', deleteAfter: '2026-12-01T09:00:00.000Z' } });

  await step('Sign in while the account is closing', async () => {
    await api.open(page, `/p/${OFFICE_A}/clients`);
    await expect(page.getByRole('heading', { name: 'Your account is closing' })).toBeVisible();
    await expect(page.getByText("We'll delete your account and its records on December 1, 2026.")).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Sections' })).toHaveCount(0);
  });

  await step('Press Keep my account', async () => {
    await page.getByRole('button', { name: 'Keep my account' }).click();
    await expect(page.getByText('Your account stays open.')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
    expect(api.closure).toBeNull();
    expect(api.calls('DELETE', /^\/v1\/me\/closure$/)).toHaveLength(1);
  });
});

test('A locked account can still close itself', { tag: '@portal.account.close-locked' }, async ({ page, step }) => {
  const locked = { state: 'LOCKED' as const, source: 'TRIAL' as const, tier: 'FREELANCER' as const, until: null };
  const api = new FakeApi({ profiles: [{ ...office(OFFICE_A, 'Nour Studio'), billing: locked }], billingStanding: 'locked', currentPassword: CURRENT });
  const dialog = page.getByRole('dialog', { name: 'Close my account' });

  await step('Sign in on day 31 of a trial that never got a card (locked)', async () => {
    await api.open(page, `/p/${OFFICE_A}`);
    await expect(page.getByRole('heading', { name: 'Subscribe or download your records' })).toBeVisible();
  });

  await step('From the account menu, choose Close my account and enter the password', async () => {
    await openCloseAccount(page);
    await dialog.getByLabel('Your password').fill(CURRENT);
    await dialog.getByRole('button', { name: 'Close my account' }).click();
    await expect(page.getByRole('heading', { name: 'Your account is closing' })).toBeVisible();
  });
});

test('Close my account and the closing page read right to left in Arabic on a 375px phone', { tag: '@portal.account.close-arabic-phone' }, async ({ page, step }) => {
  await page.setViewportSize(PHONE);
  const api = new FakeApi({ profiles: closingProfiles(), currentPassword: CURRENT });
  const noSideScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  const dialog = page.getByRole('dialog', { name: 'إغلاق حسابي' });

  await step('On a 375px phone, in Arabic, open Close my account', async () => {
    await api.open(page, `/p/${OFFICE_A}?closeAccount=true`, 'ar');
    await expect(dialog).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');
    const address = dialog.getByText('nour@office.ps', { exact: true });
    await expect(address).toBeVisible();
    expect(await address.evaluate((el) => el.closest('bdi')?.getAttribute('dir'))).toBe('ltr');
    await expect(dialog.getByText('ينتقل Haddad & Saleh إلى Lina Saleh مع كل ما فيه.')).toBeVisible();
    expect(await noSideScroll()).toBe(true);
  });

  await step('Close the account with the password', async () => {
    await dialog.getByLabel('كلمة المرور').fill(CURRENT);
    await dialog.getByRole('button', { name: 'إغلاق حسابي' }).click();
    await expect(page.getByRole('heading', { name: 'حسابك قيد الإغلاق' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'الإبقاء على حسابي' })).toBeVisible();
    expect(await noSideScroll()).toBe(true);
  });
});
