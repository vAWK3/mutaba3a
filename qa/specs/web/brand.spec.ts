import type { Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { expectOnlyKnownAxeViolations } from '../../support/axe';
import { ar, chooseLanguageScript, en, LANGUAGE_KEYS } from '../../support/i18n';
import {
  CANVAS_HEX,
  bootMarkBox,
  hexToRgb,
  SCHEMES,
  attachScreenshot,
  expectNoHorizontalOverflow,
} from '../../support/brand';

/**
 * Brand v2 (MUT-102) on the website in a real browser: colour contrast in light
 * and dark, layout at 375 and 1280, the boot splash and the product's names.
 * Token values are proved in Node (src/styles/__tests__/brand.test.ts). The
 * free web app's screens were retired with it (MUT-445).
 */

for (const scheme of SCHEMES) {
  test(`${scheme} mode: the landing page passes axe, colour contrast included`, { tag: '@web.brand.contrast-landing' }, async ({ page, step }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await step('Open the landing page', async () => {
      await page.goto('/');
      await expect(page.locator('#hero-title')).toBeVisible();
    });
    await step('Check accessibility', async () => {
      await expectOnlyKnownAxeViolations(page, 'landing');
    });
    await step('Scroll so the frosted bar and its button sit over a chapter (MUT-77), and check again', async () => {
      await page.locator('[data-part="chapter-payment"]').scrollIntoViewIfNeeded();
      await expect(page.locator('[data-part="header-cta"]')).toBeVisible();
      await expectOnlyKnownAxeViolations(page, 'landing');
    });
  });
}

const VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 1280, height: 720 },
] as const;

/** MUT-103's screen matrix, for the website (MUT-165 D9): both schemes, both languages, phone and desktop width. */
for (const scheme of SCHEMES) {
  for (const viewport of VIEWPORTS) {
    for (const language of ['en', 'ar'] as const) {
      test(
        `${scheme} mode at ${viewport.width}px in ${language === 'en' ? 'English' : 'Arabic'}: the landing and privacy fit the window`,
        { tag: '@web.brand.layout' },
        async ({ page, step }) => {
          await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
          await page.addInitScript(chooseLanguageScript, [LANGUAGE_KEYS, language] as [typeof LANGUAGE_KEYS, 'en' | 'ar']);
          await page.setViewportSize(viewport);
          const shot = (name: string) => attachScreenshot(page, `${scheme}-${viewport.width}-${language}-${name}`);

          await step('The landing page and the privacy page', async () => {
            await page.goto('/');
            await expect(page.locator('#hero-title')).toBeVisible();
            await expect(page.locator('html')).toHaveAttribute('lang', language);
            await expectNoHorizontalOverflow(page, 'Landing');
            await shot('landing');
            await page.goto('/privacy');
            await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
            await expectNoHorizontalOverflow(page, 'Privacy');
            await shot('privacy');
          });
        },
      );
    }
  }
}

/**
 * MUT-207: the boot splash before any JavaScript. With scripts off, the
 * landing is what a slow connection shows until the bundle runs: the 80 px mark
 * centred on the canvas, in the OS's scheme.
 */
test.describe('before JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  for (const scheme of SCHEMES) {
    test(`${scheme} OS: the landing opens on the mark, centred on the canvas`, { tag: '@web.brand.boot-splash' }, async ({ page, step }) => {
      await page.emulateMedia({ colorScheme: scheme });
      for (const path of ['/']) {
        await step(`Open ${path} with scripts off`, async () => {
          await page.goto(path);
          const mark = page.locator('#root > .boot-splash img.boot-splash-mark');
          await expect(mark).toBeVisible();
          expect(await page.locator('.boot-splash').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(hexToRgb(CANVAS_HEX[scheme]));
          expect(await mark.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
          const src = await mark.evaluate((img) => (img as HTMLImageElement).currentSrc);
          if (scheme === 'dark') expect(src).toMatch(/mark-dark/);
          else expect(src).not.toMatch(/mark-dark/);
          const viewport = page.viewportSize()!;
          const { cx, cy, size } = await bootMarkBox(page);
          expect(Math.abs(cx - viewport.width / 2)).toBeLessThanOrEqual(1);
          expect(Math.abs(cy - viewport.height / 2)).toBeLessThanOrEqual(1);
          expect(size).toBe(80);
          await attachScreenshot(page, `boot-splash-${scheme}-landing`);
        });
      }
    });
  }
});

/** MUT-402: the landing bar's lockup, its two names and the computed colours jsdom can't show. */
const brandLink = (page: Page) => page.getByRole('banner').locator('.landing-header-brand');
const barLogotype = (page: Page) => page.getByRole('banner').locator('.logotype');
const barArabicName = (page: Page) => page.getByRole('banner').locator('.brand-name-ar');

async function openLandingIn(page: Page, language: 'en' | 'ar') {
  await page.addInitScript(chooseLanguageScript, [LANGUAGE_KEYS, language] as [typeof LANGUAGE_KEYS, 'en' | 'ar']);
  await page.goto('/');
  await expect(page.locator('#hero-title')).toBeVisible();
}

test('the landing header and the public pages name the product MTB3A in English and متابعة in Arabic', { tag: '@web.brand.mtb3a-name' }, async ({ browser, step }) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  await step('Open the landing page in English: the mark, the MTB3A logotype, the dot and متابعة, in that order', async () => {
    await openLandingIn(page, 'en');
    await expect(brandLink(page)).toHaveAccessibleName('MTB3A متابعة');
    const [logo, name] = [(await barLogotype(page).boundingBox())!, (await barArabicName(page).boundingBox())!];
    expect(logo.x).toBeLessThan(name.x);
    // The bar's 32px mark gives a 12.8px logotype, 5.104 times as wide (design D3)
    expect(logo.height).toBeCloseTo(12.8, 0);
    expect(logo.width).toBeCloseTo(12.8 * 5.104, 0);
    await expect(page).toHaveTitle(en.landing.meta.title);
    expect(await page.locator('body').innerText()).not.toContain('Mutaba3a');
    await attachScreenshot(page, 'mtb3a-landing-en-1280');
  });

  await step('The logotype is painted in the link’s own colour, with the pinned mask', async () => {
    const paint = await barLogotype(page).evaluate((el) => {
      const style = getComputedStyle(el);
      return { background: style.backgroundColor, mask: style.maskImage || style.getPropertyValue('-webkit-mask-image'), link: getComputedStyle(el.closest('a')!).color };
    });
    expect(paint.mask).toMatch(/wordmark[^/]*\.svg/);
    expect(paint.background).toBe(paint.link);
  });

  await step('Switch to Arabic: متابعة comes first, at the start edge, and the tab title follows', async () => {
    await page.locator('.landing-lang-toggle').click();
    await expect(brandLink(page)).toHaveAccessibleName('متابعة MTB3A');
    const [logo, name] = [(await barLogotype(page).boundingBox())!, (await barArabicName(page).boundingBox())!];
    expect(name.x).toBeGreaterThan(logo.x);
    await expect(page).toHaveTitle(ar.landing.meta.title);
    // For comparison with the Wordmark Kit preview (design D13): the Arabic name should sit level with the logotype
    await attachScreenshot(page, 'mtb3a-landing-ar-1280');
  });

  for (const width of [320, 360]) {
    for (const language of ['en', 'ar'] as const) {
      await step(`At ${width}px in ${language === 'en' ? 'English' : 'Arabic'}: the mark and the active name only, nothing wrapped or overflowing`, async () => {
        const phone = await browser.newPage({ viewport: { width, height: 740 } });
        await openLandingIn(phone, language);
        const active = language === 'en' ? barLogotype(phone) : barArabicName(phone);
        await expect(active).toBeVisible();
        await expect(phone.getByRole('banner').locator('.wordmark-other')).toHaveCount(2);
        for (const other of await phone.getByRole('banner').locator('.wordmark-other').all()) await expect(other).toBeHidden();
        const bar = (await phone.getByRole('banner').locator('.landing-header-bar').boundingBox())!;
        expect(bar.height).toBeLessThan(80);
        await expectNoHorizontalOverflow(phone, `landing ${language} @${width}`);
        await attachScreenshot(phone, `mtb3a-landing-${language}-${width}`);
        await phone.close();
      });
    }
  }

  await step('In forced colours (high contrast) the logotype, the dot and متابعة share one colour, and the mark has a ring', async () => {
    await page.emulateMedia({ forcedColors: 'active' });
    await page.locator('.landing-lang-toggle').click();
    await expect(brandLink(page)).toHaveAccessibleName('MTB3A متابعة');
    const colours = await page.getByRole('banner').evaluate((banner) => {
      const read = (selector: string) => getComputedStyle(banner.querySelector(selector)!);
      return { logotype: read('.logotype').backgroundColor, dot: read('.wordmark-separator').backgroundColor, name: read('.brand-name-ar').color, ring: read('.wordmark-mark').outlineStyle };
    });
    expect(colours.logotype).toBe(colours.name);
    expect(colours.dot).toBe(colours.name);
    expect(colours.ring).toBe('solid');
    await attachScreenshot(page, 'mtb3a-landing-en-forced-colors');
    await page.emulateMedia({ forcedColors: 'none' });
  });

  await page.close();
});
