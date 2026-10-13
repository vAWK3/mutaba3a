// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Press feedback (L10, MUT-91): every Button and every `.press` control
 * presses in on pointer-down from the MUT-102 tokens. It uses the individual
 * `scale` property, never `transform`, so a control that already positions
 * itself with a transform (the portal's show-password toggle sits on
 * `translateY(-50%)`) doesn't move when pressed. jsdom computes neither, so
 * this pins the stylesheet; the pointer-down check itself runs in Playwright.
 */

const indexCss = readFileSync('src/index.css', 'utf8');
const buttonCss = readFileSync('src/components/ui/Button.css', 'utf8');

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match) throw new Error(`no rule for ${selector}`);
  return match[1];
}

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : cssFiles(path);
    return path.endsWith('.css') ? [path] : [];
  });
}

describe('press feedback (L10)', () => {
  it('Buttons and .press controls scale to the press token on pointer-down, with no transform', () => {
    const active = rule(indexCss, ':is(.btn, .press):active:not(:disabled)');
    expect(active).toMatch(/\bscale:\s*var\(--press-scale\)/);
    expect(active).not.toMatch(/transform/);
  });

  it('.press transitions only its scale, on the press duration and the brand spring', () => {
    expect(rule(indexCss, '.press')).toMatch(/transition:\s*scale var\(--duration-press\) var\(--ease-spring\)/);
  });

  it('Button owns its own transition list: scale on the press tokens, no transform, no 1px nudge', () => {
    const btn = rule(buttonCss, '.btn');
    expect(btn).toMatch(/scale var\(--duration-press\) var\(--ease-spring\)/);
    expect(btn).not.toMatch(/transform/);
    expect(buttonCss).not.toMatch(/translateY\(1px\)/);
  });

  it('no stylesheet presses with transform: scale on the press token', () => {
    const offenders = cssFiles('src').filter((path) => /transform:\s*scale\(var\(--press-scale\)\)/.test(readFileSync(path, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('reduced motion turns the press off through the token, not per rule', () => {
    const theme = readFileSync('src/styles/theme.css', 'utf8');
    const reduced = /@media \(prefers-reduced-motion: reduce\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(theme)?.[1] ?? '';
    expect(reduced).toMatch(/--press-scale:\s*1;/);
    expect(reduced).toMatch(/--duration-press:\s*0ms;/);
  });
});
