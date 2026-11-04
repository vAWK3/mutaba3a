import type { Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { chooseLanguageScript, LANGUAGE_KEYS } from '../../support/i18n';
import { EVENT_PATH, actAsPerson, type AnalyticsSpy, type SentEvent } from '../../support/posthog';

/**
 * The landing's cookieless visit counts (MUT-154, ADR-090). QA builds carry a
 * dummy key (qa.config.mjs) and qa/support/posthog.ts answers PostHog locally,
 * so these specs read exactly what the page would send, and nothing leaves.
 * The guard's every rule is unit-tested in src/lib/analytics; this proves the
 * real build wires it.
 */

async function openLanding(page: Page, path = '/') {
  await actAsPerson(page);
  await page.addInitScript(chooseLanguageScript, [LANGUAGE_KEYS, 'en'] as [typeof LANGUAGE_KEYS, 'en' | 'ar']);
  await page.goto(path);
}

async function nextEvent(analytics: AnalyticsSpy, name: string): Promise<SentEvent> {
  await expect.poll(() => analytics.events().some((e) => e.event === name), { timeout: 15_000 }).toBe(true);
  return analytics.events().find((e) => e.event === name)!;
}

test('opening the landing sends one anonymous pageview and stores nothing', { tag: '@web.landing-analytics.pageview-cookieless' }, async ({ page, step, analytics, context }) => {
  await step('Open the landing page', async () => {
    await openLanding(page);
    await expect(page.locator('#hero-title')).toBeVisible();
  });

  await step('One $pageview goes to PostHog EU, stamped by the contract guard', async () => {
    const pageview = await nextEvent(analytics, '$pageview');
    expect(pageview.properties).toMatchObject({ surface: 'landing', locale: 'en', $geoip_disable: true, $cookieless_mode: true });
    expect(pageview.properties.app_version).toMatch(/^\d+\.\d+\.\d+$/);
    for (const key of ['$session_id', '$window_id', 'gclid', '$set', '$set_once', '$screen_width']) expect(pageview.properties).not.toHaveProperty(key);
    expect(pageview).not.toHaveProperty('$set');
    expect(analytics.events().filter((e) => e.event === '$pageview')).toHaveLength(1);
  });

  await step('Nothing PostHog-named is stored on the device', async () => {
    // Unanchored, so posthog-js's own `__ph_opt_in_out_*` consent keys are caught too
    expect((await context.cookies()).filter((c) => /ph_|posthog/i.test(c.name))).toEqual([]);
    const stored = await page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)]);
    expect(stored.filter((key) => /ph_|posthog/i.test(key))).toEqual([]);
  });

  await step('Only event posts went out: no flags, no remote config, no script', async () => {
    expect(analytics.requestPaths().length).toBeGreaterThan(0);
    for (const path of analytics.requestPaths()) expect(path).toMatch(EVENT_PATH);
  });
});

test('pressing a counted call to action sends landing_cta_clicked', { tag: '@web.landing-analytics.cta' }, async ({ page, step, analytics, context }) => {
  // The store listing opens in a new tab; answer it locally so a QA run never loads Apple's page.
  await context.route('https://apps.apple.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>App Store (QA stand-in)</title>' }));

  await step('Open the landing page', async () => {
    await openLanding(page);
    await nextEvent(analytics, '$pageview');
  });

  await step('Press "iPhone, on the App Store" in Get MTB3A', async () => {
    const getIt = page.locator('#get-it');
    await getIt.scrollIntoViewIfNeeded();
    const [listing] = await Promise.all([
      page.waitForEvent('popup'),
      getIt.getByRole('link', { name: /^iPhone, on the App Store/ }).click(),
    ]);
    await expect(listing).toHaveURL(/^https:\/\/apps\.apple\.com\//);
    await listing.close();
  });

  await step('landing_cta_clicked with cta app_store was sent', async () => {
    const click = await nextEvent(analytics, 'landing_cta_clicked');
    expect(click.properties).toMatchObject({ cta: 'app_store', surface: 'landing' });
  });
});
