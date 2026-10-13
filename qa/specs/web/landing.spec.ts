import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { attachScreenshot, expectNoHorizontalOverflow } from '../../support/brand';
import { ar } from '../../support/i18n';
import { contrast, parseColor } from '../../../src/test/css/brandCss';

/**
 * The landing page's frosted bar and restrained motion (MUT-77, brief L9/L10),
 * in a real browser: what jsdom can't show (stylesheets, IntersectionObserver,
 * :active, media features). The CSS rules themselves are guarded in
 * src/pages/landing/__tests__/landingCss.test.ts.
 */

/** A release with both installers, so the button doesn't depend on GitHub's rate limit. */
const RELEASE = {
  tag_name: 'v0.1.4',
  html_url: 'https://github.com/vAWK3/mutaba3a/releases/tag/v0.1.4',
  assets: [{ name: 'Mutaba3a_0.1.4_aarch64.dmg' }, { name: 'Mutaba3a_0.1.4_x64_en-US.msi' }],
};

async function openLanding(page: Page, language: 'en' | 'ar' = 'en') {
  await page.route('https://api.github.com/**', (route) => route.fulfill({ json: RELEASE }));
  await page.addInitScript((lang) => localStorage.setItem('mutaba3a-language', lang), language);
  await page.goto('/');
  await expect(page.locator('#hero-title')).toBeVisible();
}

const header = (page: Page) => page.getByRole('banner');
const headerCta = (page: Page) => page.locator('[data-part="header-cta"]');
const heroCta = (page: Page) => page.locator('.hero-cta-primary');

/** The bar's button has finished fading in. */
async function expectHeaderCtaShown(page: Page) {
  await expect(headerCta(page)).toBeVisible();
  await expect.poll(() => headerCta(page).evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
}

async function scrollTo(page: Page, y: number) {
  await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y);
}

async function scrollPastHero(page: Page) {
  const heroBottom = await heroCta(page).evaluate((el) => el.getBoundingClientRect().bottom + window.scrollY);
  await scrollTo(page, heroBottom + 200);
}

/** Presses the pointer on `target` and reads its transform once the press has settled, then lets go elsewhere (no click). */
async function pressedTransform(page: Page, target: Locator): Promise<string> {
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(300);
  const transform = await target.evaluate((el) => getComputedStyle(el).transform);
  await page.mouse.move(1, 1);
  await page.mouse.up();
  return transform;
}

/** Problems inside the bar: the wordmark clipped, or the wordmark and the actions overlapping. */
function barProblems(page: Page): Promise<string[]> {
  return header(page).evaluate((bar) => {
    const found: string[] = [];
    const brand = bar.querySelector<HTMLElement>('.landing-header-brand')!;
    const actions = bar.querySelector<HTMLElement>('.landing-header-actions')!;
    if (brand.scrollWidth > brand.clientWidth + 1) found.push(`wordmark clipped: ${brand.scrollWidth}px in ${brand.clientWidth}px`);
    const a = brand.getBoundingClientRect();
    const b = actions.getBoundingClientRect();
    if (a.left < b.right && b.left < a.right) found.push(`wordmark ${Math.round(a.left)}..${Math.round(a.right)} overlaps actions ${Math.round(b.left)}..${Math.round(b.right)}`);
    return found;
  });
}

function boxesOverlap(a: { x: number; y: number; width: number; height: number }, b: typeof a) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

test('the header button appears only once the hero button has scrolled away, and goes to the same place', { tag: '@web.landing.header-cta' }, async ({ page, step }) => {
  await step('Open the landing page: the bar shows the wordmark and the language switch, not the button', async () => {
    await openLanding(page);
    await expect(header(page).getByRole('link', { name: 'Mutaba3a · متابعة' })).toBeVisible();
    await expect(headerCta(page)).toBeHidden();
  });

  await step('Scroll the hero button out of view: the bar’s button fades in, to the same download', async () => {
    await scrollPastHero(page);
    await expectHeaderCtaShown(page);
    await expect(headerCta(page)).toHaveAttribute('href', (await heroCta(page).getAttribute('href'))!);
    await expect(header(page)).toHaveAttribute('data-scrolled', 'true');
    await attachScreenshot(page, 'bar-scrolled-1280');
  });

  await step('Scroll back to the top: the button leaves again', async () => {
    await scrollTo(page, 0);
    await expect(headerCta(page)).toBeHidden();
    await expect(header(page)).toHaveAttribute('data-scrolled', 'false');
  });
});

test('the bar is frosted by default and solid when reduced transparency is asked for', { tag: '@web.landing.transparency' }, async ({ page, step }) => {
  const surface = () =>
    header(page).evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        filter: style.backdropFilter,
        background: style.backgroundColor,
        page: getComputedStyle(document.querySelector('.landing-page')!).backgroundColor,
      };
    });

  await step('Default: frosted, see-through', async () => {
    await openLanding(page);
    const { filter, background, page: canvas } = await surface();
    expect(filter).toContain('blur');
    expect(background).not.toBe(canvas);
  });

  await step('Reduced transparency: solid page colour, no blur', async () => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
    await expect.poll(async () => (await surface()).filter).toBe('none');
    const { background, page: canvas } = await surface();
    expect(background).toBe(canvas);
  });
});

test('every landing button presses in, and not under reduced motion', { tag: '@web.landing.press' }, async ({ page, step }) => {
  const buttons = (p: Page) => ({
    'hero button': heroCta(p),
    'language switch': p.locator('.landing-lang-toggle'),
    'get it card': p.locator('a.landing-get-it-option').first(),
    'FAQ question': p.locator('.landing-faq-question').first(),
  });

  await step('Motion allowed: each presses in to the brand scale', async () => {
    await openLanding(page);
    for (const [name, button] of Object.entries(buttons(page))) {
      expect(await pressedTransform(page, button), name).toMatch(/^matrix\(0\.96, 0, 0, 0\.96,/);
    }
    await scrollPastHero(page);
    await expect(headerCta(page)).toBeVisible();
    expect(await pressedTransform(page, headerCta(page)), 'header button').toMatch(/^matrix\(0\.96, 0, 0, 0\.96,/);
  });

  await step('Reduced motion: nothing scales', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await scrollTo(page, 0);
    for (const [name, button] of Object.entries(buttons(page))) {
      expect(await pressedTransform(page, button), name).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
    }
  });
});

/** A colour as plain sRGB: computed colours come back as oklab(), a canvas pixel turns them into rgb(). */
function readColours(target: Locator) {
  return target.evaluate((el) => {
    const toRgb = (value: string) => {
      const context = document.createElement('canvas').getContext('2d')!;
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
      return `rgb(${r}, ${g}, ${b})`;
    };
    const style = getComputedStyle(el);
    return { color: toRgb(style.color), background: toRgb(style.backgroundColor), decoration: style.textDecorationLine };
  });
}

test('hovering a landing control in OS light mode keeps its label colour and readable', { tag: '@web.landing.hover-light' }, async ({ page, step }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await openLanding(page);
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');

  await step('The hero button: same label colour, no underline, at least 4.5:1 on its fill', async () => {
    const before = await readColours(heroCta(page));
    await heroCta(page).hover();
    await page.waitForTimeout(300);
    const after = await readColours(heroCta(page));
    expect(after.color).toBe(before.color);
    expect(after.decoration).toBe('none');
    expect(contrast(parseColor(after.color), parseColor(after.background))).toBeGreaterThanOrEqual(4.5);
  });

  await step('The wordmark, the Get it cards and the bar’s button keep their colours too', async () => {
    const controls = [
      header(page).getByRole('link', { name: 'Mutaba3a · متابعة' }),
      page.locator('a.landing-get-it-option').first(),
    ];
    for (const control of controls) {
      await control.scrollIntoViewIfNeeded();
      const before = await readColours(control);
      await control.hover();
      await page.waitForTimeout(300);
      const after = await readColours(control);
      expect(after.color).toBe(before.color);
      expect(after.decoration).toBe('none');
    }
    await scrollPastHero(page);
    await expect(headerCta(page)).toBeVisible();
    const before = await readColours(headerCta(page));
    await headerCta(page).hover();
    await page.waitForTimeout(300);
    expect((await readColours(headerCta(page))).color).toBe(before.color);
  });
});

for (const language of ['en', 'ar'] as const) {
  test(`at 375 in ${language.toUpperCase()} the bar fits and overlaps nothing`, { tag: '@web.landing.375' }, async ({ page, step }) => {
    await page.setViewportSize({ width: 375, height: 812 });

    await step('At the top: the bar sits above the hero, one line, no sideways scroll', async () => {
      await openLanding(page, language);
      const bar = (await header(page).boundingBox())!;
      for (const part of ['#hero-title', '.landing-subheadline-large', '.hero-cta-primary']) {
        expect(boxesOverlap(bar, (await page.locator(part).boundingBox())!), part).toBe(false);
      }
      expect(bar.height).toBeLessThan(80);
      expect(await barProblems(page)).toEqual([]);
      await expectNoHorizontalOverflow(page, `landing ${language} 375`);
      await attachScreenshot(page, `bar-top-375-${language}`);
    });

    await step('Scrolled: the button fits inside the bar and the viewport', async () => {
      await scrollPastHero(page);
      await expectHeaderCtaShown(page);
      const cta = (await headerCta(page).boundingBox())!;
      expect(cta.x).toBeGreaterThanOrEqual(0);
      expect(cta.x + cta.width).toBeLessThanOrEqual(375);
      expect((await header(page).boundingBox())!.height).toBeLessThan(80);
      expect(await barProblems(page)).toEqual([]);
      await expectNoHorizontalOverflow(page, `landing ${language} 375 scrolled`);
      await attachScreenshot(page, `bar-scrolled-375-${language}`);
    });

    await step('Jumping to Get it: its heading lands below the bar', async () => {
      await page.goto('/#get-it');
      await expect(page.locator('#get-it-title')).toBeVisible();
      const bar = (await header(page).boundingBox())!;
      const heading = (await page.locator('#get-it-title').boundingBox())!;
      expect(heading.y).toBeGreaterThanOrEqual(bar.y + bar.height);
    });
  });
}

test('the tab title follows the language', { tag: '@web.landing.title' }, async ({ page }) => {
  await openLanding(page);
  await expect(page).toHaveTitle('Mutaba3a — Track your finances, securely');
  await page.locator('.landing-lang-toggle').click();
  await expect(page).toHaveTitle(ar.landing.meta.title);
});

test('chapter visuals rise in once on scroll, and are simply there under reduced motion', { tag: '@web.landing.reveal' }, async ({ page, step }) => {
  const figure = (p: Page) => p.locator('[data-part="chapter-clients"] .landing-chapter-visual');

  await step('Motion allowed: held back below the fold, then fully shown once scrolled to', async () => {
    await openLanding(page);
    await expect(figure(page)).toHaveAttribute('data-reveal', 'pending');
    await figure(page).scrollIntoViewIfNeeded();
    await expect(figure(page)).toHaveAttribute('data-reveal', 'done');
    await expect.poll(() => figure(page).evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  });

  await step('Reduced motion: visible at load, never held back', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    await expect(page.locator('#hero-title')).toBeVisible();
    await expect(figure(page)).not.toHaveAttribute('data-reveal');
    expect(await figure(page).evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  });
});
