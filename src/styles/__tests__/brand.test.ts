// @vitest-environment node
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import tokensJson from '../brand/mutaba3a.tokens.json';
import {
  THEME_STATES,
  Tokens,
  bareVarReferences,
  contrast,
  customPropertyDefinitions,
  fontFaces,
  loadStylesheet,
  parseColor,
  repoPath,
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

/**
 * The delivered Thmanyah files, pinned by sha256. The licence forbids any
 * modification (no subsetting, no woff2), so a changed hash is a licence
 * problem, not a refresh. Re-pin only when Thmanyah's official files replace
 * these (the Serif Display provenance gap on MUT-102).
 */
const THMANYAH_SHA256: Record<string, string> = {
  'thmanyahsans-Regular.otf': 'f45a420632384b42a37ec9b24298ddc6502faa52d55d973144779262ebc023dc',
  'thmanyahsans-Medium.otf': 'f2762ffbe17351193e3d630dd10f0c3a965e6c873998dfdeda2bd0dcad7985c6',
  'thmanyahsans-Bold.otf': '72cc27021cc1a503e5c03b072df8b16d55c78983e5fd73a4cdf92b5a600af2f7',
  'thmanyah-serif-display-regular.otf': '1f5c735a6c05cce9fe9b2459d5aedb1d039541d50b726304bd617a69587bf112',
  'thmanyah-serif-display-bold.otf': 'ac2f056441891276792ab6d828d8ad9169ef44ecea60d6ccf126b25361f0ee9d',
};

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

  it('keeps no Thmanyah copy in public/ (the portal cannot see it; one location only)', () => {
    expect(readdirSync(repoPath('public/fonts')).filter((name) => /thmanyah/i.test(name))).toEqual([]);
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
  '--bg-hover', '--bg-primary', '--bg-secondary', '--bg-tertiary', '--border-color', '--color-accent',
  '--color-bg-base', '--color-bg-secondary', '--color-bg-subtle', '--color-border', '--color-danger', '--color-error',
  '--color-expense', '--color-income', '--color-info', '--color-muted', '--color-primary', '--color-success',
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

  it.each(STATES)('every colour token is a --m-* primitive, a color-mix over them, or transparent (%s)', (_name, state) => {
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
        .replace(/color-mix\(in oklch/g, '')
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
    for (const name of radii) expect([12, 14, 18, 24, 28, 999], name).toContain(tokens.px(name));
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
    expect(motion(LIGHT)).toMatchObject({ press: 120, toggle: 350, nav: 420, stagger: 50, scale: 0.96 });
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

  it('retires the Inter-only font-feature-settings', () => {
    let found = false;
    themeRoot.walkDecls('font-feature-settings', () => {
      found = true;
    });
    expect(found).toBe(false);
  });
});

const SURFACES = ['--bg', '--surface', '--input-bg', '--table-header-bg'];

/** Text on its ground. Light must reach 7:1 (AAA), dark 4.5:1 (AA). */
const TEXT_PAIRS: [string, string][] = [
  ...['--text', '--text-secondary', '--muted', '--muted-2'].flatMap((fg) => SURFACES.map((bg): [string, string] => [fg, bg])),
  ...['--accent-text', '--link'].flatMap((fg) => ['--bg', '--surface'].map((bg): [string, string] => [fg, bg])),
  ...['--accent-solid', '--accent-solid-hover', '--accent-solid-active'].map((bg): [string, string] => ['--on-accent', bg]),
  ['--nav-item-active-text', '--nav-item-active'],
  ...['paid', 'unpaid', 'overdue', 'neutral'].map((badge): [string, string] => [`--badge-${badge}-text`, `--badge-${badge}-bg`]),
  ...['success', 'warning', 'error', 'info'].flatMap((tone) =>
    ['--bg', '--surface', `--${tone}-subtle`].map((bg): [string, string] => [`--${tone}`, bg]),
  ),
];

describe('contrast', () => {
  const theme = loadStylesheet(THEME_CSS);

  it.each(STATES)('every text pair clears its floor: 7:1 light, 4.5:1 dark (%s)', (_name, state) => {
    const tokens = new Tokens(theme, state);
    const floor = (state.dataTheme === 'none' ? state.os : state.dataTheme) === 'light' ? 7 : 4.5;
    const base = tokens.color('--bg');
    const failing = TEXT_PAIRS.map(([fg, bg]) => ({ pair: `${fg} on ${bg}`, ratio: contrast(tokens.color(fg), tokens.color(bg), base) }))
      .filter(({ ratio }) => ratio < floor)
      .map(({ pair, ratio }) => `${pair}: ${ratio.toFixed(2)}`);
    expect(failing).toEqual([]);
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
