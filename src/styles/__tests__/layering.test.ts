// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseCss, repoPath } from '../../test/css/brandCss';

/**
 * Stacking order (MUT-92 F2): content sits at 100 or below, fixed top bars
 * above it, and drawers above any top bar, so a drawer header is never
 * clipped under a bar. Modals and toasts stay above drawers.
 */

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
});
