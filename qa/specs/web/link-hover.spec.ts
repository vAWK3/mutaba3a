import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../support/qa';
import { SCHEMES } from '../../support/brand';

/**
 * TD-122 in a real browser: the global link hover (`--link-hover` and an
 * underline) applies to unclassed links only. A classed control keeps its own
 * label colour on hover with no underline; a classed inline text link declares
 * its own hover and still underlines. The CSS rules are guarded in Node in
 * src/styles/__tests__/brand.test.ts. Links are found by class here because
 * the class is the subject.
 */

interface LinkStyle {
  color: string;
  decoration: string;
}

function linkStyle(link: Locator): Promise<LinkStyle> {
  return link.evaluate((el) => {
    const style = getComputedStyle(el);
    return { color: style.color, decoration: style.textDecorationLine };
  });
}

/** Hovers `link` from a resting pointer and returns its style before and after. */
async function hoverStyles(page: Page, link: Locator): Promise<{ before: LinkStyle; after: () => Promise<LinkStyle> }> {
  await link.scrollIntoViewIfNeeded();
  await expect(link).toBeVisible();
  // Rest the pointer off every control (the window's bottom-right corner) before reading the resting style
  const viewport = page.viewportSize()!;
  await page.mouse.move(viewport.width - 1, viewport.height - 1);
  const before = await linkStyle(link);
  await link.hover();
  return { before, after: () => linkStyle(link) };
}

/** A colour token as the page computes it. */
function tokenColor(page: Page, token: string): Promise<string> {
  return page.evaluate((value) => {
    const probe = document.createElement('span');
    probe.style.color = value;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, `var(${token})`);
}

/**
 * A control gains no underline, and its label keeps its colour, or takes the
 * one its own :hover sets (`hoverToken`), never the global link colour.
 */
async function expectControlHover(page: Page, label: string, link: Locator, hoverToken?: string) {
  const { before, after } = await hoverStyles(page, link);
  const color = hoverToken ? await tokenColor(page, hoverToken) : before.color;
  await expect.poll(after, { message: `${label}: hovered style` }).toEqual({ color, decoration: 'none' });
}

/** An inline text link still says "link" on hover: it underlines. */
async function expectTextLinkHover(page: Page, label: string, link: Locator) {
  const { after } = await hoverStyles(page, link);
  await expect.poll(async () => (await after()).decoration, { message: `${label}: hovered underline` }).toBe('underline');
}

for (const scheme of SCHEMES) {
  test(
    `${scheme} mode: on the landing and privacy pages, hovered controls keep their label colour and text links underline`,
    { tag: '@web.brand.link-hover' },
    async ({ page, step }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });

      await step('Landing: the hero button and a Get it card keep their colours; the hero’s other link underlines', async () => {
        await page.goto('/');
        await expect(page.locator('#hero-title')).toBeVisible();
        await expectControlHover(page, 'hero button', page.locator('a.hero-cta-primary'));
        await expectTextLinkHover(page, 'hero alt link', page.locator('a.hero-cta-alt').first());
        await expectControlHover(page, 'Get it card', page.locator('a.landing-get-it-option').first());
      });

      await step('An unclassed link still takes the link hover: --link-hover and an underline', async () => {
        // The landing page has no unclassed link of its own that a parent rule leaves alone
        await page.evaluate(() => {
          const link = Object.assign(document.createElement('a'), { href: '#plain', textContent: 'A plain link' });
          document.querySelector('main')!.prepend(link);
        });
        const linkHover = await tokenColor(page, '--link-hover');
        const { after } = await hoverStyles(page, page.getByRole('link', { name: 'A plain link' }));
        await expect.poll(after).toEqual({ color: linkHover, decoration: 'underline' });
      });

      await step('Privacy: the back link underlines', async () => {
        await page.goto('/privacy');
        await expectTextLinkHover(page, 'privacy back link', page.locator('a.privacy-policy-back'));
      });
    },
  );
}
