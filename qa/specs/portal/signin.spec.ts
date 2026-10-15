import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { expectOnlyKnownAxeViolations } from '../../support/axe';
import { SCHEMES, computedFont, loadedFaces, watchFontRequests } from '../../support/brand';

/**
 * The hosted portal's sign-in page in Brand v2 (MUT-102). Every /v1 call is
 * stubbed to 401, which is the signed-out portal, so no API has to run. The
 * portal remembers only an explicit language choice (PORTAL_LANGUAGE_KEY).
 */

/** PORTAL_LANGUAGE_KEY in src/hosted/i18n/HostedLanguageProvider.tsx */
const PORTAL_LANGUAGE_KEY = 'mutaba3a-portal-language';

/** The portal's own sign-in title, read from its translation files so a copy change needs no spec change. */
const portalI18n = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../src/hosted/i18n');
type AuthCopy = { hosted: { auth: { title: string; checking: string; request: { lead: string; link: string } } } };
const auth = (language: 'en' | 'ar') => (JSON.parse(fs.readFileSync(path.join(portalI18n, `${language}.json`), 'utf8')) as AuthCopy).hosted.auth;
const AUTH = { en: auth('en'), ar: auth('ar') } as const;
const HEADING = { en: AUTH.en.title, ar: AUTH.ar.title } as const;
const REQUEST = { en: AUTH.en.request, ar: AUTH.ar.request } as const;
const AUTH_CHECKING = { en: AUTH.en.checking, ar: AUTH.ar.checking } as const;

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

      await step('One outward link, same tab, under the help line', async () => {
        const link = page.getByRole('link', { name: REQUEST[language].link });
        await expect(link).toBeVisible();
        await expect(link).toHaveAttribute('href', /^https:\/\/[^/]+\/hosted$/);
        await expect(link).not.toHaveAttribute('target', /./);
        await expect(page.getByText(REQUEST[language].lead)).toBeVisible();
        await expect(page.getByRole('link')).toHaveCount(1);
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
 * MUT-206: the boot screen while /v1/me is slow. The wordmark first, the bloom
 * loader once the check has taken 0.4 s, then sign-in; and the loader's inline
 * SVG and bundled CSS trip no Content Security Policy rule.
 */
test(
  'a slow session check shows the wordmark, then the bloom loader named "Checking your session", then sign-in',
  { tag: '@portal.signin.boot-slow-session' },
  async ({ page, step }) => {
    const cspErrors: string[] = [];
    page.on('console', (message) => {
      if (/Content Security Policy/i.test(message.text())) cspErrors.push(message.text());
    });
    await page.route('**/v1/**', async (route) => {
      if (new URL(route.request().url()).pathname.endsWith('/v1/me')) await new Promise((resolve) => setTimeout(resolve, 3_000));
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Sign in' } }) });
    });
    await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [PORTAL_LANGUAGE_KEY, 'en'] as const);

    await step('Open the portal while the session check is slow', async () => {
      await page.goto('/');
      await expect(page.getByText('Mutaba3a', { exact: true })).toBeVisible();
    });

    await step('After 0.4 s the bloom loader says it is checking the session', async () => {
      const status = page.getByRole('status');
      await expect(status).toHaveText(AUTH_CHECKING.en);
      await expect(status.locator('svg path')).toHaveCount(4);
    });

    await step('Then sign-in', async () => {
      await expect(page.getByRole('heading', { level: 1, name: HEADING.en })).toBeVisible({ timeout: 10_000 });
    });

    await step('No Content Security Policy violation', async () => {
      expect(cspErrors).toEqual([]);
    });
  },
);
