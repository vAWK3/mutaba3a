import type { Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { expectOnlyKnownAxeViolations } from '../../support/axe';
import { OFFICE_A, QA_TERMS_VERSION, office } from '../../support/portal';
import { FakeApi, type SetupLinkState, type StubSetupLink } from '../../support/portalApi';

/**
 * `/setup#<token>` (MUT-236): the page an operator-issued setup link opens
 * (ADR-088). The in-memory API answers the two public setup routes as the
 * server does (a valid link turns "used" once redeemed) and 401 to everything
 * else until the page signs in. No language is stored unless a test says so,
 * so the account's locale from the check decides (MUT-209).
 */

const TOKEN = 'k'.repeat(43);
const EMAIL = 'nour@office.ps';
const PASSWORD = 'a long enough passphrase';
const REDEEM = /^\/v1\/account-setup$/;

const seed = (setupLink: StubSetupLink) => new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], signedIn: false, setupLink });

async function openLink(page: Page, api: FakeApi, options: { language?: 'en' | 'ar'; chooseLanguage?: boolean; hash?: string } = {}) {
  // A fresh page load each time, as opening a link from a message is (a same-tab hash change is a unit test)
  await page.goto('about:blank');
  await api.open(page, `/setup${options.hash ?? `#${TOKEN}`}`, options.language ?? 'en', { chooseLanguage: options.chooseLanguage ?? false });
}

const LABELS = { en: { password: 'New password', submit: 'Save and sign in' }, ar: { password: 'كلمة المرور الجديدة', submit: 'احفظ وسجّل الدخول' } };

async function typeAndSave(page: Page, password: string, language: 'en' | 'ar' = 'en') {
  await page.getByLabel(LABELS[language].password).fill(password);
  // MUT-324: saving needs the terms ticked (check() leaves an already-ticked box alone)
  await page.getByRole('checkbox', { name: /terms of service|شروط الخدمة/ }).check();
  await page.getByRole('button', { name: LABELS[language].submit }).click();
}

test('A valid setup link opens in the account’s language, sets the password and lands signed in on Home', { tag: '@portal.setup.set-password' }, async ({ page, step }) => {
  const api = seed({ state: 'valid', email: EMAIL, locale: 'en' });

  await step('Open the setup link for an English account, with no language chosen', async () => {
    await openLink(page, api);
    await expect(page.getByRole('heading', { level: 1, name: 'Set your password' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page).toHaveURL(/\/setup$/);
    expect(api.last('POST', /^\/v1\/account-setup\/check$/)?.body).toEqual({ token: TOKEN });
  });

  await step('The email shows read-only above the new-password field', async () => {
    const account = page.getByLabel('Account');
    await expect(account).toHaveValue(EMAIL);
    await expect(account).not.toBeEditable();
    await expect(page.getByLabel('New password')).toHaveAttribute('autocomplete', 'new-password');
  });

  await step('The form passes axe, as sign-in does', async () => {
    await expectOnlyKnownAxeViolations(page, 'portalSignIn');
  });

  await step('Type a new password and save', async () => {
    await typeAndSave(page, PASSWORD);
  });

  await step('Signed in with it, on the first profile’s Overview', async () => {
    await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_A}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    // MUT-324: the terms version the check named, in the page's language, travel with the password
    expect(api.last('POST', REDEEM)?.body).toEqual({ token: TOKEN, password: PASSWORD, acceptedTermsVersion: QA_TERMS_VERSION, termsLocale: 'en' });
    expect(api.last('POST', /^\/v1\/sessions$/)?.body).toEqual({ email: EMAIL, password: PASSWORD });
  });
});

test('An Arabic account’s setup link opens in Arabic, right to left, and lands signed in', { tag: '@portal.setup.set-password' }, async ({ page, step }) => {
  const api = seed({ state: 'valid', email: EMAIL, locale: 'ar' });

  await step('Open the setup link for an Arabic account', async () => {
    await openLink(page, api, { language: 'ar' });
    await expect(page.getByRole('heading', { level: 1, name: 'اختر كلمة المرور' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page).toHaveURL(/\/setup$/);
  });

  await step('Type a new password and save', async () => {
    await typeAndSave(page, PASSWORD, 'ar');
  });

  await step('Signed in, on the first profile', async () => {
    await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_A}$`));
    expect(api.last('POST', /^\/v1\/sessions$/)?.body).toEqual({ email: EMAIL, password: PASSWORD });
  });
});

const REFUSED: [SetupLinkState, string][] = [
  ['expired', 'This link has expired'],
  ['used', 'This link has been used'],
  ['superseded', 'A newer link replaced this one'],
  ['invalid', "This link doesn't work"],
];

test('A link that can’t be used says why, in its own words, and shows no password form', { tag: '@portal.setup.refused-links' }, async ({ page, step }) => {
  // First, while this browser holds no language choice: the page can't know the account, so Arabic (MUT-209)
  await step('An expired link opens in Arabic, right to left', async () => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await openLink(page, seed({ state: 'expired' }));
    await expect(page.getByRole('heading', { level: 1, name: 'انتهت صلاحية هذا الرابط' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByLabel('كلمة المرور الجديدة')).toHaveCount(0);
  });

  for (const [state, heading] of REFUSED) {
    await step(`Open a ${state} setup link`, async () => {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await openLink(page, seed({ state }), { chooseLanguage: true });
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expect(page.getByLabel('New password')).toHaveCount(0);
      if (state === 'used') await expect(page.getByRole('link', { name: 'Go to sign in' })).toBeVisible();
    });
  }

  await step('Open a setup link with nothing after the #', async () => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    const api = seed({ state: 'valid' });
    await openLink(page, api, { chooseLanguage: true, hash: '' });
    await expect(page.getByRole('heading', { level: 1, name: 'This link is incomplete' })).toBeVisible();
    expect(api.calls('POST', /^\/v1\/account-setup/)).toHaveLength(0);
  });

});

test('A password under 12 characters is refused under the field, and nothing is sent', { tag: '@portal.setup.password-rule' }, async ({ page, step }) => {
  const api = seed({ state: 'valid', email: EMAIL, locale: 'en' });

  await step('Open a valid setup link', async () => {
    await openLink(page, api);
    await expect(page.getByText('Use 12 to 128 characters.')).toBeVisible();
  });

  await step('Type an 11-character password and save', async () => {
    await typeAndSave(page, 'a'.repeat(11));
  });

  await step('The field says why, and nothing reached the server', async () => {
    await expect(page.getByText('Use at least 12 characters.')).toBeVisible();
    await expect(page.getByLabel('New password')).toHaveAttribute('aria-invalid', 'true');
    expect(api.calls('POST', REDEEM)).toHaveLength(0);
  });
});

test('A save whose answer was lost but went through signs in on the retry, not "link used"', { tag: '@portal.setup.answer-lost' }, async ({ page, step }) => {
  const api = seed({ state: 'valid', email: EMAIL, locale: 'en' });

  await step('Open a valid setup link', async () => {
    await openLink(page, api);
    await expect(page.getByRole('heading', { level: 1, name: 'Set your password' })).toBeVisible();
  });

  await step('Save while the connection drops after the server set the password', async () => {
    api.once('POST', REDEEM, 'abort');
    await typeAndSave(page, PASSWORD);
    await expect(page.getByRole('alert')).toContainText("Couldn't reach Mutaba3a");
    await expect(page.getByLabel('New password')).toHaveValue(PASSWORD);
    api.markSetupLink('used');
  });

  await step('Save again: signed in with the typed password, on Overview', async () => {
    await page.getByRole('button', { name: 'Save and sign in' }).click();
    await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_A}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    expect(api.last('POST', /^\/v1\/sessions$/)?.body).toEqual({ email: EMAIL, password: PASSWORD });
  });
});
