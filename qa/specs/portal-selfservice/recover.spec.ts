import type { Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { address, chooseLanguage, mailTo, operatorAccount, outbox, setupLinkIn, signInThroughForm } from '../../support/selfService';
import { stubTurnstile } from '../../support/turnstile';

/**
 * MUT-368: Forgot your password, on the live dev API (support/selfservice-live.mjs). Every address gets the same
 * answer; only the outbox differs. Turnstile is the page-routed stand-in (support/turnstile.ts).
 */

const OLD_PASSWORD = 'the first long passphrase';
const NEW_PASSWORD = 'a brand new long passphrase';

async function askForReset(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByRole('link', { name: 'Forgot your password?' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Reset your password' })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send link' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Check your email' })).toBeVisible();
  await expect(page.getByText(/has an account, we've sent it a link to choose a new password/)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await chooseLanguage(page, 'en');
  await stubTurnstile(page, 'pass');
});

test('Forgot your password? resets it, signs you in, signs out another browser, and sends a notice', { tag: '@portal-selfservice.recover.reset' }, async ({ page, browser, step }) => {
  const email = address('reset');
  await operatorAccount(email, 'en', OLD_PASSWORD);
  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const otherPage = await other.newPage();
  await chooseLanguage(otherPage, 'en');

  await step('Another browser is signed in with the old password', async () => {
    await signInThroughForm(otherPage, email, OLD_PASSWORD);
    await expect(otherPage).toHaveURL(/\/p\/[0-9a-f-]{36}$/);
  });
  await step('On sign-in press Forgot your password?, type the address and press Send link', async () => {
    await askForReset(page, email);
  });
  await step('Open the mail’s link and choose a new password', async () => {
    const mail = await mailTo(email, 'reset-password');
    await page.goto(setupLinkIn(mail));
    await expect(page.getByRole('heading', { level: 1, name: 'Choose a new password' })).toBeVisible();
    await page.getByLabel('New password').fill(NEW_PASSWORD);
    await page.getByRole('checkbox', { name: /terms of service/ }).check();
    await page.getByRole('button', { name: 'Save and sign in' }).click();
  });
  await step('Signed in with the new password, on Home', async () => {
    await expect(page).toHaveURL(/\/p\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  });
  await step('The other browser is signed out', async () => {
    await otherPage.reload();
    await expect(otherPage).toHaveURL(/\/sign-in/);
  });
  await step('A "password changed" mail arrives', async () => {
    await mailTo(email, 'password-changed');
  });
  await other.close();
});

test('Recovering an address with no account says the same thing and sends nothing', { tag: '@portal-selfservice.recover.unknown' }, async ({ page, step }) => {
  const email = address('nobody');
  await step('Ask for a reset link for an address with no account: the same "Check your email"', async () => {
    await askForReset(page, email);
  });
  await step('The outbox has nothing for it', async () => {
    expect(await outbox(email)).toEqual([]);
  });
});

test('Recovering an operator-created account that never set a password mails a setup link that works', { tag: '@portal-selfservice.recover.pending-account' }, async ({ page, step }) => {
  const email = address('pending');
  await operatorAccount(email, 'en');
  await step('Ask for a reset link for the account the operator created', async () => {
    await askForReset(page, email);
  });
  await step('A finish-setup mail arrives; its page says "Set your password"', async () => {
    const mail = await mailTo(email, 'finish-setup');
    await page.goto(setupLinkIn(mail));
    await expect(page.getByRole('heading', { level: 1, name: 'Set your password' })).toBeVisible();
  });
  await step('Set the first password: signed in', async () => {
    await page.getByLabel('New password').fill(NEW_PASSWORD);
    await page.getByRole('checkbox', { name: /terms of service/ }).check();
    await page.getByRole('button', { name: 'Save and sign in' }).click();
    await expect(page).toHaveURL(/\/p\/[0-9a-f-]{36}$/);
  });
});
