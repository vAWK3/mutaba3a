// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseCss, repoPath } from '../../test/css/brandCss';

/**
 * Stacking order (MUT-92 F2): content sits at 100 or below, fixed top bars
 * above it, and drawers above any top bar, so a drawer header is never
 * clipped under the demo bar. Modals and toasts stay above drawers.
 */

const CONTENT_MAX = 100;

function zIndexOf(file: string, selector: string): number {
  let value: string | undefined;
  parseCss(repoPath(file)).walkRules((rule) => {
    if (!rule.selectors.includes(selector)) return;
    rule.walkDecls('z-index', (decl) => {
      value = decl.value;
    });
  });
  if (value === undefined) throw new Error(`${selector} has no z-index in ${file}`);
  return Number(value);
}

describe('layering', () => {
  const overlay = zIndexOf('src/index.css', '.drawer-overlay');
  const drawer = zIndexOf('src/index.css', '.drawer');

  it('keeps the drawer above its own overlay', () => {
    expect(drawer).toBeGreaterThan(overlay);
  });

  it('puts the demo bar above content and below drawers', () => {
    const demoBanner = zIndexOf('src/components/ui/DemoBanner.css', '.demo-banner');

    expect(demoBanner).toBeGreaterThan(CONTENT_MAX);
    expect(demoBanner).toBeLessThan(overlay);
  });
});
