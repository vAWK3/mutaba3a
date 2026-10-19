import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { expectOnlyKnownAxeViolations } from '../../support/axe';
import { CANVAS_HEX, SCHEMES, bootMarkBox, computedFont, hexToRgb, loadedFaces, watchFontRequests } from '../../support/brand';
import { MODE_KEY } from '../../support/portal';

/**
 * The hosted portal's sign-in page in Brand v2 (MUT-102). Every /v1 call is
 * stubbed to 401, which is the signed-out portal, so no API has to run. The
 * portal remembers only an explicit language choice (PORTAL_LANGUAGE_KEY).
 */

/** PORTAL_LANGUAGE_KEY in src/hosted/i18n/HostedLanguageProvider.tsx */
const PORTAL_LANGUAGE_KEY = 'mutaba3a-portal-language';

/** The portal's own sign-in title, read from its translation files so a copy change needs no spec change. */
const portalI18n = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../src/hosted/i18n');
type AuthCopy = { hosted: { auth: { title: string; checking: string; connectingSlow: string; request: { lead: string; link: string } } } };
const auth = (language: 'en' | 'ar') => (JSON.parse(fs.readFileSync(path.join(portalI18n, `${language}.json`), 'utf8')) as AuthCopy).hosted.auth;
const AUTH = { en: auth('en'), ar: auth('ar') } as const;
const HEADING = { en: AUTH.en.title, ar: AUTH.ar.title } as const;
const TERMS_LINK = { en: 'Terms of service', ar: 'شروط الخدمة' } as const;
const REQUEST = { en: AUTH.en.request, ar: AUTH.ar.request } as const;
const AUTH_CHECKING = { en: AUTH.en.checking, ar: AUTH.ar.checking } as const;
const AUTH_CONNECTING_SLOW = { en: AUTH.en.connectingSlow, ar: AUTH.ar.connectingSlow } as const;

async function openSignIn(page: Page, language: 'en' | 'ar') {
  await page.route('**/v1/**', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Sign in' } }) }),
  );
  await page.addInitScript(
    ([key, value]) => {
      try {
        localStorage.setItem(key, value);
      } catch {
        // storage blocked: the default language applies
      }
    },
    [PORTAL_LANGUAGE_KEY, language] as const,
  );
  await page.goto('/sign-in');
  await expect(page.getByRole('heading', { level: 1, name: HEADING[language] })).toBeVisible();
}

for (const language of ['en', 'ar'] as const) {
  test(
    `${language === 'en' ? 'English' : 'Arabic'}: sign-in is Thmanyah Sans with a Serif Display 700 heading, and loads no font from another origin`,
    { tag: '@portal.signin.type' },
    async ({ page, step }) => {
      const requests = watchFontRequests(page);
      await step('Open sign-in signed out', async () => {
        await openSignIn(page, language);
        await expect(page.locator('html')).toHaveAttribute('lang', language);
      });

      await step('Body text is Thmanyah Sans; the heading is Serif Display 700', async () => {
        expect((await computedFont(page.locator('body'))).family).toBe('Thmanyah Sans');
        expect(await computedFont(page.getByRole('heading', { level: 1 }))).toMatchObject({ family: 'Thmanyah Serif Display', weight: '700' });
        expect(await loadedFaces(page)).toEqual(expect.arrayContaining(['Thmanyah Sans 400', 'Thmanyah Serif Display 700']));
      });

      await step('No font or stylesheet came from another origin', async () => {
        const { offOrigin, fonts } = requests();
        expect(offOrigin).toEqual([]);
        expect(fonts.some((url) => /thmanyahsans-Regular/.test(url))).toBe(true);
      });
    },
  );
}

for (const scheme of SCHEMES) {
  test(`${scheme} mode: sign-in passes axe, colour contrast included`, { tag: '@portal.signin.contrast' }, async ({ page, step }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await step('Open sign-in signed out', async () => {
      await openSignIn(page, 'en');
    });
    await step('Check accessibility', async () => {
      await expectOnlyKnownAxeViolations(page, 'portalSignIn');
    });
  });
}

for (const language of ['en', 'ar'] as const) {
  test(
    `${language === 'en' ? 'English' : 'Arabic'}: sign-in offers one outward "Request one" link to /hosted (MUT-188)`,
    { tag: '@portal.signin.request-link' },
    async ({ page, step }) => {
      await step('Open sign-in signed out', async () => {
        await openSignIn(page, language);
      });

      await step('One outward link to /hosted, same tab, under the help line; the only other is the terms (MUT-324)', async () => {
        const link = page.getByRole('link', { name: REQUEST[language].link });
        await expect(link).toBeVisible();
        await expect(link).toHaveAttribute('href', /^https:\/\/[^/]+\/hosted$/);
        await expect(link).not.toHaveAttribute('target', /./);
        await expect(page.getByText(REQUEST[language].lead)).toBeVisible();
        // No self-service door: besides /hosted, the page links only the terms of service
        await expect(page.getByRole('link')).toHaveCount(2);
        await expect(page.getByRole('link', { name: TERMS_LINK[language] })).toHaveAttribute('href', /^https:\/\/[^/]+\/terms$/);
      });

      await step('Still accessible', async () => {
        await expectOnlyKnownAxeViolations(page, 'portalSignIn');
      });
    },
  );
}

test.describe('in an English browser where nobody chose a language', () => {
  test.use({ locale: 'en-US' });

  test('the portal\'s sign-in opens in Arabic, and a language chosen there sticks (MUT-209)', { tag: '@portal.signin.arabic-default' }, async ({ page, step }) => {
    // Signed out, as every portal spec stubs it: no API runs behind the preview
    await page.route('**/v1/**', (route) =>
      route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Sign in' } }) }),
    );
    const html = page.locator('html');
    const stored = () => page.evaluate((key) => localStorage.getItem(key), PORTAL_LANGUAGE_KEY);

    await step('With nothing chosen, sign-in opens in Arabic, right to left, and stores nothing', async () => {
      await page.goto('/sign-in');
      await expect(page.getByRole('heading', { level: 1, name: HEADING.ar })).toBeVisible();
      await expect(html).toHaveAttribute('lang', 'ar');
      await expect(html).toHaveAttribute('dir', 'rtl');
      expect(await stored()).toBeNull();
    });

    await step('Pressing EN switches to English, and it stays English after a reload', async () => {
      await page.getByRole('button', { name: 'EN', exact: true }).click();
      await expect(page.getByRole('heading', { level: 1, name: HEADING.en })).toBeVisible();
      expect(await stored()).toBe('en');
      await page.reload();
      await expect(html).toHaveAttribute('lang', 'en');
      await expect(page.getByRole('heading', { level: 1, name: HEADING.en })).toBeVisible();
    });
  });
});


/**
 * The boot screen while /v1/me is slow (MUT-206, reshaped by MUT-207 D4): the
 * mark first (the static splash, then React's, in the same spot), blooming in
 * place once the check has taken 0.4 s from page start, saying what it is
 * doing, "Still connecting…" from 3 s (DR5), then sign-in. No wordmark text.
 * The loader's inline SVG and bundled CSS trip no Content Security Policy rule.
 */
async function openWithSlowSession(page: Page, ms: number) {
  const cspErrors: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) cspErrors.push(message.text());
  });
  await page.route('**/v1/**', async (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/v1/me')) await new Promise((resolve) => setTimeout(resolve, ms));
    await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Sign in' } }) });
  });
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [PORTAL_LANGUAGE_KEY, 'en'] as const);
  // A browser that has used an account here (MUT-286): its 401 means "sign in again". A first visit opens local mode.
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [MODE_KEY, 'remote'] as const);
  return () => cspErrors;
}

test(
  'a slow session check shows the mark, which blooms in place saying "Checking your session", then "Still connecting…", then sign-in',
  { tag: '@portal.signin.boot-slow-session' },
  async ({ page, step }) => {
    const cspErrors = await openWithSlowSession(page, 4_000);

    await step('Open the portal while the session check is slow', async () => {
      await page.goto('/');
      await expect(page.locator('.boot-splash').first()).toBeVisible();
      await expect(page.getByText('Mutaba3a', { exact: true })).toHaveCount(0);
    });

    await step('The mark blooms in place and says it is checking the session', async () => {
      const status = page.getByRole('status');
      await expect(status).toHaveText(AUTH_CHECKING.en);
      await expect(status.locator('svg path')).toHaveCount(4);
      await expect(status).not.toHaveClass(/brand-loader--enter/);
    });

    await step('After 3 s it says it is still connecting', async () => {
      await expect(page.getByRole('status')).toHaveText(AUTH_CONNECTING_SLOW.en, { timeout: 5_000 });
    });

    await step('Then sign-in', async () => {
      await expect(page.getByRole('heading', { level: 1, name: HEADING.en })).toBeVisible({ timeout: 10_000 });
    });

    await step('No Content Security Policy violation', async () => {
      expect(cspErrors()).toEqual([]);
    });
  },
);

test(
  'reduced motion: the slow session check holds the still mark and writes what it is doing',
  { tag: '@portal.signin.boot-slow-session' },
  async ({ page, step }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openWithSlowSession(page, 4_000);

    await step('Open the portal while the session check is slow', async () => {
      await page.goto('/');
    });

    await step('The words show under the still mark, then the slow ones', async () => {
      const caption = page.locator('.boot-splash .brand-loader__caption');
      await expect(caption).toHaveText(AUTH_CHECKING.en);
      await expect(page.locator('.boot-splash animate, .boot-splash animateTransform')).toHaveCount(0);
      await expect(caption).toHaveText(AUTH_CONNECTING_SLOW.en, { timeout: 5_000 });
    });
  },
);

for (const scheme of SCHEMES) {
  test(`${scheme} mode: the boot screen passes axe`, { tag: '@portal.signin.boot-splash' }, async ({ page, step }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await openWithSlowSession(page, 10_000);
    await step('Open the portal while the session check is slow', async () => {
      await page.goto('/');
      await expect(page.getByRole('status')).toHaveText(AUTH_CHECKING.en);
    });
    await step('Check accessibility', async () => {
      await expectOnlyKnownAxeViolations(page, 'portalBoot');
    });
  });
}

/** MUT-207: before any JavaScript, the portal is the 80 px mark centred on the canvas, in the OS's scheme. */
test.describe('before JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  for (const scheme of SCHEMES) {
    test(`${scheme} OS: the portal opens on the mark, centred on the canvas`, { tag: '@portal.signin.boot-splash' }, async ({ page, step }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await step('Open the portal with scripts off', async () => {
        await page.goto('/');
        const mark = page.locator('#root > .boot-splash img.boot-splash-mark');
        await expect(mark).toBeVisible();
        expect(await page.locator('.boot-splash').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(hexToRgb(CANVAS_HEX[scheme]));
        expect(await mark.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
        const viewport = page.viewportSize()!;
        const { cx, cy, size } = await bootMarkBox(page);
        expect(Math.abs(cx - viewport.width / 2)).toBeLessThanOrEqual(1);
        expect(Math.abs(cy - viewport.height / 2)).toBeLessThanOrEqual(1);
        expect(size).toBe(80);
      });
    });
  }
});

test(
  'the hand-off: once React mounts, the mark (or the loader that replaced it) is the static mark, same place and size',
  { tag: '@portal.signin.boot-splash' },
  async ({ browser, page, step }) => {
    let still = { cx: 0, cy: 0, size: 0 };
    await step('Measure the static mark with scripts off', async () => {
      const context = await browser.newContext({ javaScriptEnabled: false, viewport: page.viewportSize() ?? undefined });
      const off = await context.newPage();
      await off.goto(new URL('/', test.info().project.use.baseURL).href);
      await expect(off.locator('.boot-splash img')).toBeVisible();
      still = await bootMarkBox(off);
      await context.close();
    });

    const cspErrors = await openWithSlowSession(page, 3_000);
    await step('Open the portal with /v1/me held 3 s', async () => {
      await page.goto('/');
      // React's boot screen has no aria-hidden; the static splash has
      await expect(page.locator('#root > .boot-splash:not([aria-hidden])')).toBeVisible();
    });

    await step('The mark has not moved or changed size', async () => {
      const mounted = await bootMarkBox(page);
      expect(Math.abs(mounted.cx - still.cx)).toBeLessThanOrEqual(1);
      expect(Math.abs(mounted.cy - still.cy)).toBeLessThanOrEqual(1);
      expect(Math.abs(mounted.size - still.size)).toBeLessThanOrEqual(1);
    });

    await step('After 0.4 s the bloom loader says it is checking the session', async () => {
      await expect(page.getByRole('status')).toHaveText(AUTH_CHECKING.en);
    });

    await step('No Content Security Policy violation', async () => {
      expect(cspErrors()).toEqual([]);
    });
  },
);
