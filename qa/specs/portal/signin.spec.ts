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
type AuthCopy = { hosted: { auth: { title: string; request: { lead: string; link: string } } } };
const auth = (language: 'en' | 'ar') => (JSON.parse(fs.readFileSync(path.join(portalI18n, `${language}.json`), 'utf8')) as AuthCopy).hosted.auth;
const HEADING = { en: auth('en').title, ar: auth('ar').title } as const;
const REQUEST = { en: auth('en').request, ar: auth('ar').request } as const;

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
