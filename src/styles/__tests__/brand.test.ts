// @vitest-environment node
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import tokensJson from '../brand/mutaba3a.tokens.json';
import thmanyahPins from '../../assets/fonts/thmanyah.sha256.json';
import {
  THEME_STATES,
  Tokens,
  bareVarReferences,
  colorPairs,
  contrast,
  customPropertyDefinitions,
  fontFaces,
  loadStylesheet,
  parseCss,
  parseColor,
  parseOklch,
  repoPath,
  schemeOf,
  sourceFiles,
  stylesheetFromCss,
  toHex,
  type Rgba,
  type ThemeState,
} from '../../test/css/brandCss';

/**
 * Brand v2 foundation (MUT-102): the contracts the token file and the fonts
 * keep. One `describe` per contract (eng review D2).
 */

/** The delivered Thmanyah files, pinned by sha256 in one file that `check-bundles` reads too. */
const THMANYAH_SHA256: Record<string, string> = thmanyahPins.files;

const THEME_CSS = repoPath('src/styles/theme.css');
const BRAND_CSS = repoPath('src/styles/brand/mutaba3a-theme.css');
const FONTS_DIR = repoPath('src/assets/fonts');
const FONTS_CSS = repoPath('src/styles/brand/fonts.css');

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

describe('fonts', () => {
  it.each(Object.entries(THMANYAH_SHA256))('bundles %s byte-identical to the delivered file', (name, hash) => {
    expect(sha256(`${FONTS_DIR}/${name}`)).toBe(hash);
  });

  it('src/assets/fonts holds exactly the pinned Thmanyah files, so nothing unpinned can pass as delivered', () => {
    expect(readdirSync(FONTS_DIR).filter((name) => /thmanyah.*\.otf$/i.test(name)).sort()).toEqual(Object.keys(THMANYAH_SHA256).sort());
  });

  it('keeps no Thmanyah copy in public/ (the portal cannot see it; one location only)', () => {
    // MUT-145 deleted public/fonts (the PDF-only TTFs); if it ever comes back,
    // it still must not hold a Thmanyah copy.
    const dir = repoPath('public/fonts');
    const names = existsSync(dir) ? readdirSync(dir) : [];
    expect(names.filter((name) => /thmanyah/i.test(name))).toEqual([]);
  });

  it('declares Thmanyah Sans 400/500/700 and Serif Display 400/700, all swap, all from the bundled files', () => {
    const faces = fontFaces(FONTS_CSS).map((face) => ({
      family: face.family,
      weight: face.weight,
      style: face.style,
      display: face.display,
      files: face.files.map((file) => basename(file)),
    }));
    expect(faces).toEqual([
      { family: 'Thmanyah Sans', weight: '400', style: 'normal', display: 'swap', files: ['thmanyahsans-Regular.otf'] },
      { family: 'Thmanyah Sans', weight: '500', style: 'normal', display: 'swap', files: ['thmanyahsans-Medium.otf'] },
      { family: 'Thmanyah Sans', weight: '700', style: 'normal', display: 'swap', files: ['thmanyahsans-Bold.otf'] },
      { family: 'Thmanyah Serif Display', weight: '400', style: 'normal', display: 'swap', files: ['thmanyah-serif-display-regular.otf'] },
      { family: 'Thmanyah Serif Display', weight: '700', style: 'normal', display: 'swap', files: ['thmanyah-serif-display-bold.otf'] },
    ]);
    for (const face of fontFaces(FONTS_CSS)) for (const file of face.files) expect(existsSync(file), file).toBe(true);
  });

  it('loads Plex Mono 400/500 from @fontsource (OFL woff2), not from a CDN', () => {
    const css = readFileSync(FONTS_CSS, 'utf8');
    const imports = [...css.matchAll(/@import\s+["']([^"']+)["']/g)].map((m) => m[1]);
    expect(imports).toEqual(['@fontsource/ibm-plex-mono/400.css', '@fontsource/ibm-plex-mono/500.css']);
    expect(css).not.toMatch(/https?:\/\//);
  });

  it('retires Inter, Source Serif 4 and Plex Sans Arabic from package.json and the entries', () => {
    const retired = /@fontsource(-variable)?\/(inter|source-serif-4|ibm-plex-sans-arabic)\b/;
    const pkg = JSON.parse(readFileSync(repoPath('package.json'), 'utf8')) as Record<string, Record<string, string>>;
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((name) => retired.test(name))).toEqual([]);
    for (const file of ['src/main.tsx', 'src/hosted/main.tsx', 'src/vite-env.d.ts']) {
      expect(readFileSync(repoPath(file), 'utf8'), file).not.toMatch(/@fontsource/);
    }
  });

  it('sets the page face in theme.css only: no other stylesheet sets font-family on html, body or :root', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles().filter((f) => f.endsWith('.css') && f !== repoPath('src/styles/theme.css'))) {
      parseCss(file).walkRules((rule) => {
        const roots = rule.selectors.filter((sel) => /^(html|body|:root)(:lang\([a-z-]+\))?$/.test(sel.trim()));
        if (roots.length > 0 && rule.nodes.some((n) => n.type === 'decl' && n.prop === 'font-family')) offenders.push(`${file}: ${rule.selector}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('never fakes a bold: html sets font-synthesis-weight none, so an inherited 600 on Plex Mono renders its 500 file', () => {
    const declared: string[] = [];
    parseCss(repoPath('src/styles/theme.css')).walkRules((rule) => {
      if (!rule.selectors.includes('html')) return;
      rule.walkDecls('font-synthesis-weight', (decl) => {
        declared.push(decl.value);
      });
    });
    expect(declared).toEqual(['none']);
  });

  it('asks Plex Mono only for the weights it ships (400/500), so no figure is faux-bold', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles().filter((f) => f.endsWith('.css'))) {
      parseCss(file).walkRules((rule) => {
        const decl = (prop: string) => rule.nodes.find((n) => n.type === 'decl' && n.prop === prop) as { value: string } | undefined;
        if (!decl('font-family')?.value.includes('var(--font-mono)')) return;
        const weight = decl('font-weight')?.value ?? '';
        if (/var\(--weight-(semibold|bold)\)|^[6-9]00$|bold/.test(weight)) offenders.push(`${file}: ${rule.selector} (${weight})`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('both entries take their fonts from theme.css alone', () => {
    for (const file of ['src/main.tsx', 'src/hosted/main.tsx']) {
      expect(readFileSync(repoPath(file), 'utf8'), file).toMatch(/import ['"](\.\.?\/)+styles\/theme\.css['"]/);
    }
  });
});

const LIGHT: ThemeState = THEME_STATES['OS light'];
const DARK: ThemeState = THEME_STATES['OS dark'];
const STATES = Object.entries(THEME_STATES) as [string, ThemeState][];

const kebab = (key: string) => key.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
const squash = (value: string) => value.replace(/\s+/g, ' ').trim();

function channelsClose(actual: string, expected: string): boolean {
  const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [a, e] = [channels(actual), channels(expected)];
  return a.every((value, i) => Math.abs(value - e[i]) <= 1);
}

describe('harness', () => {
  const palettes = [
    ['light', tokensJson.color],
    ['dark', tokensJson.colorDark],
  ] as const;

  it.each(palettes)('converts every %s OKLCH primitive to the JSON hex within ±1 per channel', (_mode, palette) => {
    const misses = Object.entries(palette)
      .map(([key, { oklch, hex }]) => ({ key, expected: hex, actual: toHex(parseColor(oklch)) }))
      .filter(({ actual, expected }) => !channelsClose(actual, expected));
    expect(misses).toEqual([]);
  });

  describe('color-mix(in oklch)', () => {
    const purple = 'oklch(0.55 0.14 295)';
    const hexOf = (css: string) => toHex(parseColor(css));

    it('mixing a colour with itself returns it', () => {
      expect(hexOf(`color-mix(in oklch, ${purple} 30%, ${purple})`)).toBe(hexOf(purple));
    });

    it('fills in the missing percentage from the other', () => {
      expect(hexOf(`color-mix(in oklch, ${purple}, oklch(0.9 0.06 165) 25%)`)).toBe(
        hexOf(`color-mix(in oklch, ${purple} 75%, oklch(0.9 0.06 165))`),
      );
    });

    it('mixing toward transparent keeps the colour and scales its alpha', () => {
      const mixed = parseColor(`color-mix(in oklch, ${purple} 14%, transparent)`);
      expect(mixed.a).toBeCloseTo(0.14, 6);
      expect(toHex(mixed)).toBe(hexOf(purple));
    });

    it('interpolates hue along the shorter arc', () => {
      expect(hexOf('color-mix(in oklch, oklch(0.6 0.1 350), oklch(0.6 0.1 10))')).toBe(hexOf('oklch(0.6 0.1 0)'));
    });

    it('in oklab mixes straight across, so two near-neutrals of different hue stay neutral', () => {
      const lavenderGrey = 'oklch(0.92 0.015 300)';
      const cream = 'oklch(0.975 0.014 80)';
      expect(parseOklch(`color-mix(in oklab, ${lavenderGrey} 40%, ${cream})`).c).toBeLessThan(0.006);
      expect(parseOklch(`color-mix(in oklch, ${lavenderGrey} 40%, ${cream})`).c).toBeGreaterThan(0.012);
      expect(hexOf(`color-mix(in oklab, ${purple} 30%, ${purple})`)).toBe(hexOf(purple));
    });

    it('reads white and black by name', () => {
      expect(hexOf('white')).toBe('#FFFFFF');
      expect(hexOf('black')).toBe('#000000');
    });

    it('an achromatic colour takes the other colour’s hue', () => {
      const grey = parseColor('#777777');
      const mixed = parseColor(`color-mix(in oklch, #777777 50%, ${purple})`);
      expect(mixed.b).toBeGreaterThan(mixed.g);
      expect(Math.abs(grey.r - grey.b)).toBeLessThan(0.01);
    });
  });

  describe('contrast', () => {
    const black: Rgba = { r: 0, g: 0, b: 0, a: 1 };
    const white: Rgba = { r: 1, g: 1, b: 1, a: 1 };

    it('is 21:1 for black on white and 1:1 for a colour on itself', () => {
      expect(contrast(black, white)).toBeCloseTo(21, 5);
      expect(contrast(white, white)).toBe(1);
    });

    it('composites a translucent foreground and background before measuring', () => {
      expect(contrast({ ...black, a: 0 }, white)).toBe(1);
      expect(contrast(black, { ...black, a: 0 }, white)).toBeCloseTo(21, 5);
      expect(contrast({ ...black, a: 0.5 }, white)).toBeLessThan(contrast(black, white));
    });
  });

  describe('evaluator', () => {
    const sheet = stylesheetFromCss(`
      :root { --a: light; --b: base; --c: var(--a); }
      @media (prefers-color-scheme: dark) { :root:not([data-theme='light']) { --a: dark; } }
      :root[data-theme="dark"] { --a: dark; }
      :root { --b: later; }
      @media (prefers-reduced-motion: reduce) { :root { --b: still; } }
    `);
    const value = (state: ThemeState, name = '--a') => new Tokens(sheet, state).resolve(name);

    it.each([
      [{ os: 'light', dataTheme: 'none' }, 'light'],
      [{ os: 'dark', dataTheme: 'none' }, 'dark'],
      [{ os: 'dark', dataTheme: 'light' }, 'light'],
      [{ os: 'light', dataTheme: 'dark' }, 'dark'],
      [{ os: 'light', dataTheme: 'light' }, 'light'],
      [{ os: 'dark', dataTheme: 'dark' }, 'dark'],
    ] as [ThemeState, string][])('%o renders %s', (state, expected) => {
      expect(value(state)).toBe(expected);
      expect(value(state, '--c')).toBe(expected);
    });

    it('lets a later rule of equal specificity win, and a more specific one beat a later :root', () => {
      expect(value(LIGHT, '--b')).toBe('later');
      expect(value({ ...LIGHT, reducedMotion: true }, '--b')).toBe('still');
      const specific = stylesheetFromCss(':root[data-theme="dark"] { --x: dark } :root { --x: base }');
      expect(new Tokens(specific, THEME_STATES['forced dark under OS light']).resolve('--x')).toBe('dark');
    });

    it.each([
      ['another selector', '.card { --x: 1 }'],
      ['a forced-light selector', ':root[data-theme="light"] { --x: 1 }'],
      ['!important', ':root { --x: 1 !important }'],
      ['an unknown at-rule', '@supports (color: red) { :root { --x: 1 } }'],
      ['an unknown media query', '@media (min-width: 40rem) { :root { --x: 1 } }'],
    ])('refuses custom properties declared with %s', (_case, css) => {
      expect(() => stylesheetFromCss(css)).toThrow();
    });

    it('ignores rules that declare no custom property, whatever their selector', () => {
      expect(() => stylesheetFromCss('h1 { color: var(--a) } @media (min-width: 40rem) { .x { margin: 0 } }')).not.toThrow();
    });

    it('resolves fallbacks and names unresolved or cyclic references', () => {
      const tokens = new Tokens(
        stylesheetFromCss(':root { --ok: var(--nope, 4px); --bad: var(--nope); --x: var(--y); --y: var(--x); }'),
        LIGHT,
      );
      expect(tokens.resolve('--ok')).toBe('4px');
      expect(() => tokens.resolve('--bad')).toThrow('var(--nope)');
      expect(() => tokens.resolve('--x')).toThrow('Cyclic');
    });

    it('follows local @imports before the importing file and records package imports', () => {
      const dir = mkdtempSync(join(tmpdir(), 'brand-css-'));
      writeFileSync(join(dir, 'base.css'), ':root { --a: imported; --b: imported; }');
      writeFileSync(join(dir, 'main.css'), '@import "@fontsource/x/400.css";\n@import "./base.css";\n:root { --b: own; }');
      const sheet = loadStylesheet(join(dir, 'main.css'));
      const tokens = new Tokens(sheet, LIGHT);
      expect([tokens.resolve('--a'), tokens.resolve('--b')]).toEqual(['imported', 'own']);
      expect(sheet.packageImports).toEqual(['@fontsource/x/400.css']);
    });
  });
});

describe('drift', () => {
  const brand = loadStylesheet(BRAND_CSS);
  const modes = [
    ['light', LIGHT, tokensJson.color],
    ['dark', DARK, tokensJson.colorDark],
  ] as const;

  it.each(modes)('every %s --m-* colour equals the JSON', (_mode, state, palette) => {
    const tokens = new Tokens(brand, state);
    const drifted = Object.entries(palette)
      .map(([key, { oklch }]) => ({ token: `--m-${kebab(key)}`, css: tokens.has(`--m-${kebab(key)}`) ? squash(tokens.raw(`--m-${kebab(key)}`)) : '(missing)', json: oklch }))
      .filter(({ css, json }) => css !== json);
    expect(drifted).toEqual([]);
  });

  it('the radii equal the JSON', () => {
    const tokens = new Tokens(brand, LIGHT);
    for (const [key, px] of Object.entries(tokensJson.radius)) expect(tokens.px(`--m-radius-${key}`), key).toBe(px);
  });

  it('the font roles name the JSON faces first', () => {
    const tokens = new Tokens(brand, LIGHT);
    const first = (name: string) => tokens.resolve(name).split(',')[0].replace(/["']/g, '').trim();
    expect([first('--m-font-display'), first('--m-font-body'), first('--m-font-num')]).toEqual([
      tokensJson.font.display,
      tokensJson.font.body,
      tokensJson.font.numeric,
    ]);
  });

  it('the press scale and stagger rise/blur equal the JSON', () => {
    const tokens = new Tokens(brand, LIGHT);
    expect(Number(tokens.resolve('--m-press-scale'))).toBe(tokensJson.motion.press.scale);
    expect([tokens.px('--m-stagger-rise'), tokens.px('--m-stagger-blur')]).toEqual([tokensJson.motion.stagger.rise, tokensJson.motion.stagger.blur]);
  });

  it('the brand file holds primitives only: every custom property is --m-* (PD7)', () => {
    expect(brand.declarations.filter((decl) => !decl.prop.startsWith('--m-')).map((decl) => decl.prop)).toEqual([]);
  });

  it('the motion curves and durations equal the JSON', () => {
    const tokens = new Tokens(brand, LIGHT);
    const curve = (name: string) => [...tokens.resolve(name).matchAll(/-?\d*\.?\d+/g)].map((m) => Number(m[0]));
    const { spring, overshoot, press, stagger } = tokensJson.motion;
    expect(curve('--m-ease-spring')).toEqual(spring.curve);
    expect(curve('--m-ease-overshoot')).toEqual(overshoot.curve);
    expect([tokens.ms('--m-dur-nav'), tokens.ms('--m-dur-toggle'), tokens.ms('--m-dur-press'), tokens.ms('--m-stagger')]).toEqual([
      spring.ms,
      overshoot.ms,
      press.ms,
      stagger.ms,
    ]);
  });
});

/**
 * Every custom property theme.css defined before the Brand v2 rewrite (eng
 * review D6). Components use these names; dropping one silently strips a
 * border, shadow or colour somewhere. Add names freely; remove one only with
 * the sweep that stops every use of it.
 */
const FROZEN_THEME_NAMES = [
  '--accent', '--accent-2', '--accent-2-hover', '--accent-2-subtle', '--accent-active', '--accent-hover',
  '--accent-muted', '--accent-solid', '--accent-solid-active', '--accent-solid-hover', '--accent-subtle',
  '--badge-neutral-bg', '--badge-neutral-text', '--badge-overdue-bg', '--badge-overdue-text', '--badge-paid-bg',
  '--badge-paid-text', '--badge-unpaid-bg', '--badge-unpaid-text', '--bg', '--bg-subtle', '--border',
  '--border-strong', '--border-subtle', '--btn-primary-border', '--btn-primary-border-hover', '--btn-primary-shadow',
  '--btn-primary-shadow-hover', '--divider', '--drawer-shadow', '--drawer-width', '--error', '--error-hover',
  '--error-muted', '--error-subtle', '--focus', '--focus-ring', '--font-ar', '--font-en', '--font-heading',
  '--font-heading-ar', '--font-mono', '--info', '--info-hover', '--info-muted', '--info-subtle', '--input-bg',
  '--input-border', '--input-border-focus', '--input-border-hover', '--input-placeholder', '--leading-normal',
  '--leading-relaxed', '--leading-snug', '--leading-tight', '--link', '--link-hover', '--link-visited', '--muted',
  '--muted-2', '--nav-item-active', '--nav-item-active-text', '--nav-item-hover', '--on-accent', '--overlay',
  '--placeholder', '--radius-2xl', '--radius-full', '--radius-lg', '--radius-md', '--radius-sm', '--radius-xl',
  '--selection-bg', '--selection-text', '--shadow-1', '--shadow-2', '--shadow-3', '--shadow-inset', '--sidebar-bg',
  '--sidebar-border', '--sidebar-width', '--space-0', '--space-0-5', '--space-1', '--space-1-5', '--space-10',
  '--space-12', '--space-16', '--space-2', '--space-2-5', '--space-3', '--space-4', '--space-5', '--space-6',
  '--space-8', '--space-px', '--success', '--success-hover', '--success-muted', '--success-subtle', '--surface',
  '--surface-2', '--surface-3', '--surface-hover', '--table-border', '--table-header-bg', '--table-row-height',
  '--table-row-hover', '--table-row-selected', '--text', '--text-2xl', '--text-3xl', '--text-4xl', '--text-base',
  '--text-lg', '--text-md', '--text-secondary', '--text-sm', '--text-xl', '--text-xs', '--topbar-height',
  '--tracking-normal', '--tracking-tight', '--tracking-wide', '--warning', '--warning-hover', '--warning-muted',
  '--warning-subtle', '--weight-bold', '--weight-medium', '--weight-normal', '--weight-semibold',
];

describe('names', () => {
  const theme = loadStylesheet(THEME_CSS);

  it.each(STATES)('every frozen theme.css token is still defined (%s)', (_name, state) => {
    const tokens = new Tokens(theme, state);
    expect(FROZEN_THEME_NAMES.filter((name) => !tokens.has(name))).toEqual([]);
  });
});

/**
 * Tokens referenced without a fallback that nothing defines: each one is a
 * style silently dropped today (eng review D6, counted 2026-10-12). Shrink-only:
 * MUT-103 replaces each with a real token and deletes it here. A new dead
 * reference, or an entry that stops being dead, fails the test.
 */
const KNOWN_DEAD_REFERENCES = [
  '--bg-hover', '--bg-primary', '--bg-secondary', '--bg-tertiary', '--border-color',
  '--color-bg-base', '--color-bg-secondary', '--color-bg-subtle', '--color-border', '--color-danger',
  '--color-expense', '--color-income', '--color-info', '--color-primary', '--color-success',
  '--color-text-base', '--color-text-muted', '--color-text-tertiary', '--color-warning', '--danger', '--danger-subtle',
  '--error-bg', '--error-fg', '--font-serif', '--font-size-sm', '--foreground', '--info-bg', '--info-fg', '--negative',
  '--positive', '--primary', '--primary-foreground', '--primary-subtle', '--shadow-lg', '--shadow-xl',
  '--surface-active', '--surface-alt', '--surface-elevated', '--surface-raised', '--surface-secondary',
  '--surface-tertiary', '--text-muted', '--text-primary', '--text-tertiary', '--warning-bg', '--warning-fg',
];

describe('references', () => {
  const files = sourceFiles();
  const defined = customPropertyDefinitions(files);
  const references = bareVarReferences(files);
  const dead = [...references.keys()].filter((name) => !defined.has(name)).sort();

  it('adds no new reference to an undefined token', () => {
    const fresh = dead.filter((name) => !KNOWN_DEAD_REFERENCES.includes(name));
    expect(Object.fromEntries(fresh.map((name) => [name, references.get(name)]))).toEqual({});
  });

  it('lists only references that are still dead (remove fixed ones from KNOWN_DEAD_REFERENCES)', () => {
    expect(KNOWN_DEAD_REFERENCES.filter((name) => !dead.includes(name))).toEqual([]);
  });
});

/** A colour literal anywhere in a declaration value: theme.css must take every colour from --m-*. */
const COLOR_LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|\b(?:white|black)\b/i;

const firstFamily = (value: string) => value.split(',')[0].replace(/["']/g, '').trim();

describe('tokens', () => {
  const theme = loadStylesheet(THEME_CSS);
  const themeRoot = theme.roots.find((root) => root.source?.input.file === THEME_CSS)!;
  const own = [...new Set(theme.declarations.filter((decl) => decl.file === THEME_CSS).map((decl) => decl.prop))];

  it('theme.css imports the brand primitives and the fonts, and nothing else', () => {
    expect(theme.roots.map((root) => root.source?.input.file)).toEqual([BRAND_CSS, FONTS_CSS, THEME_CSS]);
    expect(theme.packageImports).toEqual(['@fontsource/ibm-plex-mono/400.css', '@fontsource/ibm-plex-mono/500.css']);
  });

  it('theme.css has no colour literal: every colour comes from a --m-* primitive', () => {
    const literals: string[] = [];
    themeRoot.walkDecls((decl) => {
      if (COLOR_LITERAL.test(decl.value)) literals.push(`${decl.prop}: ${decl.value}`);
    });
    expect(literals).toEqual([]);
  });

  it.each(STATES)('every custom property resolves (%s)', (_name, state) => {
    const tokens = new Tokens(theme, state);
    const failures: string[] = [];
    for (const name of tokens.names()) {
      try {
        tokens.resolve(name);
      } catch (error) {
        failures.push((error as Error).message);
      }
    }
    expect(failures).toEqual([]);
  });

  it.each(STATES)('every colour token is a --m-* primitive, a color-mix (oklab/oklch) over them, or transparent (%s)', (_name, state) => {
    const tokens = new Tokens(theme, state);
    const isColor = (name: string) => {
      try {
        parseColor(tokens.resolve(name));
        return true;
      } catch {
        return false;
      }
    };
    const colors = new Set(own.filter(isColor));
    const impure = [...colors].filter((name) => {
      const raw = tokens.raw(name);
      const refs = [...raw.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]);
      const leftover = raw
        .replace(/var\(--[\w-]+\)/g, '')
        .replace(/color-mix\(in okl(?:ab|ch)/g, '')
        .replace(/\d*\.?\d+%/g, '')
        .replace(/\btransparent\b/g, '')
        .replace(/[(),\s]/g, '');
      return leftover !== '' || refs.some((ref) => !ref.startsWith('--m-') && !colors.has(ref));
    });
    expect(colors.size).toBeGreaterThan(60);
    expect(impure.map((name) => `${name}: ${tokens.raw(name)}`)).toEqual([]);
  });

  it('every radius is on the brand scale', () => {
    const tokens = new Tokens(theme, LIGHT);
    const radii = own.filter((name) => name.startsWith('--radius-'));
    expect(radii.length).toBeGreaterThan(6);
    for (const name of radii) expect(Object.values(tokensJson.radius), name).toContain(tokens.px(name));
  });

  it('body text is 16px and the type roles equal the JSON scale', () => {
    const tokens = new Tokens(theme, LIGHT);
    expect(tokens.px('--text-body')).toBe(16);
    expect(tokens.px('--text-base')).toBe(16);
    for (const [role, [size]] of Object.entries(tokensJson.type)) expect(tokens.px(`--text-${role}`), role).toBe(size);
  });

  it('points the font roles at Thmanyah Sans, Thmanyah Serif Display and IBM Plex Mono', () => {
    const tokens = new Tokens(theme, LIGHT);
    expect(
      ['--font-en', '--font-ar', '--font-heading', '--font-heading-ar', '--font-mono'].map((name) => firstFamily(tokens.resolve(name))),
    ).toEqual(['Thmanyah Sans', 'Thmanyah Sans', 'Thmanyah Serif Display', 'Thmanyah Serif Display', 'IBM Plex Mono']);
  });

  it('exposes the motion tokens, and reduced motion zeroes them', () => {
    const motion = (state: ThemeState) => {
      const tokens = new Tokens(theme, state);
      return {
        press: tokens.ms('--duration-press'),
        toggle: tokens.ms('--duration-toggle'),
        nav: tokens.ms('--duration-nav'),
        stagger: tokens.ms('--stagger-step'),
        scale: Number(tokens.resolve('--press-scale')),
        spring: tokens.resolve('--ease-spring'),
        overshoot: tokens.resolve('--ease-overshoot'),
      };
    };
    const { spring, overshoot, press, stagger } = tokensJson.motion;
    expect(motion(LIGHT)).toMatchObject({ press: press.ms, toggle: overshoot.ms, nav: spring.ms, stagger: stagger.ms, scale: press.scale });
    expect(motion(LIGHT).spring).toMatch(/^cubic-bezier\(/);
    expect(motion(LIGHT).overshoot).toMatch(/^cubic-bezier\(/);
    for (const state of [LIGHT, DARK]) {
      expect(motion({ ...state, reducedMotion: true })).toMatchObject({ press: 0, toggle: 0, nav: 0, stagger: 0, scale: 1 });
    }
  });

  it('TD-048 font half: a :lang() font-family rule styles only <html>, so inline elements inherit', () => {
    const offenders: string[] = [];
    themeRoot.walkRules((rule) => {
      if (!rule.nodes.some((node) => node.type === 'decl' && node.prop === 'font-family')) return;
      for (const selector of rule.selectors) {
        const subject = selector.trim().split(/\s*[\s>+~]\s*/).pop()!;
        if (subject.includes(':lang(') && !/^html:lang\([a-z-]+\)$/.test(subject)) offenders.push(selector);
      }
    });
    expect(offenders).toEqual([]);
  });

  it.each(STATES)('mixes colours of different hue in oklab, so a blend never swings through an unrelated hue (%s)', (_name, state) => {
    const tokens = new Tokens(theme, state);
    const drifting: string[] = [];
    for (const name of own) {
      const raw = tokens.raw(name);
      for (let at = raw.indexOf('color-mix(in oklch,'); at >= 0; at = raw.indexOf('color-mix(in oklch,', at + 1)) {
        let depth = 0;
        let end = at;
        for (; end < raw.length; end++) {
          if (raw[end] === '(') depth++;
          else if (raw[end] === ')' && --depth === 0) break;
        }
        const stops = postcss.list.comma(raw.slice(raw.indexOf('(', at) + 1, end)).slice(1);
        const hues = stops.map((stop) => parseOklch(tokens.substitute(stop.replace(/\s+\d*\.?\d+%$/, ''))));
        if (hues.some((c) => c.h === null || c.c < 0.005)) continue;
        const gap = Math.abs(((hues[0].h! - hues[1].h! + 540) % 360) - 180);
        if (gap > 30) drifting.push(`${name}: ${Math.round(gap)}° apart`);
      }
    }
    expect(drifting).toEqual([]);
  });

  it('the mono stack falls back to Thmanyah Sans, so Arabic in a figure cell keeps the brand face', () => {
    const stack = new Tokens(theme, LIGHT).resolve('--font-mono').split(',').map((f) => f.replace(/["']/g, '').trim());
    expect(stack.slice(0, 2)).toEqual(['IBM Plex Mono', 'Thmanyah Sans']);
  });

  it('colours visited links only when they carry no class, so a styled link (a button) never turns lavender-ink', () => {
    const visited: string[] = [];
    themeRoot.walkRules((rule) => {
      for (const selector of rule.selectors) if (selector.includes(':visited')) visited.push(selector.trim());
    });
    expect(visited).toEqual(['a:not([class]):visited']);
  });

  it('retires the Inter-only font-feature-settings', () => {
    let found = false;
    themeRoot.walkDecls('font-feature-settings', () => {
      found = true;
    });
    expect(found).toBe(false);
  });
});

/** Grounds any text sits on. Translucent tints are composited over both --bg and --surface. */
const SURFACES = [
  '--bg', '--surface', '--input-bg', '--table-header-bg', '--bg-subtle', '--surface-hover', '--surface-2',
  '--table-row-hover', '--table-row-selected', '--nav-item-hover',
];

/** Pressed/active grounds darker than field-bg: primary text only. */
const STRONG_TEXT_SURFACES = ['--surface-3'];

/** Text on its ground. Light must reach 7:1 (AAA), dark 4.5:1 (AA). */
const TEXT_PAIRS: [string, string][] = [
  ...['--text', '--text-secondary', '--muted', '--muted-2'].flatMap((fg) => SURFACES.map((bg): [string, string] => [fg, bg])),
  ...STRONG_TEXT_SURFACES.map((bg): [string, string] => ['--text', bg]),
  // Primary text (amounts) on the lavender selected ground
  ['--text', '--accent-subtle'],
  ...['--accent-text', '--link'].flatMap((fg) => ['--bg', '--surface'].map((bg): [string, string] => [fg, bg])),
  ...['--accent-solid', '--accent-solid-hover', '--accent-solid-active'].map((bg): [string, string] => ['--on-accent', bg]),
  // Text on the lavender ground (selected nav, chips, the selected row): lavender-ink, not purple
  ...['--accent-subtle', '--input-bg', '--bg', '--surface'].map((bg): [string, string] => ['--on-accent-subtle', bg]),
  ['--nav-item-active-text', '--nav-item-active'],
  ...['paid', 'unpaid', 'overdue', 'neutral'].map((badge): [string, string] => [`--badge-${badge}-text`, `--badge-${badge}-bg`]),
  ...['success', 'warning', 'error', 'info'].flatMap((tone) =>
    ['--bg', '--surface', `--${tone}-subtle`, '--table-row-selected'].map((bg): [string, string] => [`--${tone}`, bg]),
  ),
  // Text on a filled status control (a danger button, a done step): --on-status
  ...['success', 'warning', 'error', 'info'].flatMap((tone) =>
    [`--${tone}`, `--${tone}-hover`].map((bg): [string, string] => ['--on-status', bg]),
  ),
];

describe('contrast', () => {
  const theme = loadStylesheet(THEME_CSS);
  const floorFor = (state: ThemeState) => (schemeOf(state) === 'light' ? 7 : 4.5);
  /** The worse of the pair over --bg and over --surface: a translucent ground can sit on either. */
  const ratio = (tokens: Tokens, fg: string, bg: string) =>
    Math.min(...['--bg', '--surface'].map((base) => contrast(tokens.color(fg), tokens.color(bg), tokens.color(base))));

  it.each(STATES)('every text pair clears its floor: 7:1 light, 4.5:1 dark (%s)', (_name, state) => {
    const tokens = new Tokens(theme, state);
    const failing = TEXT_PAIRS.map(([fg, bg]) => ({ pair: `${fg} on ${bg}`, ratio: ratio(tokens, fg, bg) }))
      .filter((pair) => pair.ratio < floorFor(state))
      .map((pair) => `${pair.pair}: ${pair.ratio.toFixed(2)}`);
    expect(failing).toEqual([]);
  });

  it.each(STATES)('a filled control’s focus ring stands out from the page: --focus on --bg ≥ 3:1 (%s)', (_name, state) => {
    const tokens = new Tokens(theme, state);
    expect(contrast(tokens.color('--focus'), tokens.color('--bg'))).toBeGreaterThanOrEqual(3);
  });

  it.each(STATES)('purple text uses primary-hover (%s)', (_name, state) => {
    const tokens = new Tokens(theme, state);
    expect([tokens.resolve('--accent-text'), tokens.resolve('--link')]).toEqual([
      tokens.resolve('--m-primary-hover'),
      tokens.resolve('--m-primary-hover'),
    ]);
  });

  it.each(STATES)('placeholder stays a hint but clears 4.5:1 on the input (%s, D7)', (_name, state) => {
    const tokens = new Tokens(theme, state);
    const ratio = contrast(tokens.color('--placeholder'), tokens.color('--input-bg'), tokens.color('--bg'));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect(ratio).toBeLessThan(contrast(tokens.color('--muted'), tokens.color('--input-bg'), tokens.color('--bg')));
  });
});

/**
 * What component rules actually render: every rule in src that sets both a
 * text colour and an opaque background, evaluated in the four theme states.
 * The token pair list above can't see a rule that pairs tokens no one listed
 * (purple text on lavender, white on a status ink that turns light in dark).
 * Translucent grounds are skipped here: what they sit on is not in the rule.
 */
/**
 * Rules whose text and background are both hard-coded literals, below 7:1 (counted 2026-10-12).
 * They don't move with the theme; MUT-103's literal sweep moves them onto tokens and deletes
 * them here. Shrink-only: a new failure, or an entry that passes, fails the test.
 */
const KNOWN_LITERAL_PAIRS = [
  'src/components/csv/CSVValidationPreview.css .status-icon.status-new',
  'src/components/csv/CSVValidationPreview.css .status-icon.status-duplicate',
  'src/components/csv/CSVValidationPreview.css .status-icon.status-error',
  'src/components/csv/CSVValidationPreview.css .type-badge',
  'src/components/csv/CSVValidationPreview.css .issue.error',
  'src/components/csv/CSVValidationPreview.css .issue.warning',
];

describe('rendered pairs', () => {
  const theme = loadStylesheet(THEME_CSS);
  const files = sourceFiles().filter((file) => file.endsWith('.css') && !file.startsWith(repoPath('src/styles/')));

  it('every stylesheet in src parses', () => {
    const broken = files.filter((file) => {
      try {
        parseCss(file);
        return false;
      } catch {
        return true;
      }
    });
    expect(broken).toEqual([]);
  });

  /** Every rule below its floor in one state, keyed `file selector`, with the measurement. */
  function failingRules(state: ThemeState): Map<string, string> {
    const tokens = new Tokens(theme, state);
    const floor = schemeOf(state) === 'light' ? 7 : 4.5;
    const resolve = (value: string) => {
      try {
        return parseColor(tokens.substitute(value.trim()));
      } catch {
        return null;
      }
    };
    const failing = new Map<string, string>();
    for (const file of files) {
      let pairs;
      try {
        pairs = colorPairs(file);
      } catch {
        continue;
      }
      for (const pair of pairs) {
        const fg = resolve(pair.color);
        const bg = resolve(pair.background);
        if (!fg || !bg || bg.a < 1) continue;
        const value = contrast(fg, bg);
        if (value < floor) {
          const path = pair.file.replace(`${repoPath('.')}/`, '');
          failing.set(`${path} ${pair.selector}`, `${path}:${pair.line} ${pair.selector} — ${pair.color} on ${pair.background}: ${value.toFixed(2)}`);
        }
      }
    }
    return failing;
  }

  it.each(STATES)('every rule’s text clears its floor on its own background: 7:1 light, 4.5:1 dark (%s)', (_name, state) => {
    const failing = failingRules(state);
    expect([...failing].filter(([key]) => !KNOWN_LITERAL_PAIRS.includes(key)).map(([, detail]) => detail)).toEqual([]);
  });

  it('lists only literal pairs that still fail (remove fixed ones from KNOWN_LITERAL_PAIRS)', () => {
    const failing = failingRules(LIGHT);
    expect(KNOWN_LITERAL_PAIRS.filter((key) => !failing.has(key))).toEqual([]);
  });
});

describe('focus', () => {
  it('never prefixes the focus ring with inset: the token already starts with it, and "inset inset" is invalid (no ring at all)', () => {
    const offenders = sourceFiles()
      .filter((file) => file.endsWith('.css'))
      .filter((file) => /inset\s+var\(--focus-ring/.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });

  /** The box-shadow each selector sets, across the given stylesheets. */
  function shadows(...paths: string[]): Record<string, string> {
    const rules: Record<string, string> = {};
    for (const path of paths) {
      parseCss(repoPath(path)).walkRules((rule) => {
        const shadow = rule.nodes.find((n) => n.type === 'decl' && n.prop === 'box-shadow') as { value: string } | undefined;
        for (const selector of rule.selectors) if (shadow) rules[selector.trim()] = shadow.value;
      });
    }
    return rules;
  }

  it('filled buttons take the outer ring: the inset brand ring is near-invisible on a filled ground', () => {
    const rules = shadows('src/components/ui/Button.css', 'src/index.css');
    const filled = ['.btn-primary', '.btn-danger', '.btn-success', '.btn-warning'];
    expect(filled.map((btn) => rules[`${btn}:focus-visible`])).toEqual(filled.map(() => 'var(--focus-ring-on-fill)'));
  });

  it('keeps the ring on a hovered, focused primary button: its hover shadow would otherwise replace it', () => {
    expect(shadows('src/components/ui/Button.css')['.btn-primary:hover:not(:disabled):focus-visible']).toBe('var(--focus-ring-on-fill)');
  });

  it('draws focus rings from tokens, never a literal colour (a literal white vanishes on a light fill in dark mode)', () => {
    const literal = /#[0-9a-f]{3,8}\b|rgba?\(|\bwhite\b|\bblack\b/i;
    const offenders: string[] = [];
    for (const file of sourceFiles().filter((f) => f.endsWith('.css'))) {
      parseCss(file).walkRules((rule) => {
        if (!rule.selector.includes(':focus')) return;
        rule.walkDecls(/^(box-shadow|outline|outline-color)$/, (decl) => {
          if (literal.test(decl.value)) offenders.push(`${file.replace(`${repoPath('.')}/`, '')}: ${rule.selector} { ${decl.prop}: ${decl.value} }`);
        });
      });
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * `color: var(--accent)` puts purple text at 4.78:1 on canvas, below AAA. Text
 * uses --accent-text (primary-hover); --accent is for fills, borders and
 * decoration (PD3). Matches the whole `color` property only, in CSS and in
 * TSX inline styles (CQ3).
 */
const ACCENT_AS_TEXT = /(?<![-\w])color\s*:\s*['"`]?var\(--accent\s*[,)]/;

/** Line numbers of every match in the whole text, so a declaration split across lines is still found. */
function accentTextLines(text: string): number[] {
  const global = new RegExp(ACCENT_AS_TEXT.source, 'g');
  return [...text.matchAll(global)].map((m) => text.slice(0, m.index).split('\n').length);
}

describe('accent-text guard', () => {
  it.each([
    'color: var(--accent);',
    "{ color: 'var(--accent)' }",
    'a{color:var(--accent)}',
    '  color : "var(--accent)"',
    'color: var(--accent, #7c3aed);',
    "{ color: 'var(--accent, purple)' }",
  ])('catches %s', (code) => {
    expect(ACCENT_AS_TEXT.test(code)).toBe(true);
  });

  it('catches a colour declaration split across lines, at the right line', () => {
    expect(accentTextLines('a {\n  color:\n    var(--accent);\n}')).toEqual([2]);
  });

  it.each(['border-color: var(--accent);', 'color: var(--accent-text);', 'background-color: var(--accent);', 'color: var(--accent-solid);', '--link-color: var(--accent);', 'outline-color: var(--accent)'])(
    'leaves %s alone',
    (code) => {
      expect(ACCENT_AS_TEXT.test(code)).toBe(false);
    },
  );

  it('no stylesheet or component colours text with --accent', () => {
    const offenders = sourceFiles()
      .filter((file) => /\.(css|tsx?)$/.test(file))
      .flatMap((file) => accentTextLines(readFileSync(file, 'utf8')).map((line) => `${file.replace(`${repoPath('.')}/`, '')}:${line}`));
    expect(offenders).toEqual([]);
  });
});
