import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// Every app page breaks these today: the brand teal fails 4.5:1 (white on
// #1d8a84, the active nav label, the profile avatar, the FX "Live" chip), and
// the top bar, FX banner and desktop-app banner are all banner landmarks.
const APP_SHELL = ['color-contrast', 'landmark-no-duplicate-banner'];

/**
 * Axe rules each surface is known to break (TD-009, measured 2026-10-12).
 * Any other rule fails the test, so a new kind of violation is caught while
 * these wait for their fix. Remove a rule here once its fix lands.
 */
export const KNOWN_AXE_VIOLATIONS = {
  homeFirstRun: [...APP_SHELL],
  home: [...APP_SHELL],
  clients: [...APP_SHELL],
  // the period <select> has no name; the row-actions column header is empty
  clientProfile: [...APP_SHELL, 'select-name', 'empty-table-header'],
  income: [...APP_SHELL, 'select-name', 'empty-table-header'],
  // the default-currency <select> has no name, the business profile's icon
  // button has no text, and the first section heading is an h3 under the h1
  settings: [...APP_SHELL, 'select-name', 'button-name', 'heading-order'],
  // the drawer has role="dialog" but no aria-labelledby; Save is brand teal
  incomeDrawer: ['aria-dialog-name', 'color-contrast'],
} satisfies Record<string, string[]>;

export type AxeSurface = keyof typeof KNOWN_AXE_VIOLATIONS;

/** Runs axe on the page (or only `include`) and fails on any rule not known for `surface`. */
export async function expectOnlyKnownAxeViolations(
  page: Page,
  surface: AxeSurface,
  include?: string,
): Promise<void> {
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
