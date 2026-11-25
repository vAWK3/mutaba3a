import type { Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { expectNoHorizontalOverflow } from '../../support/brand';
import { SETUP_PASSKEY, address, chooseLanguage, operatorAccount } from '../../support/selfService';
import { addVirtualAuthenticator, dismissNextPasskeySheet, type VirtualAuthenticator } from '../../support/passkeys';
import { openYou, youRow } from '../../support/you';

/**
 * MUT-619: the passkey step at the end of /setup, against the live dev API's real WebAuthn checks
 * (WEBAUTHN_RP_ID=localhost). Each spec opens the setup link of an operator-created account (the pilot path), as the
 * person would from the operator's message, so the account has no passkey and all three MUT-370 offers left.
 */

const PASSWORD = 'the first long passphrase';
const HOME = /\/p\/[0-9a-f-]{36}$/;
const SUGGESTION = 'Add a passkey: the more secure way to sign in.';
const COPY = {
  en: { password: 'New password', terms: /terms of service/, save: 'Save and sign in', home: 'Home' },
  ar: { password: 'كلمة المرور الجديدة', terms: /شروط الخدمة/, save: 'احفظ وسجّل الدخول', home: 'الرئيسية' },
} as const;

/** An operator-created account's setup link, opened on the QA origin; the password set. Returns the address. */
async function setPassword(page: Page, language: 'en' | 'ar' = 'en'): Promise<string> {
  const email = address(`setup-passkey-${language}`);
  const { setupUrl } = await operatorAccount(email, language);
  await page.goto(`/setup${new URL(setupUrl).hash}`);
  await page.getByLabel(COPY[language].password).fill(PASSWORD);
  await page.getByRole('checkbox', { name: COPY[language].terms }).check();
  await page.getByRole('button', { name: COPY[language].save }).click();
  return email;
}

const stepHeading = (page: Page, language: 'en' | 'ar' = 'en') => page.getByRole('heading', { level: 1, name: SETUP_PASSKEY[language].title });

async function expectHome(page: Page, language: 'en' | 'ar' = 'en') {
  await expect(page).toHaveURL(HOME);
  await expect(page.getByRole('heading', { level: 1, name: COPY[language].home })).toBeVisible();
}

async function signOut(page: Page, authenticator: VirtualAuthenticator) {
  await authenticator.setPresence(false);
  await openYou(page, 'account');
  await youRow(page, 'Sign out').click();
  await expect(page).toHaveURL(/\/sign-in/);
}

test('After setting a password, Create a passkey registers one, lands on Home, and signs in next time', { tag: '@portal-selfservice.setup.passkey-create' }, async ({ page, step }) => {
  await chooseLanguage(page, 'en');
  const authenticator = await addVirtualAuthenticator(page);
  await step('Open the setup link, type a password, tick the terms and press Save and sign in', async () => {
    await setPassword(page);
  });
  await step('Signed in, the page offers a passkey before Home, with Create a passkey and Not now', async () => {
    await expect(stepHeading(page)).toBeVisible();
    await expect(page.getByText('Your password is set. Create a passkey so you won’t need to type it. It syncs to your phone through iCloud Keychain or Google Password Manager.')).toBeVisible();
    await expect(page.getByRole('button', { name: SETUP_PASSKEY.en.create })).toBeVisible();
    await expect(page.getByRole('button', { name: SETUP_PASSKEY.en.notNow })).toBeVisible();
    await expect(page).toHaveURL(/\/setup$/);
  });
  await step('Press Create a passkey; the device confirms: "Passkey added", Home, and no passkey card', async () => {
    await page.getByRole('button', { name: SETUP_PASSKEY.en.create }).click();
    await expect(page.getByTestId('toast-live').getByText('Passkey added')).toBeVisible();
    await expectHome(page);
    await expect(page.getByText(SUGGESTION)).toHaveCount(0);
    expect(await authenticator.count()).toBe(1);
  });
  await step('Sign out, then Sign in with a passkey: Home', async () => {
    await signOut(page, authenticator);
    await authenticator.setPresence(true);
    await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await expectHome(page);
    await expect(page.getByText(SUGGESTION)).toHaveCount(0);
  });
});

test('Not now lands on Home and spends one of the three passkey offers', { tag: '@portal-selfservice.setup.passkey-not-now' }, async ({ page, step }) => {
  await chooseLanguage(page, 'en');
  await step('Open the setup link and set a password', async () => {
    await setPassword(page);
    await expect(stepHeading(page)).toBeVisible();
  });
  await step('Press Not now: Home, with no "Add a passkey" card', async () => {
    await page.getByRole('button', { name: SETUP_PASSKEY.en.notNow }).click();
    await expectHome(page);
    await expect(page.getByText(SUGGESTION)).toHaveCount(0);
  });
  await step('After a reload, still no card; the account shows one Not now, hidden for 30 days', async () => {
    await page.reload();
    await expectHome(page);
    await expect(page.getByText(SUGGESTION)).toHaveCount(0);
    const me = (await (await page.request.get('/v1/me')).json()) as { user: { passkeyPrompt: { due: boolean; notNowCount: number; hiddenUntil: string } } };
    expect(me.user.passkeyPrompt).toMatchObject({ due: false, notNowCount: 1 });
    const days = (Date.parse(me.user.passkeyPrompt.hiddenUntil) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThanOrEqual(30);
  });
});

test('A cancelled passkey sheet says no passkey was created and still lets the person go on', { tag: '@portal-selfservice.setup.passkey-cancelled' }, async ({ page, step }) => {
  await chooseLanguage(page, 'en');
  const authenticator = await addVirtualAuthenticator(page);
  await step('Open the setup link and set a password', async () => {
    await setPassword(page);
    await expect(stepHeading(page)).toBeVisible();
  });
  await step('Press Create a passkey and dismiss the system sheet: "No passkey was created.", both buttons still there', async () => {
    await dismissNextPasskeySheet(page);
    await page.getByRole('button', { name: SETUP_PASSKEY.en.create }).click();
    await expect(page.getByRole('alert')).toContainText('No passkey was created.');
    await expect(page.getByRole('button', { name: SETUP_PASSKEY.en.create })).toBeEnabled();
    await expect(page.getByRole('button', { name: SETUP_PASSKEY.en.notNow })).toBeEnabled();
    expect(await authenticator.count()).toBe(0);
  });
  await step('Press Not now: Home', async () => {
    await page.getByRole('button', { name: SETUP_PASSKEY.en.notNow }).click();
    await expectHome(page);
  });
});

test('The passkey step in Arabic on a 375 px phone, right to left', { tag: '@portal-selfservice.setup.passkey-arabic-phone' }, async ({ page, step }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await chooseLanguage(page, 'ar');
  const authenticator = await addVirtualAuthenticator(page);
  await step('Open an Arabic account’s setup link at phone width and set a password', async () => {
    await setPassword(page, 'ar');
  });
  await step('أنشئ مفتاح مرور, right to left, fitting the phone', async () => {
    await expect(stepHeading(page, 'ar')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByText(/سلسلة مفاتيح iCloud أو مدير كلمات المرور من Google/)).toBeVisible();
    await expect(page.getByRole('button', { name: SETUP_PASSKEY.ar.notNow })).toBeVisible();
    await expectNoHorizontalOverflow(page, 'the setup passkey step at 375 px');
  });
  await step('Press أنشئ مفتاح مرور; the device confirms: Home', async () => {
    await page.getByRole('button', { name: SETUP_PASSKEY.ar.create }).click();
    await expectHome(page, 'ar');
    expect(await authenticator.count()).toBe(1);
  });
});
