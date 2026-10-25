import type { Page } from '@playwright/test';
import { request as playwrightRequest } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { address, chooseLanguage, operatorAccount, signInThroughForm } from '../../support/selfService';
import { openYou, youRow } from '../../support/you';

/**
 * MUT-262 (TD-158): a password change rotates the caller's own session, against the live dev API
 * (support/selfservice-live.mjs, http://localhost:8791 serving the built portal). The browser carries on under the new
 * cookie; the value it held before the change is refused.
 */

const PASSWORD = 'the first long passphrase';
const NEW_PASSWORD = 'a second long passphrase';
const HOME = /\/p\/[0-9a-f-]{36}$/;
// Plain http on localhost: no __Host- prefix (server/src/auth/sessions.ts sessionCookieName).
const COOKIE = 'mut_session';

async function sessionCookie(page: Page): Promise<string> {
  const found = (await page.context().cookies()).find((c) => c.name === COOKIE);
  expect(found, 'the portal holds a session cookie').toBeTruthy();
  return found!.value;
}

test.beforeEach(async ({ page }) => {
  await chooseLanguage(page, 'en');
});

test('Change your password and stay signed in; the old session cookie stops working', { tag: '@portal-selfservice.account.rotate-on-change' }, async ({ page, step, baseURL }) => {
  const email = address('rotate');
  await operatorAccount(email, 'en', PASSWORD);
  let before = '';
  await step('Sign in with your password', async () => {
    await signInThroughForm(page, email, PASSWORD);
    await expect(page).toHaveURL(HOME);
    before = await sessionCookie(page);
  });
  await step('Open You › Account › Change password, type the current and a new password, and press Save', async () => {
    await openYou(page, 'account');
    await youRow(page, 'Change password').click();
    const dialog = page.getByRole('dialog', { name: 'Change password' });
    await dialog.getByLabel('Current password').fill(PASSWORD);
    await dialog.getByLabel('New password').fill(NEW_PASSWORD);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Password changed')).toBeVisible();
    await expect(dialog).toHaveCount(0);
  });
  await step('Open Home again', async () => {
    await page.goto('/');
    await expect(page).toHaveURL(HOME);
    await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
    expect(await sessionCookie(page)).not.toBe(before);
  });
  await step('Replay the old session cookie against the API', async () => {
    const outsider = await playwrightRequest.newContext({ baseURL: baseURL ?? 'http://localhost:8791' });
    const replay = await outsider.get('/v1/me', { headers: { cookie: `${COOKIE}=${before}` } });
    expect(replay.status()).toBe(401);
    const current = await outsider.get('/v1/me', { headers: { cookie: `${COOKIE}=${await sessionCookie(page)}` } });
    expect(current.status()).toBe(200);
    await outsider.dispose();
  });
});
