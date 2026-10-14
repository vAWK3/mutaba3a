// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The Hosted account row at phone width (MUT-187 follow-up): its .btn is
 * nowrap, so the row's auto grid track grew to the button's width, past the
 * Settings column. The visually hidden "(opens in a new tab)" spans are
 * position: absolute with no positioned ancestor, so they escaped
 * .page-content's clipping and the whole page scrolled sideways (406px in a
 * 375px window). jsdom runs no CSS, so this pins the stylesheet;
 * @web.brand.layout checks the page at 375px.
 */

const css = readFileSync('src/pages/settings/HostedAccountEntry.css', 'utf8');
const tsx = readFileSync('src/pages/settings/HostedAccountEntry.tsx', 'utf8');

function declarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match) throw new Error(`no rule for ${selector}`);
  return match[1];
}

describe('HostedAccountEntry.css at phone width', () => {
  it('keeps the visually hidden link text inside the row, where the page clips it', () => {
    expect(declarations('.hosted-account-entry')).toMatch(/position:\s*relative/);
  });

  it('never lets its one column grow past the Settings column', () => {
    expect(declarations('.hosted-account-entry')).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(declarations('.hosted-account-entry')).toMatch(/overflow-wrap:\s*break-word/);
  });

  it('lets the button wrap and grow taller instead of widening the row', () => {
    const cta = declarations('.hosted-account-entry .hosted-account-entry-cta');
    expect(cta).toMatch(/white-space:\s*normal/);
    expect(cta).toMatch(/max-inline-size:\s*100%/);
    expect(cta).toMatch(/block-size:\s*auto/);
    expect(cta).toMatch(/min-block-size:\s*var\(--space-8\)/);
    expect(tsx).toMatch(/className="btn btn-sm btn-secondary hosted-account-entry-cta"/);
  });

  it('uses logical properties only, so the row reads the same in RTL', () => {
    expect(css).not.toMatch(/(?:^|[\s;{])(?:border|margin|padding)-(?:top|bottom|left|right)\s*:/m);
    expect(css).not.toMatch(/(?:^|[\s;{])(?:width|height|min-width|max-width|left|right|top|bottom)\s*:/m);
  });
});
