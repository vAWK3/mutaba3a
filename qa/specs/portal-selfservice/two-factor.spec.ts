import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '../../support/qa';
import { address, appCode, chooseLanguage, codeFromMail, enableTwoFactor, mailTo, operatorAccount, setupLinkIn, signInThroughForm, skipSetupPasskey } from '../../support/selfService';
import { stubTurnstile } from '../../support/turnstile';
import { openYou, youRow } from '../../support/you';

/**
 * MUT-710 (ADR-274): two-step sign-in on the live dev API (support/selfservice-live.mjs). The app's codes are computed
 * from the secret the enrolment shows, as an authenticator would; the emailed codes are read from the memory outbox.
 * Copy is read from the portal's own translation files, so a wording change needs no spec change and Arabic is covered.
 */

const PASSWORD = 'the account long passphrase';
const NEW_PASSWORD = 'a brand new long passphrase';
const HOME = /\/p\/[0-9a-f-]{36}$/;

const i18n = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../src/hosted/i18n');
type Plural = Record<string, string>;
interface Copy {
  hosted: { twoFactor: Record<string, string | Plural | Record<string, string>>; setup: { saveAndSignIn?: string } };
}
const load = (language: 'en' | 'ar') => (JSON.parse(fs.readFileSync(path.join(i18n, `${language}.json`), 'utf8')) as Copy).hosted.twoFactor;
const COPY = { en: load('en'), ar: load('ar') } as const;
const text = (language: 'en' | 'ar', key: string) => COPY[language][key] as string;
const plural = (language: 'en' | 'ar', key: string, form: string, count: number) => (COPY[language][key] as Plural)[form]!.replace('{count}', String(count));

test.beforeEach(async ({ page }) => {
  await stubTurnstile(page, 'pass');
});

test('turn on two-step sign-in with an authenticator app: scan, enter the app’s code, save the ten recovery codes', { tag: '@portal-selfservice.two-factor.enrol-app' }, async ({ page, step }) => {
  const email = address('tf-enrol');
  await operatorAccount(email, 'en', PASSWORD);
  await chooseLanguage(page, 'en');
  let secret = '';

  await step('Sign in, open You › Account: Two-step sign-in is off', async () => {
    await signInThroughForm(page, email, PASSWORD);
    await expect(page).toHaveURL(HOME);
    await openYou(page, 'account');
    await expect(youRow(page, 'Two-step sign-in')).toContainText(text('en', 'rowOff'));
  });
  await step('Press the row: the drawer offers the authenticator app (recommended) or a code by email', async () => {
    await youRow(page, 'Two-step sign-in').click();
    const drawer = page.getByRole('dialog', { name: 'Turn on two-step sign-in' });
    await expect(drawer.getByRole('radio', { name: /Authenticator app/ })).toBeChecked();
    await expect(drawer.getByRole('radio', { name: /Code by email/ })).toBeVisible();
  });
  await step('Type the current password and press Next: a QR code and the key appear', async () => {
    await page.getByLabel('Current password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Next' }).click();
    const drawer = page.getByRole('dialog', { name: 'Authenticator app' });
    await expect(drawer.getByRole('img', { name: text('en', 'qrAlt') })).toBeVisible();
    const key = drawer.locator('.hp-two-factor-secret');
    await expect(key).toBeVisible();
    secret = ((await key.textContent()) ?? '').replace(/\s/g, '');
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  });
  await step('Type the code the app shows and press Turn on: ten recovery codes appear', async () => {
    await page.getByLabel(text('en', 'appCodeLabel')).fill(appCode(secret, 0));
    await page.getByRole('button', { name: 'Turn on', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: 'Save your recovery codes' });
    await expect(drawer.getByRole('listitem')).toHaveCount(10);
    await expect(drawer.getByRole('listitem').first()).toHaveText(/^[a-z0-9]{4}-[a-z0-9]{4}$/);
  });
  await step('Done waits until you tick that you saved them; then it closes and says it is on', async () => {
    const done = page.getByRole('dialog', { name: 'Save your recovery codes' }).getByRole('button', { name: 'Done' }).last();
    await expect(done).toHaveAttribute('aria-disabled', 'true');
    await page.getByRole('checkbox', { name: text('en', 'saved') }).check();
    await done.click();
    await expect(page.getByText(text('en', 'onToast'))).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
  await step('The row now reads On · authenticator app, and still signed in', async () => {
    await expect(youRow(page, 'Two-step sign-in')).toContainText(text('en', 'rowOnApp'));
    await page.reload();
    await expect(youRow(page, 'Two-step sign-in')).toContainText(text('en', 'rowOnApp'));
  });
});

for (const language of ['en', 'ar'] as const) {
  test(`${language === 'en' ? 'English' : 'Arabic'}: with two-step on, a password sign-in asks for the code before anyone is signed in`, { tag: '@portal-selfservice.two-factor.sign-in' }, async ({ page, step }) => {
    const email = address(`tf-in-${language}`);
    await operatorAccount(email, language, PASSWORD);
    const { secret } = await enableTwoFactor(email, PASSWORD, 'totp');
    await chooseLanguage(page, language);

    await step('Type the email and password and press Sign in: the second step opens, not Home', async () => {
      await signInThroughForm(page, email, PASSWORD, language);
      await expect(page.getByRole('heading', { level: 1, name: text(language, 'title') })).toBeVisible();
      await expect(page.getByText(text(language, 'enterApp'))).toBeVisible();
      await expect(page).not.toHaveURL(HOME);
    });
    await step('A wrong code says how many tries are left', async () => {
      await page.getByLabel(text(language, 'code'), { exact: true }).fill('000000');
      await page.getByRole('button', { name: text(language, 'continue') }).click();
      await expect(page.getByRole('alert')).toHaveText(plural(language, 'wrong', language === 'ar' ? 'few' : 'other', 4));
    });
    await step('The app’s code signs you in on Home', async () => {
      await page.getByLabel(text(language, 'code'), { exact: true }).fill(appCode(secret!, 1));
      await page.getByRole('button', { name: text(language, 'continue') }).click();
      await expect(page).toHaveURL(HOME);
    });
    if (language === 'ar') {
      await step('The page reads right to left', async () => {
        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      });
    }
  });
}

test('a recovery code signs in once in place of the code, and the account shows one fewer', { tag: '@portal-selfservice.two-factor.recovery-code' }, async ({ page, step }) => {
  const email = address('tf-recovery');
  await operatorAccount(email, 'en', PASSWORD);
  const { recoveryCodes } = await enableTwoFactor(email, PASSWORD, 'totp');
  await chooseLanguage(page, 'en');

  await step('Sign in with the password, then press Use a recovery code instead', async () => {
    await signInThroughForm(page, email, PASSWORD);
    await expect(page.getByRole('heading', { level: 1, name: text('en', 'title') })).toBeVisible();
    await page.getByRole('button', { name: text('en', 'useRecovery') }).click();
  });
  await step('Type a recovery code: you are in, and told how many are left', async () => {
    await page.getByLabel(text('en', 'recoveryLabel')).fill(recoveryCodes[0]!);
    await page.getByRole('button', { name: text('en', 'continue') }).click();
    await expect(page).toHaveURL(HOME);
    await expect(page.getByText(plural('en', 'recoveryUsed', 'other', 9))).toBeVisible();
  });
  await step('You › Account › Two-step sign-in shows 9 of 10 left', async () => {
    await openYou(page, 'account');
    await youRow(page, 'Two-step sign-in').click();
    await expect(page.getByRole('dialog', { name: 'Two-step sign-in' })).toContainText('9 of 10 left');
  });
  await step('The same recovery code does not work a second time', async () => {
    await page.context().clearCookies();
    await signInThroughForm(page, email, PASSWORD);
    await page.getByRole('button', { name: text('en', 'useRecovery') }).click();
    await page.getByLabel(text('en', 'recoveryLabel')).fill(recoveryCodes[0]!);
    await page.getByRole('button', { name: text('en', 'continue') }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).not.toHaveURL(HOME);
  });
});

test('with the email method the code is mailed after the password; a new code can be sent; it signs in', { tag: '@portal-selfservice.two-factor.email' }, async ({ page, step }) => {
  const email = address('tf-email');
  await operatorAccount(email, 'en', PASSWORD);
  await enableTwoFactor(email, PASSWORD, 'email');
  await chooseLanguage(page, 'en');
  let first = '';

  await step('Sign in with the password: the second step says a code was emailed', async () => {
    await signInThroughForm(page, email, PASSWORD);
    await expect(page.getByRole('heading', { level: 1, name: text('en', 'title') })).toBeVisible();
    await expect(page.getByText(/We emailed a 6-digit code to /)).toBeVisible();
  });
  await step('The mail carries the code', async () => {
    const mails = await mailTo(email, 'two-factor-code');
    first = codeFromMail(mails);
    expect(mails.subject).toContain(first);
  });
  await step('The right code lands on Home', async () => {
    await page.getByLabel(text('en', 'code'), { exact: true }).fill(first);
    await page.getByRole('button', { name: text('en', 'continue') }).click();
    await expect(page).toHaveURL(HOME);
  });
});

test('a password reset asks for the second step before the new password is set', { tag: '@portal-selfservice.two-factor.reset' }, async ({ page, step }) => {
  const email = address('tf-reset');
  await operatorAccount(email, 'en', PASSWORD);
  const { recoveryCodes, secret } = await enableTwoFactor(email, PASSWORD, 'totp');
  await chooseLanguage(page, 'en');

  await step('Forgot your password?: ask for the link and open it', async () => {
    await page.goto('/sign-in');
    await page.getByRole('link', { name: 'Forgot your password?' }).click();
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send link' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Check your email' })).toBeVisible();
    await page.goto(setupLinkIn(await mailTo(email, 'reset-password')));
    await expect(page.getByRole('heading', { level: 1, name: 'Choose a new password' })).toBeVisible();
  });
  await step('The page first asks you to confirm it is you: a recovery code works for it', async () => {
    await expect(page.getByText(text('en', 'setupStep'))).toBeVisible();
    await page.getByRole('button', { name: text('en', 'useRecovery') }).click();
    await page.getByLabel(text('en', 'recoveryLabel')).fill(recoveryCodes[0]!);
  });
  await step('Choose the new password and Save and sign in', async () => {
    await page.getByLabel('New password').fill(NEW_PASSWORD);
    await page.getByRole('checkbox', { name: /terms of service/ }).check();
    await page.getByRole('button', { name: 'Save and sign in' }).click();
  });
  await step('Signing in with the new password still asks for the second step: the app’s code', async () => {
    await expect(page.getByRole('heading', { level: 1, name: text('en', 'title') })).toBeVisible();
    await page.getByLabel(text('en', 'code'), { exact: true }).fill(appCode(secret!, 1));
    await page.getByRole('button', { name: text('en', 'continue') }).click();
    await skipSetupPasskey(page);
    await expect(page).toHaveURL(HOME);
  });
});
