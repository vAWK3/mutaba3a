import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Axe rules each surface is known to break (TD-009). Any other rule fails the
 * test, so a new kind of violation is caught while these wait for their fix.
 * Remove a rule here once its fix lands.
 *
 * Brand v2 (MUT-102) retired `color-contrast` from every app surface: it now
 * passes in light and dark (qa/specs/web/brand.spec.ts).
 */
export const KNOWN_AXE_VIOLATIONS = {
  homeFirstRun: [],
  home: [],
  clients: [],
  clientProfile: [],
  // A client open beside the list (MUT-84): both panes at once
  clientsSplit: [],
  income: [],
  settings: [],
  incomeDrawer: [],
  paymentDrawer: [],
  landing: [],
  // The language switch sits above <main>, outside any landmark (MUT-43 layout; TD-081)
  portalSignIn: ['region'],
} satisfies Record<string, string[]>;

export type AxeSurface = keyof typeof KNOWN_AXE_VIOLATIONS;

/**
 * Waits until nothing is mid-entrance or mid-exit: axe measures contrast on what
 * is painted, so a drawer fading in (or an exit snapshot of the last one fading
 * out) reads as washed-out text. Drawers carry inline opacity/transform only
 * while they move (MUT-80); finite CSS/WAAPI animations must have finished.
 */
async function settle(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const moving = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].some((el) => el.style.opacity !== '' || el.style.transform !== '');
        const animating = document.getAnimations().some((a) => a.playState === 'running' && a.effect?.getComputedTiming().endTime !== Infinity);
        return moving || animating;
      }),
    )
    .toBe(false);
}

/** Runs axe on the page (or only `include`) and fails on any rule not known for `surface`. */
export async function expectOnlyKnownAxeViolations(
  page: Page,
  surface: AxeSurface,
  include?: string,
): Promise<void> {
  await settle(page);
  const builder = new AxeBuilder({ page });
  if (include) builder.include(include);
  const { violations } = await builder.analyze();

  const known: string[] = KNOWN_AXE_VIOLATIONS[surface];
  const unexpected = violations
    .filter((violation) => !known.includes(violation.id))
    .map((violation) => ({
      rule: violation.id,
      impact: violation.impact,
      help: violation.help,
      targets: violation.nodes.map((node) => node.target.join(' ')),
    }));
  expect(unexpected, `axe rules not in KNOWN_AXE_VIOLATIONS.${surface}`).toEqual([]);

  // A known rule that no longer fires is good news; say so, so the list shrinks.
  const fixed = known.filter((rule) => !violations.some((violation) => violation.id === rule));
  if (fixed.length > 0) {
    test.info().annotations.push({
      type: 'axe-known-violation-gone',
      description: `${surface}: ${fixed.join(', ')} no longer reported; remove from KNOWN_AXE_VIOLATIONS`,
    });
  }
}
