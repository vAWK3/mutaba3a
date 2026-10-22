import type { Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { expectNoHorizontalOverflow } from '../../support/brand';
import { chooseLanguageScript, LANGUAGE_KEYS, en as enCopy, ar as arCopy } from '../../support/i18n';
import { readFileSync } from 'node:fs';

interface TermsText {
  title: string;
  updated: string;
  sections: Array<{ title: string }>;
}
/** Read from disk: Playwright loads specs as plain ES modules, which import JSON only with an attribute. */
const text = (language: 'en' | 'ar'): TermsText =>
  JSON.parse(readFileSync(new URL(`../../../src/content/legal/terms/2026-10-19.${language}.json`, import.meta.url), 'utf8')) as TermsText;
const en = text('en');
const ar = text('ar');
/** The privacy policy's copy, from the app's own translation files, so a copy change needs no spec change. */
const privacy = { en: enCopy.landing.privacyPolicy, ar: arCopy.landing.privacyPolicy };

/**
 * MUT-324 (ADR-102): the terms of service and the privacy policy's hosted
 * accounts section, in a real browser on the web build: routing through the
 * Netlify-style SPA fallback, the on-demand text, RTL and the 375px layout.
 */
async function preferLanguage(page: Page, language: 'en' | 'ar') {
  await page.addInitScript(chooseLanguageScript, [LANGUAGE_KEYS, language] as [typeof LANGUAGE_KEYS, 'en' | 'ar']);
}

test('/terms shows the frozen terms in English and Arabic, each version at its own address', { tag: '@web.legal.terms-page' }, async ({ page, step }) => {
  await step('Open /terms in English: every section, the version line, and the English text prevails', async () => {
    await preferLanguage(page, 'en');
    await page.goto('/terms');
    await expect(page.getByRole('heading', { level: 2, name: en.sections[0]!.title })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: en.title })).toBeVisible();
    for (const section of en.sections) await expect(page.getByRole('heading', { level: 2, name: section.title })).toBeVisible();
    await expect(page.getByText(en.updated)).toBeVisible();
    await expect(page.getByRole('main')).toContainText('English text prevails');
  });

  await step('Open /terms/2026-10-19: the same frozen text', async () => {
    await page.goto('/terms/2026-10-19');
    await expect(page.getByRole('heading', { level: 2, name: en.sections[0]!.title })).toBeVisible();
  });

  await step('Open an unknown version: it says so and links to the current terms', async () => {
    await page.goto('/terms/2001-01-01');
    await expect(page.getByRole('heading', { level: 1, name: /doesn.t exist/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'the current terms' })).toHaveAttribute('href', '/terms');
  });

  await step('In Arabic at phone width: right to left, every section, nothing scrolls sideways', async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await preferLanguage(page, 'ar');
    await page.goto('/terms');
    await expect(page.getByRole('heading', { level: 2, name: ar.sections[0]!.title })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    for (const section of ar.sections) await expect(page.getByRole('heading', { level: 2, name: section.title })).toBeVisible();
    await expectNoHorizontalOverflow(page, '/terms in Arabic at 375px');
  });
});

test('a portal link opens the terms in the language the portal records, without changing the site language', { tag: '@web.legal.terms-linked-language' }, async ({ page, step }) => {
  await step('With the site in Arabic, open /terms/2026-10-19?lang=en: the English text, left to right', async () => {
    await preferLanguage(page, 'ar');
    await page.goto('/terms/2026-10-19?lang=en');
    const title = page.getByRole('heading', { level: 1, name: en.title });
    await expect(title).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: en.sections[0]!.title })).toBeVisible();
    const text = title.locator('xpath=..');
    await expect(text).toHaveAttribute('lang', 'en');
    await expect(text).toHaveAttribute('dir', 'ltr');
  });

  await step('Open /terms without ?lang: the site is still in Arabic', async () => {
    await page.goto('/terms');
    await expect(page.getByRole('heading', { level: 1, name: ar.title })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });
});

test('a link from the phone or the portal opens the privacy policy in its language, without changing the site language', { tag: '@web.legal.privacy-linked-language' }, async ({ page, step }) => {
  /** The element that carries the policy's own language and direction. */
  const policy = (title: string) => page.getByRole('heading', { level: 1, name: title }).locator('xpath=..');

  await step('With the site in Arabic, open /privacy?lang=en: the English policy, left to right', async () => {
    await preferLanguage(page, 'ar');
    await page.goto('/privacy?lang=en');
    await expect(page.getByRole('heading', { level: 2, name: privacy.en.hostedAccounts.title })).toBeVisible();
    await expect(policy(privacy.en.title)).toHaveAttribute('lang', 'en');
    await expect(policy(privacy.en.title)).toHaveAttribute('dir', 'ltr');
  });

  await step('Open /privacy without ?lang: the site is still in Arabic', async () => {
    await page.goto('/privacy');
    await expect(page.getByRole('heading', { level: 1, name: privacy.ar.title })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });

  await step('With the site in English, open /privacy?lang=ar: the Arabic policy, right to left; the site stays in English', async () => {
    await preferLanguage(page, 'en');
    await page.goto('/privacy?lang=ar');
    await expect(policy(privacy.ar.title)).toHaveAttribute('lang', 'ar');
    await expect(policy(privacy.ar.title)).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  });

  await step('Open /privacy?lang=fr: the site language', async () => {
    await page.goto('/privacy?lang=fr');
    await expect(page.getByRole('heading', { level: 1, name: privacy.en.title })).toBeVisible();
    await expect(policy(privacy.en.title)).not.toHaveAttribute('lang', /./);
  });
});

test('the privacy policy says our servers and the phone apps send error reports, and what they never hold', { tag: '@web.legal.privacy-error-reports' }, async ({ page, step }) => {
  const section = (title: string) => page.locator('section', { has: page.getByRole('heading', { level: 2, name: title }) });

  await step('Open the privacy policy in English: an Error reports section right after Anonymous usage counts', async () => {
    await preferLanguage(page, 'en');
    await page.goto('/privacy');
    await expect(page.getByRole('heading', { level: 2, name: privacy.en.errorReports.title })).toBeVisible();
    const headings = await page.getByRole('heading', { level: 2 }).allTextContents();
    expect(headings.indexOf(privacy.en.errorReports.title)).toBe(headings.indexOf(privacy.en.usageAnalytics.title) + 1);
    const reports = section(privacy.en.errorReports.title);
    await expect(reports).toContainText('It never includes amounts, names, notes, contact details, request contents, your IP address, or anything you type');
    await expect(reports).toContainText('Our servers send a report when a request fails on our side');
    await expect(reports).toContainText("The iPhone and Android apps send a report when the app crashes or hits an error it can't recover from");
    await expect(reports).toContainText("They never attach screenshots or what's on your screen");
    await expect(reports).not.toContainText(/hosted portal sends|Our website sends/);
  });

  await step('"No ads, no tracking" drops the no-crash-reporting promise; "Who else handles your data" names Sentry in the EU', async () => {
    const noTracking = section(privacy.en.noTracking.title);
    await expect(noTracking).not.toContainText('crash reporting');
    await expect(noTracking).toContainText('The free apps on Mac, Windows, and in the browser never send them');
    await expect(section(privacy.en.sharing.title)).toContainText('Sentry, hosted in the EU, receives the error reports');
    await expect(section(privacy.en.network.title)).toContainText("The mobile apps connect to Mutaba3a's servers, to Sentry for error reports");
  });

  await step('Open it in Arabic: the same section, right to left', async () => {
    await preferLanguage(page, 'ar');
    await page.goto('/privacy');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(section(privacy.ar.errorReports.title)).toContainText('ترسل خوادمنا تقريرًا عندما يفشل طلب بسبب خلل من جهتنا');
    await expect(section(privacy.ar.errorReports.title)).toContainText('ويرسل تطبيقا iPhone وAndroid تقريرًا عندما يتعطّل التطبيق');
    await expect(section(privacy.ar.noTracking.title)).toContainText('فلا ترسلها أبدًا');
  });
});

test('the terms are linked from the footer and the /hosted form, and the privacy policy explains hosted accounts', { tag: '@web.legal.links' }, async ({ page, step }) => {
  await step('The privacy policy has a hosted-accounts section and its footer links the terms', async () => {
    await preferLanguage(page, 'en');
    await page.goto('/privacy');
    const heading = page.getByRole('heading', { level: 2, name: privacy.en.hostedAccounts.title });
    await expect(heading).toBeVisible();
    const section = page.locator('section', { has: heading });
    for (const fact of ['me-west1', '14 days', 'the last 7 days', 'Sentry', 'PostHog', '30 days']) await expect(section).toContainText(fact);
    await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
  });

  await step('The /hosted request form links the terms of service under its button', async () => {
    await page.goto('/hosted');
    await expect(page.locator('.hosted-notice').getByRole('link', { name: 'Terms of service' })).toHaveAttribute('href', '/terms');
  });
});

test('the website publishes the list of released terms versions', { tag: '@web.legal.terms-manifest' }, async ({ page, step }) => {
  await step('Fetch /legal/terms-versions.json: 2026-10-19 with an English and an Arabic sha256', async () => {
    const res = await page.request.get('/legal/terms-versions.json');
    expect(res.ok()).toBe(true);
    const manifest = (await res.json()) as { versions: Array<{ version: string; sha256: Record<string, string> }> };
    const current = manifest.versions.find((v) => v.version === '2026-10-19');
    expect(current?.sha256.en).toMatch(/^[0-9a-f]{64}$/);
    expect(current?.sha256.ar).toMatch(/^[0-9a-f]{64}$/);
  });
});
