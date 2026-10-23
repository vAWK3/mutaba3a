import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import postcss, { type AtRule, type Declaration, type Rule } from 'postcss';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { repoPath } from '../../../test/css/brandCss';
import { BrandName, Logotype } from '../Logotype';

/**
 * The MTB3A logotype and the per-language brand name (MUT-402 D1). The
 * component tests pin the accessible names; the stylesheet tests pin the
 * paint rules jsdom cannot render (mask, forced colours, print).
 */

const CSS_FILE = repoPath('src/components/brand/Logotype.css');
const css = postcss.parse(readFileSync(CSS_FILE, 'utf8'));

/** The declarations of the rule with exactly this selector, inside `media` (or at top level when omitted). */
function decls(selector: string, media?: string): Record<string, string> {
  const found: Record<string, string> = {};
  css.walkRules((rule: Rule) => {
    const parent = rule.parent as AtRule | undefined;
    const inMedia = parent?.type === 'atrule' ? parent.params : undefined;
    if (inMedia !== media || !rule.selectors.includes(selector)) return;
    rule.walkDecls((decl: Declaration) => {
      found[decl.prop] = decl.value.replace(/\s+/g, ' ').trim();
    });
  });
  return found;
}

const FORCED = '(forced-colors: active)';
const PRINT = 'print';

describe('Logotype', () => {
  it('is one image named MTB3A in English, with no text of its own', () => {
    const { container } = render(<Logotype />);
    const logotype = screen.getByRole('img', { name: 'MTB3A' });
    expect(logotype).toHaveAttribute('lang', 'en');
    expect(logotype).toHaveClass('logotype');
    expect(container.textContent).toBe('');
  });
});

describe('BrandName', () => {
  it('draws the logotype in English', () => {
    render(<BrandName language="en" />);
    expect(screen.getByRole('img', { name: 'MTB3A' })).toBeInTheDocument();
  });

  it('writes متابعة as live Arabic text in Arabic, with no logotype', () => {
    const { container } = render(<BrandName language="ar" className="wordmark-other" />);
    const name = container.querySelector('.brand-name-ar');
    expect(name).toHaveTextContent('متابعة');
    expect(name).toHaveAttribute('lang', 'ar');
    expect(name).toHaveClass('wordmark-other');
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('Logotype.css', () => {
  it('masks the one pinned wordmark.svg, with both the standard and -webkit- properties', () => {
    const logotype = decls('.logotype');
    for (const prop of ['mask-image', '-webkit-mask-image']) {
      const url = /url\(["']?([^"')]+)["']?\)/.exec(logotype[prop] ?? '')?.[1];
      expect(url, prop).toBeDefined();
      expect(resolve(dirname(CSS_FILE), url!)).toBe(repoPath('src/assets/brand/wordmark.svg'));
    }
  });

  it('paints the logotype in currentColor, so it matches the live name beside it (design D6)', () => {
    expect(decls('.logotype')['background-color']).toBe('currentColor');
  });

  it('pins the mask box: block-level, unshrinkable, sized by H, one unrepeated mask (design D9)', () => {
    expect(decls('.logotype')).toMatchObject({
      display: 'inline-block',
      flex: 'none',
      height: 'var(--wordmark-h)',
      width: 'calc(var(--wordmark-h) * var(--m-wordmark-aspect))',
      'mask-size': '100% 100%',
      '-webkit-mask-size': '100% 100%',
      'mask-repeat': 'no-repeat',
      '-webkit-mask-repeat': 'no-repeat',
      'mask-position': 'center',
      '-webkit-mask-position': 'center',
    });
  });

  it('declares H on the lockup and on each name, never on :root, so every surface keeps its own size (OV-8)', () => {
    const h = 'calc(var(--wordmark-mark, calc(var(--m-wordmark-min-height) / var(--m-wordmark-logotype-to-mark))) * var(--m-wordmark-logotype-to-mark))';
    for (const selector of ['.wordmark', '.logotype', '.brand-name-ar', '.wordmark-separator']) expect(decls(selector)['--wordmark-h'], selector).toBe(h);
    const owners: string[] = [];
    css.walkDecls('--wordmark-h', (decl) => owners.push((decl.parent as Rule).selector));
    expect(owners.join(',')).not.toMatch(/:root|\[data-theme/);
  });

  it('reads only defined custom properties; --wordmark-mark (set from the markSize prop) always with its fallback (OV-3)', () => {
    const defined = new Set<string>();
    for (const file of ['src/styles/theme.css', 'src/styles/brand/mutaba3a-theme.css', 'src/components/brand/Logotype.css']) {
      postcss.parse(readFileSync(repoPath(file), 'utf8')).walkDecls((decl) => {
        if (decl.prop.startsWith('--')) defined.add(decl.prop);
      });
    }
    const undefinedReads: string[] = [];
    css.walkDecls((decl) => {
      for (const match of decl.value.matchAll(/var\(\s*(--[\w-]+)\s*(,)?/g)) {
        if (match[1] === '--wordmark-mark' ? !match[2] : !defined.has(match[1])) undefinedReads.push(`${decl.prop}: ${match[1]}`);
      }
    });
    expect(undefinedReads).toEqual([]);
  });

  it('spaces the lockup at 0.60 H between every item, as the kit asks (OV-9)', () => {
    expect(decls('.wordmark').gap).toBe('calc(var(--wordmark-h) * var(--m-wordmark-gap))');
  });

  it('sets the Arabic name’s own type, so nothing it inherits can change it (design D8)', () => {
    expect(decls('.brand-name-ar')).toMatchObject({
      'font-family': 'var(--font-heading-ar)',
      'font-size': 'calc(var(--wordmark-h) * var(--m-wordmark-arabic-size))',
      'font-weight': 'var(--weight-bold)',
      'line-height': '1',
      'letter-spacing': '0',
    });
  });

  it('draws the separator as a round markDot with a 3 px floor (design D10, OV-10)', () => {
    const size = 'max(calc(var(--wordmark-h) * var(--m-wordmark-separator)), var(--m-wordmark-separator-min))';
    expect(decls('.wordmark-separator')).toMatchObject({
      width: size,
      height: size,
      'border-radius': 'var(--radius-pill)',
      'background-color': 'var(--mark-dot)',
      flex: 'none',
    });
  });

  it('paints the logotype and the dot in the system colour their live text gets in forced colours, so the lockup is one colour (design D11, D14)', () => {
    // Opted out of forcing, currentColor would be the unforced ink, so each context names its colour
    for (const selector of ['.logotype', '.wordmark-separator']) {
      expect(decls(selector, FORCED), selector).toMatchObject({ 'background-color': 'CanvasText', 'forced-color-adjust': 'none' });
      expect(decls(`a ${selector}`, FORCED)['background-color'], `a ${selector}`).toBe('LinkText');
      expect(decls(`a:visited ${selector}`, FORCED)['background-color'], `a:visited ${selector}`).toBe('VisitedText');
    }
  });

  it('rings the mark on its square box in forced colours, never rounding (and so clipping) the image (design D15, R2, OV-13)', () => {
    const ring = decls('.wordmark .wordmark-mark', FORCED);
    expect(ring).toEqual({ outline: '1px solid CanvasText', 'outline-offset': '2px' });
    const outlinedElsewhere: string[] = [];
    css.walkDecls(/^outline/, (decl) => {
      if ((decl.parent?.parent as AtRule | undefined)?.params !== FORCED) outlinedElsewhere.push(decl.prop);
    });
    expect(outlinedElsewhere).toEqual([]);
  });

  it('prints the whole lockup in the light ink, so a dark-theme printout stays readable (design D5, R4)', () => {
    expect(decls('.wordmark', PRINT).color).toBe('var(--m-wordmark-print-ink)');
    for (const selector of ['.logotype', '.wordmark-separator']) {
      expect(decls(selector, PRINT), selector).toMatchObject({
        'background-color': 'currentColor',
        'print-color-adjust': 'exact',
        '-webkit-print-color-adjust': 'exact',
      });
    }
  });
});

describe('the portal preload (design D4, eng re-run R3)', () => {
  it('hosted.html preloads, once and in CORS mode, the very file Logotype.css masks with', () => {
    const html = readFileSync(repoPath('hosted.html'), 'utf8');
    const preloads = [...html.matchAll(/<link\b[^>]*\brel="preload"[^>]*>/g)].map((match) => match[0]);
    expect(preloads).toHaveLength(1);
    const [link] = preloads;
    for (const attribute of [/\bas="image"/, /\btype="image\/svg\+xml"/, /\scrossorigin[\s/>]/]) expect(link).toMatch(attribute);
    const href = /\bhref="([^"]+)"/.exec(link)![1];
    // Vite rewrites every <link href> (no rel filter) and the CSS url() to one hashed asset, so equal sources mean equal URLs
    const masked = /url\(["']?([^"')]+)["']?\)/.exec(decls('.logotype')['mask-image'])![1];
    expect(resolve(repoPath(''), href)).toBe(resolve(dirname(CSS_FILE), masked));
  });
});

describe('the retired lockup CSS (design D8, OV-4)', () => {
  const sheet = (file: string) => postcss.parse(readFileSync(repoPath(file), 'utf8'));
  const RETIRED_PROPS = ['gap', 'font-family', 'font-size', 'font-weight', 'letter-spacing'];

  it.each([
    ['src/pages/landing/LandingPage.css', '.landing-wordmark'],
    ['src/hosted/hosted.css', '.hp-wordmark'],
    ['src/hosted/hosted.css', '.hp-side-wordmark'],
  ])('%s %s sets no gap or type that would fight the tokens', (file, selector) => {
    const set: string[] = [];
    sheet(file).walkRules((rule) => {
      if (!rule.selectors.includes(selector)) return;
      rule.walkDecls((decl) => {
        if (RETIRED_PROPS.includes(decl.prop)) set.push(decl.prop);
      });
    });
    expect(set).toEqual([]);
  });

  it('the old full/short name spans and the portal’s RTL heading font are gone', () => {
    const selectors: string[] = [];
    for (const file of ['src/pages/landing/LandingPage.css', 'src/hosted/hosted.css']) {
      sheet(file).walkRules((rule) => {
        selectors.push(...rule.selectors);
      });
    }
    expect(selectors.filter((selector) => /landing-wordmark-(full|short)|\[dir="rtl"\] \.hp-wordmark\b/.test(selector))).toEqual([]);
  });

  it('a phone shows the mark and the active name only: the other name and the dot hide at 480px and below', () => {
    const hidden: string[] = [];
    sheet('src/pages/landing/LandingPage.css').walkAtRules('media', (at) => {
      if (!/max-width:\s*480px/.test(at.params)) return;
      at.walkRules((rule) => {
        const hides = rule.some((node) => node.type === 'decl' && node.prop === 'display' && node.value === 'none');
        if (rule.selectors.includes('.landing-wordmark .wordmark-other') && hides) hidden.push(rule.selector);
      });
    });
    expect(hidden).toEqual(['.landing-wordmark .wordmark-other']);
  });
});
