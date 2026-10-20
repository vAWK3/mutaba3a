import type { Locator } from '@playwright/test';

/**
 * How an element's text actually sits on screen (MUT-109). jsdom runs no CSS cascade and no
 * bidi algorithm, so direction is only provable in a browser.
 */
export interface BidiReading {
  /** The element's characters in the order a person sees them, left to right on screen. */
  visual: string;
  /** Computed `direction`: what the cascade resolved, whatever the markup says. */
  direction: string;
  /** The `dir` attribute as written, or null. */
  dir: string | null;
  textAlign: string;
}

/**
 * Reads an element's text by where each character lands: every character's box,
 * sorted by its left edge. Zero-width characters (the RLM an Arabic currency string
 * starts with) drop out, and runs of whitespace read as one space.
 */
export function readBidi(locator: Locator): Promise<BidiReading> {
  return locator.evaluate((element) => {
    const placed: [number, string][] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? '';
      for (let i = 0; i < text.length; i++) {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const box = range.getBoundingClientRect();
        if (box.width > 0) placed.push([box.left, text[i]]);
      }
    }
    placed.sort((a, b) => a[0] - b[0]);
    const style = getComputedStyle(element);
    return {
      visual: placed.map(([, char]) => char).join('').replace(/\s+/g, ' ').trim(),
      direction: style.direction,
      dir: element.getAttribute('dir'),
      textAlign: style.textAlign,
    };
  });
}

/**
 * Computed direction of a form field, whose value has no text boxes to read, and the side
 * its text sits on (`start` / `end` resolved against the field's own direction).
 */
export function readField(locator: Locator): Promise<{ direction: string; dir: string | null; side: 'left' | 'right' | 'center' }> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    const rtl = style.direction === 'rtl';
    const align = style.textAlign;
    const side =
      align === 'start' ? (rtl ? 'right' : 'left') : align === 'end' ? (rtl ? 'left' : 'right') : align === 'center' ? 'center' : align === 'right' ? 'right' : 'left';
    return { direction: style.direction, dir: element.getAttribute('dir'), side };
  });
}
