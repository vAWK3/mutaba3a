import type { Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { MODE_KEY, OFFICE_A, office } from '../../support/portal';
import { FakeApi, apiError } from '../../support/portalApi';
import type { CrashReportSpy, SentErrorEvent } from '../../support/sentry';

/**
 * The portal's crash reports and crash screens (MUT-149, ADR-091 am.11). The
 * QA build carries a dummy DSN on the org's ingest host (qa.config.mjs) and
 * qa/support/sentry.ts answers every Sentry host locally, so these specs read
 * exactly what the portal would send, and nothing leaves. The scrubber's every
 * rule is unit-tested; this proves the real build wires it, signed in only.
 */

/** The address the fake account signs in with (qa/support/portal.ts meBody). */
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.(ps|com|test|example)\b/;
const CRASH = { en: 'This page stopped working', ar: 'توقفت هذه الصفحة عن العمل' };
const RELOAD = { en: 'Reload', ar: 'إعادة التحميل' };
const SECTIONS = { en: 'Sections', ar: 'الأقسام' };
/** PORTAL_LANGUAGE_KEY in src/hosted/i18n/HostedLanguageProvider.tsx */
const PORTAL_LANGUAGE_KEY = 'mutaba3a-portal-language';

const seed = () => new FakeApi({ profiles: [office(OFFICE_A, 'Nour Studio')], clients: 1 });

/** Throws outside React and outside any promise chain: what a bug in an event handler or timer looks like. */
async function throwUncaught(page: Page, message: string) {
  await page.evaluate((text) => {
    setTimeout(() => {
      throw new Error(text);
    }, 0);
  }, message);
}

async function oneReport(crashReports: CrashReportSpy, message: string): Promise<SentErrorEvent> {
  const matching = () => crashReports.events().filter((event) => event.exception?.values?.some((value) => value.value?.includes(message)));
  await expect.poll(() => matching().length, { timeout: 15_000 }).toBe(1);
  return matching()[0];
}

async function openClients(page: Page, api: FakeApi, language: 'en' | 'ar') {
  await api.open(page, `/p/${OFFICE_A}/clients`, language);
  await expect(page.getByRole('navigation', { name: SECTIONS[language] })).toBeVisible();
}

test('a crash on a signed-in page is reported once, by user id only, with path-only URLs', { tag: '@portal.error-reports.crash-reported' }, async ({ page, step, crashReports }) => {
  const api = seed();

  await step('Sign in in English and open Clients', async () => {
    await openClients(page, api, 'en');
    await expect(page.getByRole('heading', { level: 1, name: 'Clients' })).toBeVisible();
  });

  await step('Something on the page throws an error nobody catches', async () => {
    await throwUncaught(page, 'QA uncaught crash (en)');
  });

  await step('One report is sent, tagged portal and English, naming the user by internal id only', async () => {
    const event = await oneReport(crashReports, 'QA uncaught crash (en)');
    expect(event.tags).toMatchObject({ surface: 'portal', locale: 'en' });
    expect(Object.keys(event.user ?? {})).toEqual(['id']);
    expect(event.user?.id).toBe(api.me().user.id);
    expect(event.request?.url).not.toMatch(/[?#]/);
    for (const text of crashReports.raw()) expect(text).not.toMatch(EMAIL_PATTERN);
  });
});

test('the same crash in Arabic is reported the same way, tagged Arabic', { tag: '@portal.error-reports.crash-reported-ar' }, async ({ page, step, crashReports }) => {
  const api = seed();

  await step('Sign in in Arabic and open Clients', async () => {
    await openClients(page, api, 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });

  await step('Something on the page throws an error nobody catches', async () => {
    await throwUncaught(page, 'QA uncaught crash (ar)');
  });

  await step('One report is sent, tagged ar, with the internal user id only', async () => {
    const event = await oneReport(crashReports, 'QA uncaught crash (ar)');
    expect(event.tags).toMatchObject({ surface: 'portal', locale: 'ar' });
    expect(Object.keys(event.user ?? {})).toEqual(['id']);
  });
});

test('a save the server refuses shows the error in the form and sends no report', { tag: '@portal.error-reports.handled-api-error-not-reported' }, async ({ page, step, crashReports }) => {
  const api = seed();
  const drawer = page.getByRole('dialog', { name: 'New income' });

  await step('Sign in, open Payments and choose + Add income', async () => {
    await api.open(page, `/p/${OFFICE_A}/payments`);
    await page.locator('[data-income-add]').click();
    await expect(drawer).toBeVisible();
  });

  await step('Save an income the server refuses (422): the drawer says why and stays open', async () => {
    await drawer.getByLabel('Amount').fill('1,200');
    await drawer.getByRole('button', { name: /More details/ }).click();
    await drawer.getByLabel('Date').fill('2001-03-04');
    api.once('POST', /^\/v1\/income$/, apiError(422, 'VALIDATION_FAILED', { reason: 'DATE_INVALID', field: 'occurredOn', bound: 'past' }));
    await drawer.getByRole('button', { name: 'Save income' }).click();
    await expect(drawer.getByText("The date can't be more than ten years ago")).toBeVisible();
    await expect(drawer).toBeVisible();
  });

  await step('No error report is sent', async () => {
    await page.waitForTimeout(3_000);
    expect(crashReports.events()).toEqual([]);
  });
});

test('signed out, a crash sends nothing and the reporting code never loads', { tag: '@portal.error-reports.signed-out-silent' }, async ({ page, step, crashReports }) => {
  const chunkRequests: string[] = [];
  page.on('request', (request) => {
    if (/portalSentry|@sentry/.test(request.url())) chunkRequests.push(request.url());
  });

  await step("Open the portal signed out, on this device's records, and go to Payments", async () => {
    await page.context().route('**/v1/**', (route) =>
      route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Sign in' } }) }),
    );
    // Signed out on this device, in English (the portal opens in Arabic until someone chooses, ADR-077)
    await page.addInitScript(
      ([mode, language]) => {
        localStorage.setItem(mode, 'local');
        localStorage.setItem(language, 'en');
      },
      [MODE_KEY, PORTAL_LANGUAGE_KEY] as const,
    );
    await page.goto('/');
    const sections = page.getByRole('navigation', { name: 'Sections' });
    await expect(sections).toBeVisible();
    await sections.getByRole('link', { name: 'Paid' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Paid' })).toBeVisible();
  });

  await step('Something on the page throws an error nobody catches', async () => {
    await throwUncaught(page, 'QA signed-out crash');
    await page.waitForTimeout(3_000);
  });

  await step('Not a single request goes to Sentry, and the crash-reporting module never downloads', async () => {
    expect(crashReports.requestCount()).toBe(0);
    expect(chunkRequests).toEqual([]);
  });
});

test('a page that crashes shows a translated card in its place; the navigation stays and leaving clears it', { tag: '@portal.error-reports.crash-screen' }, async ({ page, step, crashReports }) => {
  const api = seed();
  const card = page.getByRole('alert').filter({ has: page.getByRole('heading', { name: CRASH.ar }) });

  await step('Sign in in Arabic; the server sends Clients a broken answer, and the page crashes', async () => {
    api.once('GET', /^\/v1\/summaries\/organization$/, { status: 200, body: { asOf: '2026-10-23', currencies: null } });
    await api.open(page, `/p/${OFFICE_A}/clients`, 'ar');
    await expect(card).toBeVisible();
    await expect(card.getByRole('button')).toHaveCount(1);
    await expect(card.getByRole('button', { name: RELOAD.ar })).toBeVisible();
    await expect(page.getByRole('navigation', { name: SECTIONS.ar })).toBeVisible();
    await expect(page.getByText(/is not iterable|Cannot read/)).toHaveCount(0);
  });

  await step('Focus starts on the card title; Tab reaches Reload', async () => {
    await expect(card.getByRole('heading', { name: CRASH.ar })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(card.getByRole('button', { name: RELOAD.ar })).toBeFocused();
  });

  await step('The crash is reported once', async () => {
    await expect.poll(() => crashReports.events().length, { timeout: 15_000 }).toBe(1);
  });

  await step('Go to Paid: it opens normally', async () => {
    await page.getByRole('navigation', { name: SECTIONS.ar }).getByRole('link', { name: 'المدفوع' }).click();
    await expect(card).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'المدفوع' })).toBeVisible();
  });
});
