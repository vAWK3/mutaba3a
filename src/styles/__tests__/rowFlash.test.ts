// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The after-save row tint (MUT-81 R1; MUT-91): one rule for every table that
 * renders `tr.row-flash`, the app's `.data-table` and the portal's `.table`
 * alike, with the leading rail on the row's start edge in both directions.
 * jsdom runs no CSS, so this pins the stylesheet; Playwright checks the paint.
 */

const css = readFileSync('src/index.css', 'utf8');

function declarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match) throw new Error(`no rule for ${selector}`);
  return match[1];
}

describe('row-flash tint', () => {
  it('is not scoped to the app table, so the portal table tints too', () => {
    expect(declarations('tr.row-flash > td')).toMatch(/animation:\s*saved-flash-fade 1\.5s/);
    expect(css).not.toMatch(/\.data-table tr\.row-flash/);
  });

  it('puts the rail on the inline-start edge: left in LTR, right in RTL', () => {
    expect(declarations('tr.row-flash > td:first-child')).toMatch(/box-shadow:\s*inset 3px 0 0 var\(--accent\)/);
    expect(declarations('[dir="rtl"] tr.row-flash > td:first-child')).toMatch(/box-shadow:\s*inset -3px 0 0 var\(--accent\)/);
  });

  it('holds the tint without the fade under reduced motion', () => {
    const reduced = /@media \(prefers-reduced-motion: reduce\)\s*\{\s*tr\.row-flash > td\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(reduced).toMatch(/animation:\s*none/);
    expect(reduced).toMatch(/background-color:\s*var\(--accent-subtle\)/);
  });
});
