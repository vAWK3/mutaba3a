import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Brand v2 checks that need a real browser (MUT-102): which faces actually
 * loaded, what an element computes, where font requests go, and whether a
 * page overflows. Token values themselves are proved in Node
 * (src/styles/__tests__/brand.test.ts); these prove the browser agrees.
 */

const tokensFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/styles/brand/mutaba3a.tokens.json');
const tokens = JSON.parse(fs.readFileSync(tokensFile, 'utf8'));

/** The canvas each scheme paints, as the brand CSS declares it. */
export const CANVAS = { light: tokens.color.canvas.oklch as string, dark: tokens.colorDark.canvas.oklch as string };

/** The canvas as the static boot splash writes it (MUT-207): hex, the way boot-splash.css paints before JS. */
export const CANVAS_HEX = { light: tokens.color.canvas.hex as string, dark: tokens.colorDark.canvas.hex as string };

/** `#RRGGBB` as the `rgb(r, g, b)` a computed style reports. */
export function hexToRgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

/** The boot splash's mark before JS, or what took its place after: centre and drawn mark size (MUT-207). */
export async function bootMarkBox(page: Page): Promise<{ cx: number; cy: number; size: number }> {
  return page.evaluate(() => {
    const img = document.querySelector<HTMLElement>('.boot-splash .boot-splash-mark');
    const svg = document.querySelector<SVGSVGElement>('.boot-splash svg');
    const element = img ?? svg;
    if (!element) throw new Error('no boot mark on screen');
    const box = element.getBoundingClientRect();
    // The loader's 120-unit box draws the mark in its inner 100 units
    const size = img ? box.width : (box.width * 100) / 120;
    return { cx: box.x + box.width / 2, cy: box.y + box.height / 2, size };
  });
}

/** The bloom loader's dot, per scheme (MUT-206): purple on light, butter on dark. */
export const MARK_DOT = { light: tokens.color.markDot.oklch as string, dark: tokens.colorDark.markDot.oklch as string };

export const SCHEMES = ['light', 'dark'] as const;

/** Faces the page has finished loading, as "Family weight" (e.g. "Thmanyah Sans 400"). */
export async function loadedFaces(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((face) => face.status === 'loaded').map((face) => `${face.family.replace(/["']/g, '')} ${face.weight}`);
  });
}

/** The first family in an element's computed font stack, its weight and its numeric variant. */
export async function computedFont(locator: Locator): Promise<{ family: string; stack: string; weight: string; numeric: string; size: string }> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      family: style.fontFamily.split(',')[0].replace(/["']/g, '').trim(),
      stack: style.fontFamily,
      weight: style.fontWeight,
      numeric: style.fontVariantNumeric,
      size: style.fontSize,
    };
  });
}

/**
 * Starts recording font and stylesheet requests. Returns the ones that left
 * the page's origin (a CDN), and the font URLs seen, for the end of the test.
 */
export function watchFontRequests(page: Page): () => { offOrigin: string[]; fonts: string[] } {
  const offOrigin: string[] = [];
  const fonts: string[] = [];
  page.on('request', (request) => {
    const type = request.resourceType();
    if (type !== 'font' && type !== 'stylesheet') return;
    if (type === 'font') fonts.push(request.url());
    const pageUrl = page.url();
    if (!pageUrl.startsWith('http')) return;
    if (new URL(request.url()).origin !== new URL(pageUrl).origin) offOrigin.push(request.url());
  });
  return () => ({ offOrigin, fonts });
}

/** The numbers in a colour or length value, so minified (`.975`) and source (`0.975`) forms compare equal. */
export function numbersIn(value: string): number[] {
  return [...value.matchAll(/-?\d*\.?\d+/g)].map((m) => Number(m[0]));
}

/** The computed value of a custom property on <html>, as its numbers. */
export async function rootTokenNumbers(page: Page, name: string): Promise<number[]> {
  const value = await page.evaluate((token) => getComputedStyle(document.documentElement).getPropertyValue(token), name);
  return numbersIn(value);
}

/** What sticks out of the window: sideways page scroll, and any dialog not inside the viewport. */
export function fitProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const found: string[] = [];
    if (root.scrollWidth > root.clientWidth) found.push(`page scrolls sideways: ${root.scrollWidth}px content in ${root.clientWidth}px`);
    for (const dialog of document.querySelectorAll('[role="dialog"]')) {
      const box = dialog.getBoundingClientRect();
      if (Math.round(box.left) < 0 || Math.round(box.right) > window.innerWidth) {
        found.push(`dialog spans ${Math.round(box.left)}..${Math.round(box.right)}px of ${window.innerWidth}px`);
      }
    }
    return found;
  });
}

/** The page never scrolls sideways, and every open dialog comes to rest inside the viewport. */
export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  await expect.poll(() => fitProblems(page), { message: label, timeout: 5_000 }).toEqual([]);
}

/** Attaches a screenshot to the test report, for review of what the brand change looks like. */
export async function attachScreenshot(page: Page, name: string): Promise<void> {
  await test.info().attach(name, { body: await page.screenshot({ fullPage: false }), contentType: 'image/png' });
}
