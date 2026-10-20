import type { Page } from '@playwright/test';

/**
 * Exit motion, measured in a real browser. jsdom has no layout, so a spec
 * proves a slide-out here: the app lays an inert copy of what is leaving over
 * the page and animates it with inline styles, and this follows that copy
 * frame by frame (MutationObserver + requestAnimationFrame) until it leaves.
 *
 * Used by the drawers' exit snapshot (MUT-80) and Home's paid row (MUT-82).
 */
export interface ExitTrace {
  added: boolean;
  removed: boolean;
  /** Smallest and largest `translateX` seen, in px */
  minX: number;
  maxX: number;
  /** Smallest inline opacity seen (1 if none was set) */
  minOpacity: number;
}

/** Start tracing the next element matching `selector` that is added to the page. */
export async function traceExit(page: Page, selector: string): Promise<void> {
  await page.evaluate((match) => {
    const trace: ExitTrace = { added: false, removed: false, minX: 0, maxX: 0, minOpacity: 1 };
    (window as unknown as { __qaExit: ExitTrace }).__qaExit = trace;
    new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement) || !node.matches(match)) return;
          trace.added = true;
          const tick = () => {
            const x = /translateX\((-?[\d.]+)px\)/.exec(node.style.transform);
            if (x) {
              trace.minX = Math.min(trace.minX, Number(x[1]));
              trace.maxX = Math.max(trace.maxX, Number(x[1]));
            }
            if (node.style.opacity) trace.minOpacity = Math.min(trace.minOpacity, Number(node.style.opacity));
            if (node.isConnected) requestAnimationFrame(tick);
            else trace.removed = true;
          };
          tick();
        });
      }
    }).observe(document.body, { childList: true, subtree: true });
  }, selector);
}

/** What `traceExit` has seen so far. */
export const readExitTrace = (page: Page): Promise<ExitTrace> =>
  page.evaluate(() => (window as unknown as { __qaExit: ExitTrace }).__qaExit);

/**
 * The save-feedback icon's pop (MUT-338), measured frame by frame. Every
 * `.save-feedback-icon [data-part]` on the page has its inline `scale()` read on
 * each animation frame, so a spec can tell the two presets apart by their curve:
 * playful overshoots past 1 before settling, restrained never does, and reduced
 * motion paints 1 from the first frame.
 */
export interface IconScaleTrace {
  /** Frames on which at least one icon part was on the page */
  frames: number;
  /** Smallest and largest scale seen across every part */
  min: number;
  max: number;
  /** Scale of the last frame seen */
  last: number;
}

/** Start sampling. Call before the save so the first painted frame is caught. */
export async function traceIconScale(page: Page): Promise<void> {
  await page.evaluate(() => {
    const trace: IconScaleTrace = { frames: 0, min: Infinity, max: -Infinity, last: NaN };
    (window as unknown as { __qaIconScale: IconScaleTrace }).__qaIconScale = trace;
    const tick = () => {
      const parts = document.querySelectorAll<SVGElement | HTMLElement>('.save-feedback-icon [data-part]');
      if (parts.length) {
        trace.frames += 1;
        parts.forEach((part) => {
          const scale = /scale\((-?[\d.]+)\)/.exec(part.style.transform);
          if (!scale) return;
          const value = Number(scale[1]);
          trace.min = Math.min(trace.min, value);
          trace.max = Math.max(trace.max, value);
          trace.last = value;
        });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** What `traceIconScale` has seen so far. */
export const readIconScale = (page: Page): Promise<IconScaleTrace> =>
  page.evaluate(() => (window as unknown as { __qaIconScale: IconScaleTrace }).__qaIconScale);
