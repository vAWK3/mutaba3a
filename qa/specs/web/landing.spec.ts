import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { attachScreenshot, expectNoHorizontalOverflow } from '../../support/brand';
import { expectOnlyKnownAxeViolations } from '../../support/axe';
import { ar, chooseLanguageScript, en, LANGUAGE_KEYS } from '../../support/i18n';
import { contrast, parseColor } from '../../../src/test/css/brandCss';
import { MOBILE_APP_LINKS, storeLinkUrl } from '../../../src/content/download-config';
import { malafatUrl } from '../../../src/content/malafatLinks';

/**
 * The landing page's frosted bar and restrained motion (MUT-77, brief L9/L10),
 * in a real browser: what jsdom can't show (stylesheets, IntersectionObserver,
 * :active, media features). The CSS rules themselves are guarded in
 * src/pages/landing/__tests__/landingCss.test.ts.
 */

/** A stored language choice, as the EN/AR switch leaves it; without one the marketing site opens in Arabic (MUT-202). */
async function preferLanguage(page: Page, language: 'en' | 'ar') {
  await page.addInitScript(chooseLanguageScript, [LANGUAGE_KEYS, language] as [typeof LANGUAGE_KEYS, 'en' | 'ar']);
}

async function openLanding(page: Page, language: 'en' | 'ar' = 'en') {
  await preferLanguage(page, language);
  await page.goto('/');
  await expect(page.locator('#hero-title')).toBeVisible();
}

const header = (page: Page) => page.getByRole('banner');
const headerCtaLocators = new WeakMap<Page, Locator>();
/** One locator per page, so helpers can tell the sticky bar's button apart. */
function headerCtaLocatorFor(page: Page): Locator {
  if (!headerCtaLocators.has(page)) headerCtaLocators.set(page, page.locator('[data-part="header-cta"]'));
  return headerCtaLocators.get(page)!;
}
const headerCta = (page: Page) => headerCtaLocatorFor(page);
const heroCta = (page: Page) => page.locator('.hero-cta-primary');
const signIn = (page: Page) => header(page).locator('.landing-header-signin');

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

/**
 * Puts the pointer on `target` where it is now. Playwright's own hover/scroll-into-view would scroll a
 * sticky bar's button to its in-flow spot at the top of the page, which brings the hero back and hides it.
 */
async function pointAt(page: Page, target: Locator) {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}

/** Holds the pointer down on `target` until `property` settles to `expected`, then lets go elsewhere (no click). */
async function expectPressed(page: Page, target: Locator, property: 'scale' | 'opacity', expected: RegExp, name: string) {
  if (target !== headerCtaLocatorFor(page)) await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  try {
    await expect
      .poll(() => target.evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), property), { message: name })
      .toMatch(expected);
  } finally {
    await page.mouse.move(1, 1);
    await page.mouse.up();
  }
}

// The press is the CSS `scale` property (ADR-074, MUT-91), so it reads from computed `scale`, not `transform`.
const PRESSED = /^0\.96$/;
const NOT_SCALED = /^(none|1)$/;

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
    await expect(header(page).getByRole('link', { name: 'MTB3A متابعة' })).toBeVisible();
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

test('every landing button gives press feedback, and nothing scales under reduced motion', { tag: '@web.landing.press' }, async ({ page, step }) => {
  const buttons = (p: Page) => ({
    'hero button': heroCta(p),
    'language switch': p.locator('.landing-lang-toggle'),
    'get it card': p.locator('a.landing-get-it-option').first(),
  });
  const faq = (p: Page) => p.locator('.landing-faq-question').first();

  await step('Motion allowed: buttons press in to the brand scale; the full-width FAQ rows dim', async () => {
    await openLanding(page);
    for (const [name, button] of Object.entries(buttons(page))) await expectPressed(page, button, 'scale', PRESSED, name);
    await expectPressed(page, faq(page), 'opacity', /^0\.6$/, 'FAQ question');
    await scrollPastHero(page);
    await expectHeaderCtaShown(page);
    await expectPressed(page, headerCta(page), 'scale', PRESSED, 'header button');
  });

  await step('Reduced motion: nothing scales', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await scrollTo(page, 0);
    for (const [name, button] of Object.entries(buttons(page))) await expectPressed(page, button, 'scale', NOT_SCALED, name);
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
    await expect.poll(() => heroCta(page).evaluate((el) => getComputedStyle(el).opacity)).toBe('0.88');
    const after = await readColours(heroCta(page));
    expect(after.color).toBe(before.color);
    expect(after.decoration).toBe('none');
    expect(contrast(parseColor(after.color), parseColor(after.background))).toBeGreaterThanOrEqual(4.5);
  });

  await step('The wordmark, the Get it cards and the bar’s button keep their colours too', async () => {
    const controls = [
      header(page).getByRole('link', { name: 'MTB3A متابعة' }),
      page.locator('a.landing-get-it-option').first(),
    ];
    for (const control of controls) {
      await control.scrollIntoViewIfNeeded();
      const before = await readColours(control);
      await control.hover();
      await expect.poll(() => control.evaluate((el) => el.matches(':hover'))).toBe(true);
      const after = await readColours(control);
      expect(after.color).toBe(before.color);
      expect(after.decoration).toBe('none');
    }
    await scrollPastHero(page);
    await expect(headerCta(page)).toBeVisible();
    const before = await readColours(headerCta(page));
    await pointAt(page, headerCta(page));
    await expect.poll(() => headerCta(page).evaluate((el) => getComputedStyle(el).opacity)).toBe('0.88');
    expect((await readColours(headerCta(page))).color).toBe(before.color);
  });
});

for (const [width, language] of [[375, 'en'], [375, 'ar'], [320, 'en'], [320, 'ar']] as const) {
  test(`at ${width} in ${language.toUpperCase()} the bar fits and overlaps nothing`, { tag: '@web.landing.375' }, async ({ page, step }) => {
    await page.setViewportSize({ width, height: 812 });

    await step('At the top: the bar sits above the hero, one line, no sideways scroll', async () => {
      await openLanding(page, language);
      const bar = (await header(page).boundingBox())!;
      for (const part of ['#hero-title', '.landing-subheadline-large', '.hero-cta-primary']) {
        expect(boxesOverlap(bar, (await page.locator(part).boundingBox())!), part).toBe(false);
      }
      expect(bar.height).toBeLessThan(80);
      expect(await barProblems(page)).toEqual([]);
      await expect(signIn(page), 'Sign in has the slot while the hero’s button shows (MUT-231)').toBeVisible();
      await expectNoHorizontalOverflow(page, `landing ${language} ${width}`);
      await attachScreenshot(page, `bar-top-${width}-${language}`);
    });

    await step('Scrolled: the button fits inside the bar and the viewport', async () => {
      await scrollPastHero(page);
      await expectHeaderCtaShown(page);
      const cta = (await headerCta(page).boundingBox())!;
      expect(cta.x).toBeGreaterThanOrEqual(0);
      expect(cta.x + cta.width).toBeLessThanOrEqual(width);
      expect(cta.height, 'a 44px tap target').toBeGreaterThanOrEqual(44);
      await expect(signIn(page), 'the button takes Sign in’s slot (MUT-231)').toBeHidden();
      expect((await header(page).boundingBox())!.height).toBeLessThan(80);
      expect(await barProblems(page)).toEqual([]);
      await expectNoHorizontalOverflow(page, `landing ${language} ${width} scrolled`);
      await attachScreenshot(page, `bar-scrolled-${width}-${language}`);
    });

    await step('Jumping to Get it: its heading lands below the bar', async () => {
      await page.goto('/#get-it');
      await expect(page.locator('#get-it-title')).toBeVisible();
      // Wait for the (smooth) jump to land, with an upper bound so a jump that never happened can't pass
      const bar = (await header(page).boundingBox())!;
      const headingTop = () => page.locator('#get-it-title').evaluate((el) => el.getBoundingClientRect().top);
      await expect.poll(headingTop).toBeLessThan(bar.y + bar.height + 200);
      expect(await headingTop()).toBeGreaterThanOrEqual(bar.y + bar.height);
    });
  });
}

test('the tab title follows the language', { tag: '@web.landing.title' }, async ({ page }) => {
  await openLanding(page);
  await expect(page).toHaveTitle(en.landing.meta.title);
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

test('the privacy policy has the bar without the button, and its wordmark goes home', { tag: '@web.landing.privacy-bar' }, async ({ page }) => {
  // MUT-445: the website asks GitHub for nothing (the desktop apps' release check is gone)
  let releaseCalls = 0;
  page.on('request', (request) => {
    if (request.url().startsWith('https://api.github.com/')) releaseCalls += 1;
  });
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(headerCta(page)).toHaveCount(0);
  await expect(header(page).locator('.landing-header-brand')).toHaveAttribute('href', '/');
  expect(releaseCalls).toBe(0);
});

test('Old /app and /download links land on the home page (MUT-445, MUT-382)', { tag: '@web.landing.retired-paths' }, async ({ page, step }) => {
  for (const path of ['/app', '/app/clients?client=c1', '/download']) {
    await step(`Open ${path}`, async () => {
      await page.goto(path);
      await page.waitForURL((url) => url.pathname === '/');
      await expect(page.locator('#hero-title')).toBeVisible();
    });
  }
});

test('Get it takes a request through every state in its card: two fields a row, errors, retry, success (MUT-186, redesign 2026-10-25)', { tag: '@web.landing.get-it-form' }, async ({ page, step }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const posts: string[] = [];
  let answer = 200;
  await page.route('**/__forms.html', async (route) => {
    posts.push(route.request().postData() ?? '');
    await route.fulfill({ status: answer, body: '' });
  });
  const getIt = page.locator('[data-part="get-it"]');
  const card = getIt.locator('[data-part="get-it-request"]');

  await step('Open the landing at Get MTB3A: the request card comes before sign-in and the apps, and passes axe in light and dark', async () => {
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await openLanding(page, 'en');
      await card.scrollIntoViewIfNeeded();
      await expect(card.getByRole('heading', { name: en.landing.getIt.requestCta })).toBeVisible();
      await expectOnlyKnownAxeViolations(page, 'landing');
    }
    await page.emulateMedia({ colorScheme: 'light' });
    const cardBox = (await card.boundingBox())!;
    const tiles = getIt.locator('a.landing-get-it-option');
    if ((await tiles.count()) > 0) expect((await tiles.first().boundingBox())!.y).toBeGreaterThan(cardBox.y + cardBox.height);
    const name = (await page.getByLabel('Name', { exact: true }).boundingBox())!;
    const email = (await page.getByLabel('Email', { exact: true }).boundingBox())!;
    expect(Math.round(name.y)).toBe(Math.round(email.y));
    await expect(page.locator('.hosted-devices-field')).toHaveCSS('border-top-style', 'none');
    await attachScreenshot(page, 'get-it-form-en');
  });

  await step('Press Send request with nothing filled in: both errors show and the name is focused', async () => {
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByText('Enter your name.')).toBeVisible();
    await expect(page.getByLabel('Name', { exact: true })).toBeFocused();
    expect(posts).toHaveLength(0);
  });

  await step('Fill in a name and email and send while the server fails: the answers stay and the alert shows beside Try again', async () => {
    answer = 500;
    await page.getByLabel('Name', { exact: true }).fill('QA Visitor');
    await page.getByLabel('Email', { exact: true }).fill('qa.visitor@example.test');
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByRole('alert')).toContainText("Couldn't send");
    await expect(page.getByRole('button', { name: 'Try again' })).toBeInViewport();
    await expect(page.getByRole('alert')).toBeInViewport();
    await attachScreenshot(page, 'get-it-form-error-en');
  });

  await step('Press Try again once the server answers: the card confirms with the visitor’s own email, focused', async () => {
    answer = 200;
    await page.getByRole('button', { name: 'Try again' }).click();
    const heading = page.getByRole('heading', { name: 'Request sent.' });
    await expect(heading).toBeFocused();
    await expect(page.getByRole('status')).toContainText('qa.visitor@example.test');
    const body = new URLSearchParams(posts.at(-1));
    expect(body.get('form-name')).toBe('hosted-request');
    expect(body.get('language')).toBe('en');
    expect(posts).toHaveLength(2);
    await attachScreenshot(page, 'get-it-form-sent-en');
  });

  expect(errors).toEqual([]);
});

test('At 375 in Arabic, Get it fits: one field a row, 44px device pills, a full-width send and stacked app tiles', { tag: '@web.landing.get-it-375' }, async ({ page, step }) => {
  await step('Open the landing in Arabic at 375 px and scroll to the request card', async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openLanding(page, 'ar');
    await page.locator('[data-part="get-it-request"]').scrollIntoViewIfNeeded();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectNoHorizontalOverflow(page, 'get it 375 ar');
  });

  await step('Fields stack one a row; the device pills and the send button are touch-sized', async () => {
    const name = (await page.locator('#hosted-name').boundingBox())!;
    const email = (await page.locator('#hosted-email').boundingBox())!;
    expect(email.y).toBeGreaterThan(name.y + name.height);
    for (const pill of await page.locator('.hosted-device-pill').all()) {
      expect((await pill.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    const send = (await page.locator('.hosted-submit').boundingBox())!;
    const form = (await page.locator('.hosted-form').boundingBox())!;
    expect(send.height).toBeGreaterThanOrEqual(44);
    expect(Math.round(send.width)).toBe(Math.round(form.width));
  });

  await step('The app tiles stack under the card, each a full row', async () => {
    const tiles = page.locator('.landing-get-it-apps a.landing-get-it-option');
    if ((await tiles.count()) === 2) {
      const [first, second] = [(await tiles.nth(0).boundingBox())!, (await tiles.nth(1).boundingBox())!];
      expect(second.y).toBeGreaterThan(first.y + first.height - 1);
    }
    await attachScreenshot(page, 'get-it-ar-375');
  });
});

for (const language of ['en', 'ar'] as const) {
  test(
    `${language === 'en' ? 'English' : 'Arabic'}: the phone chapter says the phone logs and the hosted account shows, and names each app from its config (MUT-173)`,
    { tag: '@web.landing.phone' },
    async ({ page, step }) => {
      const dict = (language === 'ar' ? ar : en).landing;
      const copy = dict.phone as { title: string; hintLink: string; storesLabel: string; withAccount: string; store: Record<string, string> };
      const platformNames = dict.hostedOffer.platform as { ios: string; android: string; comingSoon: string };
      const chapter = page.locator('[data-part="phone"]');
      const stores = chapter.getByRole('list', { name: copy.storesLabel });
      const hintLink = chapter.getByRole('link', { name: copy.hintLink });

      await step('After Get it, the chapter states the split with the laptop-and-phone picture whole', async () => {
        await openLanding(page, language);
        await chapter.scrollIntoViewIfNeeded();
        await expect(chapter.getByRole('heading', { level: 2 })).toHaveText(copy.title);
        await expect(chapter.locator('.hosted-devices-laptop')).toBeVisible();
        await expect(chapter.locator('.hosted-devices-phone')).toBeVisible();
        await expect(chapter.locator('.hosted-devices-caption')).toBeVisible();
        expect((await chapter.locator('.hosted-devices-laptop').boundingBox())!.width).toBeGreaterThan(300);
        await expect(chapter.getByText(/report|analytic|dashboard/i)).toHaveCount(0);
        await attachScreenshot(page, `phone-${language}`);
      });

      await step('Each phone app reads its state from the config: a store link, a name, or coming soon', async () => {
        for (const platform of ['ios', 'android'] as const) {
          const link = MOBILE_APP_LINKS[platform];
          if (link.url) {
            const store = stores.getByRole('link', { name: copy.store[platform] });
            // The landing's campaign rides along for store-console attribution (MUT-154)
            await expect(store).toHaveAttribute('href', storeLinkUrl(link, 'mutaba3a-landing')!);
            await expect(store).toHaveAttribute('target', '_blank');
            expect((await store.boundingBox())!.height).toBeGreaterThanOrEqual(44);
            await expectPressed(page, store, 'scale', PRESSED, `${platform} store link`);
            const before = await readColours(store);
            await store.hover();
            await expect.poll(() => store.evaluate((el) => el.matches(':hover'))).toBe(true);
            expect((await readColours(store)).color).toBe(before.color);
          } else if (link.available) {
            const named = stores.locator('.landing-phone-platform', { hasText: platformNames[platform] });
            await expect(named).toBeVisible();
            await expect(named).toContainText(copy.withAccount);
          } else {
            await expect(stores.getByText(platformNames.comingSoon.replace('{platform}', platformNames[platform]))).toBeVisible();
          }
        }
        const expectedLinks = (['ios', 'android'] as const).filter((p) => MOBILE_APP_LINKS[p].url).length;
        await expect(stores.getByRole('link')).toHaveCount(expectedLinks);
      });

      await step('At 1024 px the phone frame covers none of the laptop\u2019s amounts', async () => {
        await page.setViewportSize({ width: 1024, height: 768 });
        await chapter.scrollIntoViewIfNeeded();
        const phone = (await chapter.locator('.hosted-devices-phone').boundingBox())!;
        for (const money of await chapter.locator('.hosted-devices-laptop .landing-mock-money').all()) {
          const box = (await money.boundingBox())!;
          const overlaps = box.x < phone.x + phone.width && box.x + box.width > phone.x;
          expect(overlaps, `amount under the phone at 1024 (${language})`).toBe(false);
        }
      });

      await step('At 375 px the chapter fits and keeps the whole picture', async () => {
        await page.setViewportSize({ width: 375, height: 812 });
        await chapter.scrollIntoViewIfNeeded();
        await expect(page.locator('html')).toHaveAttribute('dir', language === 'ar' ? 'rtl' : 'ltr');
        await expectNoHorizontalOverflow(page, `phone 375 ${language}`);
        await expect(chapter.locator('.hosted-devices-laptop')).toBeVisible();
        await expect(chapter.locator('.hosted-devices-phone')).toBeVisible();
        await expect(chapter.locator('.hosted-devices-caption')).toBeVisible();
        await attachScreenshot(page, `phone-${language}-375`);
      });

      await step('The underlined link in the hint opens /hosted', async () => {
        await expect(hintLink).toHaveAttribute('href', '/hosted');
        expect((await readColours(hintLink)).decoration).toBe('underline');
        await hintLink.click();
        await expect(page).toHaveURL(/\/hosted$/);
        await expect(page.locator('#hosted-title')).toBeVisible();
      });
    },
  );
}

for (const language of ['en', 'ar'] as const) {
  test(
    `${language === 'en' ? 'English' : 'Arabic'}: the Malafat band speaks to firms on Malafat and links to Malafat in the page's language (MUT-174)`,
    { tag: '@web.landing.malafat' },
    async ({ page, step }) => {
      const copy = (language === 'ar' ? ar : en).landing.malafat as { title: string; link: string };
      const band = page.locator('[data-part="malafat"]');
      const link = band.getByRole('link', { name: copy.link });
      const bandBackground = () => band.evaluate((el) => getComputedStyle(el).backgroundColor);

      await step('After the phone chapter, the band names the firms and the condition, with one link out', async () => {
        await openLanding(page, language);
        await band.scrollIntoViewIfNeeded();
        await expect(band.getByRole('heading', { level: 2 })).toHaveText(copy.title);
        await expect(band.getByRole('link')).toHaveCount(1);
        await expect(link).toHaveAttribute('href', malafatUrl({ locale: language, medium: 'landing', content: 'landing-section' }));
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(band.getByText(language === 'ar' ? /تلقائ|زامن|تقرير|تقارير|داخل/ : /automatic|sync|report|inside/i)).toHaveCount(0);
        await attachScreenshot(page, `malafat-${language}`);
      });

      for (const colorScheme of ['light', 'dark'] as const) {
        await step(`In ${colorScheme} mode the link reads on the band, keeps its colour on hover and rings in its own colour`, async () => {
          // Reduced motion zeroes the global a { transition: color }, so the link's colour is read settled, not mid-fade
          await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
          await band.scrollIntoViewIfNeeded();
          const before = await readColours(link);
          expect(contrast(parseColor(before.color), parseColor(await bandBackground()))).toBeGreaterThanOrEqual(4.5);
          expect(before.decoration).toBe('underline');
          await link.hover();
          await expect.poll(() => link.evaluate((el) => el.matches(':hover'))).toBe(true);
          expect((await readColours(link)).color).toBe(before.color);
          await page.mouse.move(1, 1);
          await link.focus();
          await page.keyboard.press('Shift+Tab');
          await page.keyboard.press('Tab');
          await expect(link).toBeFocused();
          const ring = await link.evaluate((el) => {
            const style = getComputedStyle(el);
            return { style: style.outlineStyle, colour: style.outlineColor, text: style.color };
          });
          expect(ring.style).toBe('solid');
          expect(ring.colour).toBe(ring.text);
        });
      }

      await step('At 375 px the band fits', async () => {
        await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
        await page.setViewportSize({ width: 375, height: 812 });
        await band.scrollIntoViewIfNeeded();
        await expect(page.locator('html')).toHaveAttribute('dir', language === 'ar' ? 'rtl' : 'ltr');
        await expectNoHorizontalOverflow(page, `malafat 375 ${language}`);
        await expectOnlyKnownAxeViolations(page, 'landing');
        await attachScreenshot(page, `malafat-${language}-375`);
      });
    },
  );
}

test.describe('in an English browser with no stored choice', () => {
  test.use({ locale: 'en-US' });

  test('the marketing site opens in Arabic and a chosen language sticks (MUT-202)', { tag: '@web.landing.arabic-default' }, async ({ page, step }) => {
    const stored = () => page.evaluate(() => localStorage.getItem('mutaba3a-language'));

    await step('Every marketing page is in Arabic, right to left, and nothing is stored', async () => {
      for (const path of ['/', '/privacy', '/terms']) {
        await page.goto(path);
        await expect(page.locator('html'), path).toHaveAttribute('lang', 'ar');
        await expect(page.locator('html'), path).toHaveAttribute('dir', 'rtl');
        await expect(page.getByRole('heading', { level: 1 }), path).toBeVisible();
        expect(await stored(), path).toBeNull();
      }
      await attachScreenshot(page, 'arabic-default-terms');
    });

    await step('Back on the landing, still Arabic', async () => {
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    });

    await step('Pressing EN switches to English and it stays after a reload', async () => {
      await page.locator('.landing-lang-toggle').click();
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      expect(await stored()).toBe('en');
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.locator('#hero-title')).toBeVisible();
    });
  });
});

// MUT-179: the landing opens in Arabic (ADR-077), so its mocks' overdue ages are what every visitor reads first.
test("the landing page's mocks word their overdue ages correctly in Arabic", { tag: '@web.landing.arabic-day-counts' }, async ({ page, step }) => {
  await step('Open the landing page in Arabic and look at the hero Clients picture', async () => {
    await openLanding(page, 'ar');
    const clients = page.locator('.landing-mock-client-overdue');
    await expect(clients.filter({ hasText: 'الأقدم 3 أيام' })).toHaveCount(1);
    await expect(clients.filter({ hasText: 'الأقدم 227 يومًا' })).toHaveCount(1);
    await expect(clients.filter({ hasText: 'الأقدم 158 يومًا' })).toHaveCount(1);
  });

  await step('Scroll to the client-profile picture: "متأخر 34 يومًا"', async () => {
    const badge = page.locator('.landing-mock-badge--overdue').first();
    await badge.scrollIntoViewIfNeeded();
    await expect(badge).toHaveText('متأخر 34 يومًا');
  });

  await step('No count above 2 is followed by a bare "يوم"', async () => {
    const ages = await page.locator('.landing-mock-client-overdue, .landing-mock-badge--overdue').allTextContents();
    for (const age of ages) expect(age).not.toMatch(/\d+ يوم(?!ًا)/);
  });
});

test('the FAQ lists ILS, USD, EUR and JOD and no Gulf currency, in English and Arabic (MUT-388)', { tag: '@web.landing.currencies' }, async ({ page, step }) => {
  await step('Open the landing page in English and open "Which currencies does it support?"', async () => {
    await openLanding(page, 'en');
    const question = page.getByRole('button', { name: 'Which currencies does it support?' });
    await question.scrollIntoViewIfNeeded();
    await question.click();
    const answer = page.getByText(/Each amount keeps the currency it was earned in/);
    await expect(answer).toBeVisible();
    for (const name of ['US dollars', 'shekels', 'euros', 'Jordanian dinars']) await expect(answer).toContainText(name);
    await expect(answer).not.toContainText(/dirham|riyal|Bahraini|Omani/i);
  });

  await step('Switch to Arabic and open "ما العملات المدعومة؟"', async () => {
    await openLanding(page, 'ar');
    const question = page.getByRole('button', { name: 'ما العملات المدعومة؟' });
    await question.scrollIntoViewIfNeeded();
    await question.click();
    const answer = page.getByText(/يحتفظ كل مبلغ بالعملة التي كُسب بها/);
    await expect(answer).toBeVisible();
    for (const name of ['الدولار الأمريكي', 'الشيكل', 'اليورو', 'الدينار الأردني']) await expect(answer).toContainText(name);
    await expect(answer).not.toContainText(/درهم|ريال|البحريني|العماني/);
  });
});

/**
 * MUT-369: the landing asks the portal whether signup is open (GET /v1/self-service, answered locally by the
 * `signupDoor` fixture). Open, every way in leads to the portal's /signup in the page language; closed, or with the
 * portal unreachable, the page is today's.
 */
const SIGNUP_LINK = (language: 'en' | 'ar') => new RegExp(`^https://[^/]+/signup\\?lang=${language}$`);

test('While signup is open, the landing leads with Create an account on the portal signup page, in the page language (MUT-369)', { tag: '@web.landing.signup-open' }, async ({ page, step, signupDoor }) => {
  signupDoor!.set('open');
  const hero = page.locator('[data-part="hero"]');
  const getIt = page.locator('[data-part="get-it"]');
  const phone = page.locator('[data-part="phone"]');

  await step('Open the landing page in Arabic, its default: the hero leads with أنشئ حسابًا on /signup?lang=ar', async () => {
    await page.goto('/');
    await expect(heroCta(page)).toHaveAttribute('href', SIGNUP_LINK('ar'));
    await expect(heroCta(page)).toContainText(ar.landing.hero.ctaCreate);
    await expect(heroCta(page)).toHaveAttribute('target', '_blank');
    await expect(hero.getByText(ar.landing.hero.altNoteOpen)).toBeVisible();
    await expect(headerCta(page)).toHaveAttribute('href', SIGNUP_LINK('ar'));
    expect(signupDoor!.requests()).toBe(1);
    await attachScreenshot(page, 'signup-open-ar');
  });

  await step('Switch to English: every Create an account now opens /signup?lang=en', async () => {
    await page.locator('.landing-lang-toggle').click();
    await expect(heroCta(page)).toHaveAttribute('href', SIGNUP_LINK('en'));
    await expect(heroCta(page)).toContainText(en.landing.hero.ctaCreate);
  });

  await step('Get it lists Create an account first and keeps the request form for those who want help', async () => {
    await getIt.scrollIntoViewIfNeeded();
    const first = getIt.locator('.landing-get-it-options a').first();
    await expect(first).toContainText(en.landing.getIt.createCta);
    await expect(first).toHaveAttribute('href', SIGNUP_LINK('en'));
    await expect(getIt.getByRole('heading', { name: en.landing.getIt.requestCtaOpen })).toBeVisible();
    await expect(getIt.getByRole('form')).toBeVisible();
    await expect(page.locator('main')).not.toContainText(/no public sign-up/);
    await expect(getIt).not.toContainText(/[₪$€]\s?\d|\/month|per month|checkout/i);
    await attachScreenshot(page, 'signup-open-get-it-en');
  });

  await step('The phone chapter and the free-plan answer point at signing up', async () => {
    await phone.scrollIntoViewIfNeeded();
    await expect(phone.getByRole('link', { name: new RegExp(`^${en.landing.phone.hintLinkOpen}`) })).toHaveAttribute('href', SIGNUP_LINK('en'));
    await page.getByRole('button', { name: en.landing.faq.q1 }).click();
    await expect(page.getByText(en.landing.faq.a1Open)).toBeVisible();
  });

  await step('Press Create an account: the portal signup page opens in a new tab, in English', async () => {
    await heroCta(page).scrollIntoViewIfNeeded();
    const [popup] = await Promise.all([page.waitForEvent('popup'), heroCta(page).click()]);
    await expect(popup).toHaveURL(SIGNUP_LINK('en'));
    await expect(popup.getByRole('heading', { name: 'Portal signup (QA stand-in)' })).toBeVisible();
    await popup.close();
  });
});

test('While signup is closed, or the portal cannot be asked, the landing is today’s page (MUT-369)', { tag: '@web.landing.signup-closed' }, async ({ page, step, signupDoor }) => {
  for (const state of ['closed', 'unreachable'] as const) {
    await step(`With signup ${state}, the hero still says Request an account and scrolls to the form`, async () => {
      signupDoor!.set(state);
      const before = signupDoor!.requests();
      await openLanding(page, 'en');
      await expect.poll(() => signupDoor!.requests()).toBe(before + 1);
      await expect(heroCta(page)).toHaveAttribute('href', '#get-it');
      await expect(heroCta(page)).toContainText(en.landing.hero.ctaRequest);
      await expect(page.locator('[data-part="hero"]').getByText(en.landing.hero.altNote)).toBeVisible();
      await expect(page.locator('main')).not.toContainText(en.landing.hero.ctaCreate);
      await heroCta(page).click();
      await expect(page).toHaveURL(/#get-it$/);
      await expect(page.locator('[data-part="get-it"]').getByRole('heading', { name: en.landing.getIt.requestCta })).toBeVisible();
      await attachScreenshot(page, `signup-${state}-en`);
    });
  }
});
