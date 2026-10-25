import type { Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { OFFICE_A, QA_CLIENT_RELEASE, QA_TERMS_VERSION, office } from '../../support/portal';
import { FakeApi } from '../../support/portalApi';
import { openYou } from '../../support/you';

/**
 * MUT-324 (ADR-102): accepting the terms on the portal. The in-memory API
 * answers as the server does: the setup check names the version, the redeem
 * refuses another, and /v1/me says whether the person is behind.
 */
const TOKEN = 'k'.repeat(43);
const EMAIL = 'nour@office.ps';
const PASSWORD = 'a long enough passphrase';
const terms = (page: Page) => page.getByRole('checkbox', { name: /terms of service/ });

test('a setup link can’t be finished without agreeing to the terms, and the save records the version', { tag: '@portal.terms.setup-requires-accept' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], signedIn: false, setupLink: { state: 'valid', email: EMAIL, locale: 'en' } });

  await step('Open the setup link: the terms tick links the exact version in the page language, in a new tab', async () => {
    await api.open(page, `/setup#${TOKEN}`, 'en', { chooseLanguage: false });
    await expect(page.getByLabel('New password')).toBeVisible();
    const link = page.getByRole('link', { name: 'terms of service' });
    await expect(link).toHaveAttribute('href', new RegExp(`/terms/${QA_TERMS_VERSION}\\?lang=en$`));
    await expect(link).toHaveAttribute('target', '_blank');
  });

  await step('Save without ticking: the page asks to agree and sends nothing', async () => {
    await page.getByLabel('New password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Save and sign in' }).click();
    await expect(page.getByText('Tick to agree to the terms before you continue.')).toBeVisible();
    expect(api.calls('POST', /^\/v1\/account-setup$/)).toHaveLength(0);
  });

  await step('Tick and save: the version, language and web release go with the password, and Overview opens', async () => {
    await terms(page).check();
    await page.getByRole('button', { name: 'Save and sign in' }).click();
    await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_A}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Owed' })).toBeVisible();
    expect(api.last('POST', /^\/v1\/account-setup$/)?.body).toMatchObject({ acceptedTermsVersion: QA_TERMS_VERSION, termsLocale: 'en', clientRelease: expect.stringMatching(QA_CLIENT_RELEASE) });
  });
});

test('switching the setup page’s language clears the terms tick, so the agreement follows a read in the recorded language', { tag: '@portal.terms.language-switch-clears-tick' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], signedIn: false, setupLink: { state: 'valid', email: EMAIL, locale: 'en' } });

  await step('Open the setup link in English, type a password and tick the terms', async () => {
    await api.open(page, `/setup#${TOKEN}`, 'en', { chooseLanguage: false });
    await page.getByLabel('New password').fill(PASSWORD);
    await terms(page).check();
  });

  await step('Switch to Arabic: the tick is cleared and the link now opens the Arabic text', async () => {
    await page.getByRole('button', { name: 'عربي' }).click();
    const tick = page.getByRole('checkbox', { name: /شروط الخدمة/ });
    await expect(tick).not.toBeChecked();
    await expect(page.getByRole('link', { name: 'شروط الخدمة' })).toHaveAttribute('href', new RegExp(`/terms/${QA_TERMS_VERSION}\\?lang=ar$`));
  });

  await step('Tick again and save: Arabic is recorded', async () => {
    await page.getByRole('checkbox', { name: /شروط الخدمة/ }).check();
    await page.getByRole('button', { name: 'احفظ وسجّل الدخول' }).click();
    await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_A}$`));
    expect(api.last('POST', /^\/v1\/account-setup$/)?.body).toMatchObject({ acceptedTermsVersion: QA_TERMS_VERSION, termsLocale: 'ar', clientRelease: expect.stringMatching(QA_CLIENT_RELEASE) });
  });
});

test('someone behind on the terms agrees once on the Updated-terms step, then works as usual', { tag: '@portal.terms.updated-terms-step' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], termsAccepted: false });

  await step('Open the portal: the Updated-terms step stands before everything', async () => {
    await api.open(page, `/p/${OFFICE_A}`, 'en');
    await expect(page.getByRole('heading', { level: 1, name: "We've updated our terms" })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Read the terms' })).toHaveAttribute('href', new RegExp(`/terms/${QA_TERMS_VERSION}\\?lang=en$`));
    await expect(page.getByText(/info@malafat\.app/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await expect(page.getByRole('navigation')).toHaveCount(0);
  });

  await step('I agree: the version is recorded in English, the language the link opened, with the web release, and Overview opens', async () => {
    await page.getByRole('button', { name: 'I agree' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Owed' })).toBeVisible();
    expect(api.last('POST', /^\/v1\/me\/terms-acceptance$/)?.body).toEqual({ version: QA_TERMS_VERSION, locale: 'en', clientRelease: expect.stringMatching(QA_CLIENT_RELEASE) });
  });

  await step('Reload: the step doesn’t come back', async () => {
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Owed' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: "We've updated our terms" })).toHaveCount(0);
  });
});

test('when the terms change again while the step is open, the step says so and the retry accepts the new version', { tag: '@portal.terms.changed-mid-step' }, async ({ page, step }) => {
  const NEWER = '2027-01-01';
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], termsAccepted: false });

  await step('Open the portal behind on the terms, then a release names newer terms', async () => {
    await api.open(page, `/p/${OFFICE_A}`, 'en');
    await expect(page.getByRole('heading', { level: 1, name: "We've updated our terms" })).toBeVisible();
    api.bumpTerms(NEWER);
  });

  await step('I agree: the step says the terms changed and links the new version', async () => {
    await page.getByRole('button', { name: 'I agree' }).click();
    await expect(page.getByRole('alert')).toContainText('The terms changed while this page was open');
    await expect(page.getByRole('link', { name: 'Read the terms' })).toHaveAttribute('href', new RegExp(`/terms/${NEWER}\\?lang=en$`));
  });

  await step('I agree again: the new version is recorded and Overview opens', async () => {
    await page.getByRole('button', { name: 'I agree' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Owed' })).toBeVisible();
    expect(api.last('POST', /^\/v1\/me\/terms-acceptance$/)?.body).toEqual({ version: NEWER, locale: 'en', clientRelease: expect.stringMatching(QA_CLIENT_RELEASE) });
  });
});

test('Sign out on the Updated-terms step signs out without accepting', { tag: '@portal.terms.step-sign-out' }, async ({ page, step }) => {
  const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], termsAccepted: false });

  await step('Open the portal behind on the terms', async () => {
    await api.open(page, `/p/${OFFICE_A}`, 'en');
    await expect(page.getByRole('heading', { level: 1, name: "We've updated our terms" })).toBeVisible();
  });

  await step('Sign out: the session ends, nothing is accepted, and the step is gone', async () => {
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { level: 1, name: "We've updated our terms" })).toHaveCount(0);
    expect(api.calls('DELETE', /^\/v1\/sessions\/current$/)).toHaveLength(1);
    expect(api.calls('POST', /^\/v1\/me\/terms-acceptance$/)).toHaveLength(0);
  });
});

test('You › App and the sign-in page link the terms of service', { tag: '@portal.terms.links' }, async ({ page, step }) => {
  await step('You › App links the terms in a new tab', async () => {
    const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')] });
    await api.open(page, `/p/${OFFICE_A}`, 'en');
    await openYou(page, 'app');
    const item = page.getByRole('main').getByRole('link', { name: /^Terms of service/ });
    await expect(item).toHaveAttribute('href', /\/terms\?lang=en$/);
    await expect(item).toHaveAttribute('target', '_blank');
  });

  await step('The sign-in page links the terms', async () => {
    const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], signedIn: false });
    await page.goto('about:blank');
    await api.open(page, '/sign-in', 'en');
    await expect(page.getByRole('link', { name: 'Terms of service' })).toHaveAttribute('href', /\/terms\?lang=en$/);
  });
});
