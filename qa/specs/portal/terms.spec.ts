import type { Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { OFFICE_A, QA_TERMS_VERSION, office } from '../../support/portal';
import { FakeApi } from '../../support/portalApi';

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

  await step('Tick and save: the version and language go with the password, and Overview opens', async () => {
    await terms(page).check();
    await page.getByRole('button', { name: 'Save and sign in' }).click();
    await expect(page).toHaveURL(new RegExp(`/p/${OFFICE_A}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    expect(api.last('POST', /^\/v1\/account-setup$/)?.body).toMatchObject({ acceptedTermsVersion: QA_TERMS_VERSION, termsLocale: 'en' });
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

  await step('I agree: the version is recorded in English, the language the link opened, and Overview opens', async () => {
    await page.getByRole('button', { name: 'I agree' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    expect(api.last('POST', /^\/v1\/me\/terms-acceptance$/)?.body).toEqual({ version: QA_TERMS_VERSION, locale: 'en' });
  });

  await step('Reload: the step doesn’t come back', async () => {
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: "We've updated our terms" })).toHaveCount(0);
  });
});

test('the account menu and the sign-in page link the terms of service', { tag: '@portal.terms.links' }, async ({ page, step }) => {
  await step('The account menu links the terms in a new tab', async () => {
    const api = new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')] });
    await api.open(page, `/p/${OFFICE_A}`, 'en');
    await page.getByRole('button', { name: /^Account/ }).click();
    const item = page.getByRole('menu', { name: 'Account' }).getByRole('menuitem', { name: 'Terms of service' });
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
