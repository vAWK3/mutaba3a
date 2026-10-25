import type { Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { expectNoHorizontalOverflow } from '../../support/brand';
import { address, chooseLanguage, lapsePasskeyPromptHide, mailTo, operatorAccount, setupLinkIn, signInThroughForm } from '../../support/selfService';
import { stubTurnstile } from '../../support/turnstile';
import { addVirtualAuthenticator, type VirtualAuthenticator } from '../../support/passkeys';
import { openYou, youRow } from '../../support/you';

/**
 * MUT-115: passkeys on the portal, against the live dev API's real WebAuthn checks (support/selfservice-live.mjs:
 * http://localhost:8791, WEBAUTHN_RP_ID=localhost). Chromium's virtual authenticator answers the system sheet
 * (support/passkeys.ts), so Add and Sign in with a passkey run end to end.
 *
 * The virtual authenticator also answers the email field's autofill at once, so signing out would sign straight back
 * in: the device is "away" (no presence) while a spec signs out, and back when it presses the button.
 */

const PASSWORD = 'the first long passphrase';
const HOME = /\/p\/[0-9a-f-]{36}$/;

async function signedIn(page: Page, language: 'en' | 'ar' = 'en'): Promise<{ email: string; authenticator: VirtualAuthenticator }> {
  const email = address('passkey');
  await operatorAccount(email, language, PASSWORD);
  const authenticator = await addVirtualAuthenticator(page);
  await signInThroughForm(page, email, PASSWORD, language);
  await expect(page).toHaveURL(HOME);
  return { email, authenticator };
}

async function addPasskey(page: Page) {
  await openYou(page, 'account');
  await youRow(page, 'Passkeys').click();
  const dialog = page.getByRole('dialog', { name: 'Passkeys' });
  await expect(dialog.getByText('No passkeys yet')).toBeVisible();
  await dialog.getByRole('button', { name: 'Add a passkey' }).click();
  await expect(page.getByText('Passkey added')).toBeVisible();
  await expect(dialog.getByRole('listitem')).toHaveCount(1);
  return dialog;
}

async function signOut(page: Page, authenticator: VirtualAuthenticator) {
  await authenticator.setPresence(false);
  await page.goto('/');
  await openYou(page, 'account');
  await youRow(page, 'Sign out').click();
  await expect(page).toHaveURL(/\/sign-in/);
}

async function signInWithPasskey(page: Page, authenticator: VirtualAuthenticator) {
  await page.goto('/sign-in');
  await authenticator.setPresence(true);
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
}

test.beforeEach(async ({ page }) => {
  await chooseLanguage(page, 'en');
});

test('Add a passkey from You › Account, right after signing in, with no password prompt', { tag: '@portal-selfservice.passkeys.add' }, async ({ page, step }) => {
  const { authenticator } = await signedIn(page);
  await step('Open You › Account › Passkeys and press Add a passkey; the device confirms', async () => {
    const dialog = await addPasskey(page);
    await expect(dialog.getByText(/^Added .* · Never used$/)).toBeVisible();
    await expect(dialog.getByLabel('Password')).toHaveCount(0);
  });
  await step('The device holds the new passkey', async () => {
    expect(await authenticator.count()).toBe(1);
  });
});

test('Sign in with a passkey, after signing out', { tag: '@portal-selfservice.passkeys.sign-in' }, async ({ page, step }) => {
  const { authenticator } = await signedIn(page);
  await step('Add a passkey', async () => {
    await addPasskey(page);
  });
  await step('Sign out', async () => {
    await signOut(page, authenticator);
  });
  await step('On sign-in press Sign in with a passkey', async () => {
    await expect(page.getByRole('separator')).toHaveText('or');
    await signInWithPasskey(page, authenticator);
  });
  await step('Signed in, on Home, with no password typed', async () => {
    await expect(page).toHaveURL(HOME);
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  });
  await step('Passkeys shows it was used today', async () => {
    await openYou(page, 'account');
    await youRow(page, 'Passkeys').click();
    await expect(page.getByRole('dialog', { name: 'Passkeys' }).getByText(/Last used today/)).toBeVisible();
  });
});

test('Removing a passkey stops it signing in', { tag: '@portal-selfservice.passkeys.remove' }, async ({ page, step }) => {
  const { authenticator } = await signedIn(page);
  await step('Add a passkey', async () => {
    await addPasskey(page);
  });
  await step('Press Remove on it and confirm', async () => {
    const dialog = page.getByRole('dialog', { name: 'Passkeys' });
    await dialog.getByRole('button', { name: /^Remove / }).click();
    await expect(dialog.getByText(/You won’t be able to sign in with it/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.getByText('Passkey removed. Devices signed in with it are signed out.')).toBeVisible();
    await expect(dialog.getByText('No passkeys yet')).toBeVisible();
  });
  await step('Sign out, then try Sign in with a passkey', async () => {
    await signOut(page, authenticator);
    await signInWithPasskey(page, authenticator);
  });
  await step('Refused: "That passkey didn’t work", still on sign-in', async () => {
    await expect(page.getByRole('alert')).toHaveText('That passkey didn’t work. Try again, or sign in with your password.');
    await expect(page).toHaveURL(/\/sign-in/);
  });
});

test('Changing the password keeps the passkey', { tag: '@portal-selfservice.passkeys.password-change-keeps' }, async ({ page, step }) => {
  const { authenticator } = await signedIn(page);
  await step('Add a passkey', async () => {
    await addPasskey(page);
    await page.getByRole('dialog', { name: 'Passkeys' }).getByRole('button', { name: 'Close' }).click();
  });
  await step('Change the password from You › Account', async () => {
    await youRow(page, 'Change password').click();
    const dialog = page.getByRole('dialog', { name: 'Change password' });
    await dialog.getByLabel('Current password').fill(PASSWORD);
    await dialog.getByLabel('New password').fill('a brand new long passphrase');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Password changed')).toBeVisible();
  });
  await step('Sign out and Sign in with a passkey', async () => {
    await signOut(page, authenticator);
    await signInWithPasskey(page, authenticator);
  });
  await step('Signed in with the passkey', async () => {
    await expect(page).toHaveURL(HOME);
  });
});

test('The email field offers the passkey (autofill)', { tag: '@portal-selfservice.passkeys.autofill' }, async ({ page, step }) => {
  const { authenticator } = await signedIn(page);
  await step('Add a passkey and sign out', async () => {
    await addPasskey(page);
    await signOut(page, authenticator);
  });
  await step('Open sign-in: the email field asks for passkeys too', async () => {
    await page.goto('/sign-in');
    await expect(page.getByLabel('Email')).toHaveAttribute('autocomplete', 'username webauthn');
  });
  await step('Pick the passkey the field offers (the virtual device answers the field at once), without pressing anything', async () => {
    await authenticator.setPresence(true);
    await page.reload();
    await expect(page).toHaveURL(HOME, { timeout: 15_000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  });
});

test('Passkeys in Arabic on a phone: مفاتيح المرور, right to left, the row actions under the name', { tag: '@portal-selfservice.passkeys.arabic-phone' }, async ({ page, step }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await chooseLanguage(page, 'ar');
  const email = address('passkey-ar');
  await operatorAccount(email, 'ar', PASSWORD);
  const authenticator = await addVirtualAuthenticator(page);
  await signInThroughForm(page, email, PASSWORD, 'ar');
  await expect(page).toHaveURL(HOME);
  await step('Open أنت › الحساب › مفاتيح المرور and add one', async () => {
    await openYou(page, 'account');
    await youRow(page, 'مفاتيح المرور').click();
    const dialog = page.getByRole('dialog', { name: 'مفاتيح المرور' });
    await expect(dialog.getByText('لا توجد مفاتيح مرور بعد')).toBeVisible();
    await dialog.getByRole('button', { name: 'إضافة مفتاح مرور' }).click();
    await expect(page.getByText('أُضيف مفتاح المرور')).toBeVisible();
  });
  await step('The drawer reads right to left and fits the phone', async () => {
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const row = page.getByRole('dialog', { name: 'مفاتيح المرور' }).getByRole('listitem').first();
    await expect(row).toBeVisible();
    const box = await row.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 375).toBe(true);
  });
  await step('Sign out: the sign-in page offers تسجيل الدخول بمفتاح المرور', async () => {
    await authenticator.setPresence(false);
    await page.goto('/');
    await openYou(page, 'account');
    await youRow(page, 'تسجيل الخروج').click();
    await expect(page.getByRole('button', { name: 'تسجيل الدخول بمفتاح المرور' })).toBeVisible();
  });
});

// ---- MUT-370: Home suggests a passkey after a sign-in ---------------------------------------------------------------

const SUGGESTION = 'Add a passkey: the more secure way to sign in.';
const suggestion = (page: Page, title = SUGGESTION) => page.getByRole('region', { name: title });

test('The first sign-in after signup suggests a passkey, after the free trial’s first-run step', { tag: '@portal-selfservice.passkeys.suggest-first-sign-in' }, async ({ page, step }) => {
  await stubTurnstile(page, 'pass');
  const email = address('suggest-signup');
  await step('Sign up: ask for a link, open the mail, choose a password and create the account', async () => {
    await page.goto('/signup');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Check your email' })).toBeVisible();
    await page.goto(setupLinkIn(await mailTo(email, 'finish-signup')));
    await page.getByLabel('New password').fill(PASSWORD);
    await page.getByRole('checkbox', { name: /terms of service/ }).check();
    await page.getByRole('button', { name: 'Create account' }).click();
  });
  await step('The free trial’s first-run step comes first; no passkey card yet', async () => {
    const trial = page.getByRole('dialog', { name: 'Your free trial' });
    await expect(trial.getByRole('heading', { name: 'Your 14-day free trial has started' })).toBeVisible();
    await expect(page.getByText(SUGGESTION)).toHaveCount(0);
    await trial.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
  await step('Home suggests a passkey: the more secure way to sign in; the password still works', async () => {
    await expect(page).toHaveURL(HOME);
    const card = suggestion(page);
    await expect(card).toBeVisible();
    await expect(card.getByText('Your password still works.')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Add a passkey' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Not now' })).toBeVisible();
  });
});

test('Not now hides the suggestion for 30 days; after the third Not now it never comes back', { tag: '@portal-selfservice.passkeys.suggest-not-now' }, async ({ page, step }) => {
  const { email } = await signedIn(page);
  await step('Press Not now: the card goes at once, and stays gone after a reload', async () => {
    await suggestion(page).getByRole('button', { name: 'Not now' }).click();
    await expect(suggestion(page)).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    await expect(suggestion(page)).toHaveCount(0);
  });
  for (const offer of ['second', 'third']) {
    await step(`30 days later it is back (the ${offer} offer); press Not now again`, async () => {
      lapsePasskeyPromptHide(email);
      await page.reload();
      await expect(suggestion(page)).toBeVisible();
      await suggestion(page).getByRole('button', { name: 'Not now' }).click();
      await expect(suggestion(page)).toHaveCount(0);
    });
  }
  await step('30 days after the third Not now: no card, ever', async () => {
    lapsePasskeyPromptHide(email);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    await expect(suggestion(page)).toHaveCount(0);
  });
});

test('Add a passkey from the suggestion, then sign in with it', { tag: '@portal-selfservice.passkeys.suggest-add' }, async ({ page, step }) => {
  const { authenticator } = await signedIn(page);
  await step('Press Add a passkey on the card; the device confirms with no password asked', async () => {
    await suggestion(page).getByRole('button', { name: 'Add a passkey' }).click();
    await expect(page.getByText('Passkey added')).toBeVisible();
    await expect(suggestion(page)).toHaveCount(0);
    await expect(page.getByLabel('Password')).toHaveCount(0);
    expect(await authenticator.count()).toBe(1);
  });
  await step('Sign out', async () => {
    await signOut(page, authenticator);
  });
  await step('Sign in with a passkey: Home, and no card', async () => {
    await signInWithPasskey(page, authenticator);
    await expect(page).toHaveURL(HOME);
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    await expect(suggestion(page)).toHaveCount(0);
  });
});

test('Someone who already has a passkey is never shown the suggestion', { tag: '@portal-selfservice.passkeys.suggest-has-passkey' }, async ({ page, step }) => {
  await signedIn(page);
  await step('Home suggests a passkey', async () => {
    await expect(suggestion(page)).toBeVisible();
  });
  await step('Add one from You › Account › Passkeys and close the drawer', async () => {
    const dialog = await addPasskey(page);
    await dialog.getByRole('button', { name: 'Close' }).click();
  });
  await step('Home: no card, then or after a reload', async () => {
    await page.goto('/');
    await expect(page).toHaveURL(HOME);
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    await expect(suggestion(page)).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    await expect(suggestion(page)).toHaveCount(0);
  });
});

test('The passkey suggestion in Arabic on a 375 px phone', { tag: '@portal-selfservice.passkeys.suggest-arabic-phone' }, async ({ page, step }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await chooseLanguage(page, 'ar');
  await signedIn(page, 'ar');
  await step('Home suggests a passkey in Arabic, right to left', async () => {
    const card = suggestion(page, 'أضف مفتاح مرور: الطريقة الأكثر أمانًا لتسجيل الدخول.');
    await expect(card).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(card.getByText('وتبقى كلمة المرور صالحة.')).toBeVisible();
    await expect(card.getByRole('button', { name: 'إضافة مفتاح مرور' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'ليس الآن' })).toBeVisible();
  });
  await step('The card fits the phone, nothing scrolls sideways', async () => {
    await expectNoHorizontalOverflow(page, 'the passkey suggestion at 375 px');
    const box = await suggestion(page, 'أضف مفتاح مرور: الطريقة الأكثر أمانًا لتسجيل الدخول.').boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 375).toBe(true);
  });
});
