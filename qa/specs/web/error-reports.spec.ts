import type { Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import type { CrashReportSpy, SentErrorEvent } from '../../support/sentry';
import { chooseLanguageScript, LANGUAGE_KEYS, ar as arCopy } from '../../support/i18n';
import { logIncome } from '../../support/app';

/**
 * MUT-150 (ADR-091): the website's pages report errors to Sentry, and the
 * local app at /app never does (ADR-024). The QA web server carries a dummy
 * DSN on the org's ingest host (qa.config.mjs), and qa/support/sentry.ts
 * answers every Sentry request, so nothing a run does reaches Sentry.
 */

/** How long the SDK may take to arrive: after load, then idle (afterLoadIdle's 1.5 s fallback), then the chunk. */
const SDK_WAIT_MS = 15_000;

async function preferLanguage(page: Page, language: 'en' | 'ar') {
  await page.addInitScript(chooseLanguageScript, [LANGUAGE_KEYS, language] as const);
}

/** Throws outside React and outside any promise chain: what a bug in an event handler or timer looks like. */
async function throwUncaught(page: Page, message: string) {
  await page.evaluate((text) => {
    setTimeout(() => {
      throw new Error(text);
    }, 0);
  }, message);
}

const withMessage = (crashReports: CrashReportSpy, message: string) =>
  crashReports.events().filter((event) => event.exception?.values?.some((value) => value.value?.includes(message)));

/** One report, and still one once the page's network has gone quiet: a late duplicate fails it (review D1). */
async function oneReport(page: Page, crashReports: CrashReportSpy, message: string): Promise<SentErrorEvent> {
  await expect.poll(() => withMessage(crashReports, message).length, { timeout: SDK_WAIT_MS }).toBe(1);
  await page.waitForLoadState('networkidle');
  expect(withMessage(crashReports, message)).toHaveLength(1);
  return withMessage(crashReports, message)[0];
}

/** The landing's Sentry code, as the dev server or a build serves it: any request for it from /app is the leak. */
const SENTRY_CODE = /landingSentry|vendor-sentry|sentry_browser|@sentry\//;

test('an error on the home page is reported once: the landing, its route and language, no account', { tag: '@web.error-reports.landing-crash-reported' }, async ({ page, step, crashReports }) => {
  await step('Open the home page in English', async () => {
    await preferLanguage(page, 'en');
    await page.goto('/?utm_source=qa');
    await expect(page.getByRole('main')).toBeVisible();
  });

  await step('Something on the page throws an error nobody catches', async () => {
    await throwUncaught(page, 'MUT-150 QA home');
  });

  await step('Exactly one report: surface landing, route /, English, no user, and the address without its query', async () => {
    const event = await oneReport(page, crashReports, 'MUT-150 QA home');
    expect(event.tags).toMatchObject({ surface: 'landing', route: '/', locale: 'en' });
    expect(event.user).toBeUndefined();
    expect(event.request?.url).not.toContain('utm_source');
  });
});

test('an error on the Arabic privacy page is reported with the Arabic language', { tag: '@web.error-reports.landing-crash-reported-ar' }, async ({ page, step, crashReports }) => {
  await step('Open the privacy policy in Arabic', async () => {
    await preferLanguage(page, 'ar');
    await page.goto('/privacy');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });

  await step('Something on the page throws an error nobody catches', async () => {
    await throwUncaught(page, 'MUT-150 QA privacy');
  });

  await step('One report, tagged Arabic and /privacy', async () => {
    const event = await oneReport(page, crashReports, 'MUT-150 QA privacy');
    expect(event.tags).toMatchObject({ surface: 'landing', route: '/privacy', locale: 'ar' });
  });
});

test('errors on the download page and on a frozen terms version are reported, the version never in the route', { tag: '@web.error-reports.download-and-terms-covered' }, async ({ page, step, crashReports }) => {
  await preferLanguage(page, 'en');

  await step('Open the download page; something throws', async () => {
    await page.goto('/download');
    await throwUncaught(page, 'MUT-150 QA download');
  });

  await step('One report with route /download', async () => {
    expect((await oneReport(page, crashReports, 'MUT-150 QA download')).tags).toMatchObject({ route: '/download' });
  });

  await step('Open the terms at /terms/2026-10-19; something throws', async () => {
    await page.goto('/terms/2026-10-19');
    await throwUncaught(page, 'MUT-150 QA terms');
  });

  await step('One report with the route template /terms/:version', async () => {
    expect((await oneReport(page, crashReports, 'MUT-150 QA terms')).tags).toMatchObject({ route: '/terms/:version' });
  });
});

test('the free web app never sends a report, even when reached from the website', { tag: '@web.error-reports.app-routes-silent' }, async ({ page, step, crashReports }) => {
  await step('Open the download page in English and wait until its error reporting has loaded', async () => {
    await preferLanguage(page, 'en');
    const sdkLoaded = page.waitForRequest(/landingSentry/, { timeout: SDK_WAIT_MS });
    await page.goto('/download');
    await sdkLoaded;
  });

  await step('With error reporting live, the page moves to /app without reloading, and something throws there', async () => {
    // The risky path (eng R1): the SDK is already running when the address becomes an app route
    await page.evaluate(() => window.history.pushState(null, '', '/app/clients'));
    await throwUncaught(page, 'MUT-150 QA in-page app');
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForLoadState('networkidle');
    expect(crashReports.requestCount()).toBe(0);
  });

  // From here on, any request for Sentry's code is the app loading it
  const sentryCode: string[] = [];
  page.context().on('request', (request) => {
    if (SENTRY_CODE.test(request.url())) sentryCode.push(request.url());
  });

  await step('Follow the link back to the web app and log an income', async () => {
    await page.goto('/download');
    sentryCode.length = 0;
    await page.locator('a[href="/app"]').first().click();
    await page.waitForURL(/\/app/);
    await page.getByRole('dialog', { name: 'Welcome to MTB3A' }).getByRole('button', { name: 'Skip for now' }).click();
    await logIncome(page, { title: 'QA landing check', amount: '120', client: 'Layla Haddad' });
  });

  await step('Something in the app throws an error nobody catches', async () => {
    await throwUncaught(page, 'MUT-150 QA app via landing');
    await page.waitForLoadState('networkidle');
  });

  await step('Open the app directly in a new tab, and something throws there too', async () => {
    // Same browser context, so the Sentry spy sees it; the profile from the first tab means no welcome dialog
    const fresh = await page.context().newPage();
    await fresh.goto('/app/clients');
    await expect(fresh.getByRole('main')).toBeVisible();
    await throwUncaught(fresh, 'MUT-150 QA app direct');
    await fresh.waitForLoadState('networkidle');
  });

  await step('Not one request ever reached Sentry, and the app never even loaded its code', async () => {
    expect(crashReports.requestCount()).toBe(0);
    expect(sentryCode).toEqual([]);
  });
});

test("a website page that can't load shows its own Arabic screen and reports once", { tag: '@web.error-reports.landing-crash-screen' }, async ({ page, step, crashReports }) => {
  await step("Open the home page while its code can't be downloaded (an old tab after a release)", async () => {
    // The page's own chunk, as the dev server (the module) or a build (a hashed asset) serves it
    await page.route(/\/(src\/pages\/landing\/LandingPage\.tsx|assets\/LandingPage-[^/]+\.js)/, (route) => route.abort());
    await page.goto('/');
  });

  await step('The website crash screen shows in Arabic, with a reload button and nothing about "your data"', async () => {
    await expect(page.getByRole('heading', { name: arCopy.landing.crash.title })).toBeVisible();
    await expect(page.getByRole('button', { name: arCopy.landing.crash.reload })).toBeVisible();
    await expect(page.getByRole('alert')).not.toContainText('بيانات');
  });

  await step('One report reaches Sentry for the crash, tagged landing and /', async () => {
    await expect.poll(() => crashReports.events().length, { timeout: SDK_WAIT_MS }).toBe(1);
    await page.waitForLoadState('networkidle');
    expect(crashReports.events()).toHaveLength(1);
    expect(crashReports.events()[0].tags).toMatchObject({ surface: 'landing', route: '/' });
  });
});
