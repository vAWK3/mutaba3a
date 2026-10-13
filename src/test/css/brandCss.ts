/**
 * Brand v2 token harness (MUT-102, eng review D2). Pure Node: it reads the
 * stylesheets with postcss and answers what a browser would, without one.
 *
 * - **Colour maths:** OKLCH ↔ sRGB, `color-mix(in oklch, …)`, compositing and
 *   WCAG contrast. `brand.test.ts` › `harness` checks it against every hex in
 *   `mutaba3a.tokens.json`.
 * - **Evaluator:** the custom properties on `:root` for one theme state (OS
 *   light/dark × `data-theme` none/light/dark × reduced motion), following
 *   local `@import`s and resolving `var()` chains. It knows exactly three
 *   selectors and throws on any other that declares a custom property, which
 *   keeps `theme.css` simple enough to reason about.
 * - **Source scans:** custom-property definitions and no-fallback `var()`
 *   references across `src`, for the dead-reference guard; and the
 *   text/background pairs that component rules actually render.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss, { type AtRule, type Root } from 'postcss';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** An absolute path from a repo-relative one. */
export function repoPath(path: string): string {
  return resolve(REPO_ROOT, path);
}

export function parseCss(file: string): Root {
  return postcss.parse(readFileSync(file, 'utf8'), { from: file });
}

/** The `url()`s in a declaration value, unquoted, in order. */
export function urlsIn(value: string): string[] {
  return [...value.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)].map((m) => m[2]);
}

// ─── Fonts ─────────────────────────────────────────────────────────────────

export interface FontFace {
  family: string;
  weight: string;
  style: string;
  display: string;
  /** Each `src` url, resolved to an absolute path next to the stylesheet. */
  files: string[];
}

export function fontFaces(file: string): FontFace[] {
  const faces: FontFace[] = [];
  parseCss(file).walkAtRules('font-face', (rule) => {
    const decls: Record<string, string> = {};
    rule.walkDecls((decl) => {
      decls[decl.prop] = decl.value;
    });
    faces.push({
      family: (decls['font-family'] ?? '').replace(/['"]/g, ''),
      weight: decls['font-weight'] ?? '',
      style: decls['font-style'] ?? '',
      display: decls['font-display'] ?? '',
      files: urlsIn(decls.src ?? '').map((url) => resolve(dirname(file), url)),
    });
  });
  return faces;
}

// ─── Colour maths ──────────────────────────────────────────────────────────

/** Gamma-encoded sRGB channels in 0..1, plus alpha. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface Oklch {
  l: number;
  c: number;
  /** `null` when the hue is missing (an achromatic colour, or `none`). */
  h: number | null;
  alpha: number;
}

const DEG = Math.PI / 180;
/** Below this chroma a colour is achromatic and its hue is powerless. */
const ACHROMATIC = 1e-4;

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function encode(linear: number): number {
  const v = clamp01(linear);
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
}

function decode(gamma: number): number {
  return gamma <= 0.04045 ? gamma / 12.92 : ((gamma + 0.055) / 1.055) ** 2.4;
}

/** Björn Ottosson's OKLab matrices; out-of-gamut channels clip, as browsers display them. */
function oklchToRgba({ l, c, h, alpha }: Oklch): Rgba {
  const hue = (h ?? 0) * DEG;
  const a = c * Math.cos(hue);
  const b = c * Math.sin(hue);
  const L = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const M = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const S = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    r: encode(4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S),
    g: encode(-1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S),
    b: encode(-0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S),
    a: alpha,
  };
}

function rgbaToOklch({ r, g, b, a }: Rgba): Oklch {
  const [lr, lg, lb] = [r, g, b].map(decode);
  const l_ = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m_ = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s_ = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const okA = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const okB = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const c = Math.hypot(okA, okB);
  return {
    l: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    c,
    h: c < ACHROMATIC ? null : (Math.atan2(okB, okA) / DEG + 360) % 360,
    alpha: a,
  };
}

/** Index of the `)` that closes the `(` at `open`. */
function closingParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return i;
  }
  throw new Error(`Unbalanced parentheses in "${text}"`);
}

/** Splits on `separator` outside parentheses. */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') depth--;
    else if (text[i] === separator && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts;
}

function fnArgs(text: string): string {
  const open = text.indexOf('(');
  return text.slice(open + 1, closingParen(text, open));
}

function number(token: string, percentScale = 1): number {
  const value = parseFloat(token);
  if (Number.isNaN(value)) throw new Error(`Not a number: "${token}"`);
  return token.endsWith('%') ? (value / 100) * percentScale : value;
}

function parseOklchFn(text: string): Oklch {
  const [channels, alpha] = fnArgs(text).split('/').map((part) => part.trim());
  const [l, c, h] = channels.split(/\s+/);
  return {
    l: number(l),
    c: number(c, 0.4),
    h: h === 'none' ? null : number(h),
    alpha: alpha === undefined ? 1 : number(alpha),
  };
}

function parseHex(text: string): Rgba {
  let hex = text.slice(1);
  if (hex.length === 3 || hex.length === 4) hex = [...hex].map((ch) => ch + ch).join('');
  const channel = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255;
  return { r: channel(0), g: channel(2), b: channel(4), a: hex.length === 8 ? channel(6) : 1 };
}

function parseRgbFn(text: string): Rgba {
  const parts = fnArgs(text).split(/[\s,/]+/).filter(Boolean);
  const channel = (token: string) => (token.endsWith('%') ? number(token) : number(token) / 255);
  return { r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]), a: parts[3] === undefined ? 1 : number(parts[3]) };
}

/**
 * `color-mix(in oklch|oklab, A p%, B q%)`, per CSS Color 5: premultiplied;
 * oklch takes the shorter hue arc, oklab mixes the a/b axes straight across.
 */
function parseColorMix(text: string): Oklch {
  const [space, ...stops] = splitTopLevel(fnArgs(text), ',');
  if ((space !== 'in oklch' && space !== 'in oklab') || stops.length !== 2) {
    throw new Error(`Only color-mix(in oklch|oklab, A, B) is supported: "${text}"`);
  }
  const [first, second] = stops.map((stop) => {
    const match = /^(.*\S)\s+(\d*\.?\d+)%$/.exec(stop);
    return match ? { color: toOklch(match[1]), pct: Number(match[2]) } : { color: toOklch(stop), pct: undefined };
  });
  const p1 = first.pct ?? (second.pct === undefined ? 50 : 100 - second.pct);
  const p2 = second.pct ?? 100 - p1;
  const sum = p1 + p2;
  if (sum <= 0) throw new Error(`color-mix percentages sum to 0: "${text}"`);
  const mix = space === 'in oklab' ? mixOklab : mixOklch;
  return mix(first.color, second.color, p1 / sum, Math.min(sum, 100) / 100);
}

function mixOklab(a: Oklch, b: Oklch, weightA: number, alphaScale: number): Oklch {
  const weightB = 1 - weightA;
  const alpha = a.alpha * weightA + b.alpha * weightB;
  if (alpha === 0) return { l: 0, c: 0, h: null, alpha: 0 };
  const axis = (color: Oklch, trig: (x: number) => number) => color.c * trig((color.h ?? 0) * DEG);
  const mixAxis = (va: number, vb: number) => (va * a.alpha * weightA + vb * b.alpha * weightB) / alpha;
  const l = mixAxis(a.l, b.l);
  const okA = mixAxis(axis(a, Math.cos), axis(b, Math.cos));
  const okB = mixAxis(axis(a, Math.sin), axis(b, Math.sin));
  const c = Math.hypot(okA, okB);
  return { l, c, h: c < ACHROMATIC ? null : (Math.atan2(okB, okA) / DEG + 360) % 360, alpha: alpha * alphaScale };
}

function mixOklch(a: Oklch, b: Oklch, weightA: number, alphaScale: number): Oklch {
  const weightB = 1 - weightA;
  const alpha = a.alpha * weightA + b.alpha * weightB;
  let h1 = a.h ?? b.h;
  let h2 = b.h ?? a.h;
  if (h1 !== null && h2 !== null) {
    if (h2 - h1 > 180) h1 += 360;
    else if (h2 - h1 < -180) h2 += 360;
  }
  if (alpha === 0) return { l: 0, c: 0, h: null, alpha: 0 };
  return {
    l: (a.l * a.alpha * weightA + b.l * b.alpha * weightB) / alpha,
    c: (a.c * a.alpha * weightA + b.c * b.alpha * weightB) / alpha,
    h: h1 === null || h2 === null ? null : (h1 * weightA + h2 * weightB) % 360,
    alpha: alpha * alphaScale,
  };
}

const NAMED: Record<string, string> = { white: '#ffffff', black: '#000000' };

function toOklch(text: string): Oklch {
  const value = NAMED[text.trim().toLowerCase()] ?? text.trim().toLowerCase();
  if (value === 'transparent') return { l: 0, c: 0, h: null, alpha: 0 };
  if (value.startsWith('#')) return rgbaToOklch(parseHex(value));
  if (value.startsWith('rgb')) return rgbaToOklch(parseRgbFn(value));
  if (value.startsWith('oklch(')) return parseOklchFn(value);
  if (value.startsWith('color-mix(')) return parseColorMix(value);
  throw new Error(`Not a colour: "${text}"`);
}

/** A fully resolved colour value (no `var()`) as sRGB. Throws if it is not a colour. */
export function parseColor(text: string): Rgba {
  return oklchToRgba(toOklch(text));
}

/** A fully resolved colour value as OKLCH (`h` is null when achromatic). */
export function parseOklch(text: string): { l: number; c: number; h: number | null; alpha: number } {
  return toOklch(text);
}

export function toHex({ r, g, b }: Rgba): string {
  return `#${[r, g, b].map((v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** `top` painted over an opaque `bottom`, blended in gamma-encoded sRGB like a browser. */
export function composite(top: Rgba, bottom: Rgba): Rgba {
  const mix = (t: number, b: number) => t * top.a + b * (1 - top.a);
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 };
}

function luminance({ r, g, b }: Rgba): number {
  return 0.2126 * decode(clamp01(r)) + 0.7152 * decode(clamp01(g)) + 0.0722 * decode(clamp01(b));
}

/** WCAG 2 contrast of `fg` on `bg`; translucent layers are first composited over `base`. */
export function contrast(fg: Rgba, bg: Rgba, base: Rgba = { r: 1, g: 1, b: 1, a: 1 }): number {
  const ground = composite(bg, base);
  const ink = composite(fg, ground);
  const [hi, lo] = [luminance(ink), luminance(ground)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// ─── Evaluator ─────────────────────────────────────────────────────────────

export type Scheme = 'light' | 'dark';

export interface ThemeState {
  os: Scheme;
  dataTheme: 'none' | Scheme;
  reducedMotion?: boolean;
}

/** The four states ADR-018 and the ThemeToggle (MUT-79) produce. */
export const THEME_STATES = {
  'OS light': { os: 'light', dataTheme: 'none' },
  'OS dark': { os: 'dark', dataTheme: 'none' },
  'forced light under OS dark': { os: 'dark', dataTheme: 'light' },
  'forced dark under OS light': { os: 'light', dataTheme: 'dark' },
} as const satisfies Record<string, ThemeState>;

/** Which of the four states render light. */
export function schemeOf(state: ThemeState): Scheme {
  return state.dataTheme === 'none' ? state.os : state.dataTheme;
}

const SELECTORS: Record<string, { specificity: number; matches: (s: ThemeState) => boolean }> = {
  ':root': { specificity: 1, matches: () => true },
  ':root:not([data-theme="light"])': { specificity: 2, matches: (s) => s.dataTheme !== 'light' },
  ':root[data-theme="dark"]': { specificity: 2, matches: (s) => s.dataTheme === 'dark' },
};

const CONDITIONS: Record<string, (s: ThemeState) => boolean> = {
  '(prefers-color-scheme: dark)': (s) => s.os === 'dark',
  '(prefers-color-scheme: light)': (s) => s.os === 'light',
  '(prefers-reduced-motion: reduce)': (s) => !!s.reducedMotion,
  '(prefers-reduced-motion: no-preference)': (s) => !s.reducedMotion,
};

interface Declaration {
  prop: string;
  value: string;
  selector: string;
  conditions: string[];
  file: string;
}

export interface Stylesheet {
  /** Every parsed file, imports first, in cascade order. */
  roots: Root[];
  /** `@import`s of packages (not followed). */
  packageImports: string[];
  declarations: Declaration[];
}

function normaliseSelector(selector: string): string {
  return selector.replace(/'/g, '"').replace(/\s+/g, ' ').trim();
}

function normaliseMedia(params: string): string {
  return params.toLowerCase().replace(/\s+/g, ' ').replace(/\(\s*/g, '(').replace(/\s*\)/g, ')').replace(/\s*:\s*/g, ': ').trim();
}

function importTarget(rule: AtRule): string {
  const match = /^(?:url\()?\s*['"]?([^'")]+)['"]?\s*\)?/.exec(rule.params.trim());
  if (!match) throw new Error(`Unreadable @import "${rule.params}"`);
  return match[1];
}

function collectDeclarations(root: Root, file: string, into: Declaration[]): void {
  root.walkRules((rule) => {
    const custom = rule.nodes.filter((node) => node.type === 'decl' && node.prop.startsWith('--'));
    if (custom.length === 0) return;
    const conditions: string[] = [];
    for (let parent = rule.parent; parent && parent.type !== 'root'; parent = parent.parent) {
      const media = parent.type === 'atrule' && (parent as AtRule).name === 'media' ? normaliseMedia((parent as AtRule).params) : null;
      if (!media || !CONDITIONS[media]) throw new Error(`${file}: custom properties inside an unsupported at-rule ("${parent.type === 'atrule' ? `@${(parent as AtRule).name} ${(parent as AtRule).params}` : parent.type}")`);
      conditions.push(media);
    }
    for (const selector of rule.selectors.map(normaliseSelector)) {
      if (!SELECTORS[selector]) throw new Error(`${file}: custom properties on unsupported selector "${selector}"`);
      for (const node of custom) {
        if (node.type !== 'decl') continue;
        if (node.important) throw new Error(`${file}: !important on ${node.prop}`);
        into.push({ prop: node.prop, value: node.value.trim(), selector, conditions, file });
      }
    }
  });
}

function load(file: string, sheet: Stylesheet, seen: Set<string>): void {
  if (seen.has(file)) return;
  seen.add(file);
  const root = parseCss(file);
  root.each((node) => {
    if (node.type !== 'atrule' || node.name !== 'import') return;
    const target = importTarget(node);
    if (target.startsWith('.')) load(resolve(dirname(file), target), sheet, seen);
    else sheet.packageImports.push(target);
  });
  sheet.roots.push(root);
  collectDeclarations(root, file, sheet.declarations);
}

/** A stylesheet and its local `@import`s, in cascade order. */
export function loadStylesheet(entry: string): Stylesheet {
  const sheet: Stylesheet = { roots: [], packageImports: [], declarations: [] };
  load(entry, sheet, new Set());
  return sheet;
}

/** An inline stylesheet (no imports followed), for fixtures. */
export function stylesheetFromCss(css: string, from = 'fixture.css'): Stylesheet {
  const root = postcss.parse(css, { from });
  const sheet: Stylesheet = { roots: [root], packageImports: [], declarations: [] };
  collectDeclarations(root, from, sheet.declarations);
  return sheet;
}

/** The custom properties on `:root` in one theme state. */
export class Tokens {
  private readonly values = new Map<string, string>();

  constructor(sheet: Stylesheet, readonly state: ThemeState) {
    const winners = new Map<string, number>();
    for (const decl of sheet.declarations) {
      const selector = SELECTORS[decl.selector];
      if (!selector.matches(state) || !decl.conditions.every((c) => CONDITIONS[c](state))) continue;
      // Cascade: higher specificity wins; equal specificity, the later rule wins.
      if (selector.specificity >= (winners.get(decl.prop) ?? 0)) {
        winners.set(decl.prop, selector.specificity);
        this.values.set(decl.prop, decl.value);
      }
    }
  }

  names(): string[] {
    return [...this.values.keys()];
  }

  has(name: string): boolean {
    return this.values.has(name);
  }

  /** The declared value, `var()`s untouched. */
  raw(name: string): string {
    const value = this.values.get(name);
    if (value === undefined) throw new Error(`${name} is not defined in this state`);
    return value;
  }

  /** The value with every `var()` substituted. Throws on an unresolved or cyclic reference. */
  resolve(name: string): string {
    return this.substitute(this.raw(name), [name]);
  }

  color(name: string): Rgba {
    return parseColor(this.resolve(name));
  }

  /** A length in px (`px` or `rem` at 16px). */
  px(name: string): number {
    const value = this.resolve(name);
    const match = /^(-?\d*\.?\d+)(px|rem)$/.exec(value);
    if (!match) throw new Error(`${name} is not a px/rem length: "${value}"`);
    return Number(match[1]) * (match[2] === 'rem' ? 16 : 1);
  }

  /** A duration in ms (`ms` or `s`). */
  ms(name: string): number {
    const value = this.resolve(name);
    const match = /^(\d*\.?\d+)(ms|s)$/.exec(value);
    if (!match) throw new Error(`${name} is not a duration: "${value}"`);
    return Number(match[1]) * (match[2] === 's' ? 1000 : 1);
  }

  substitute(value: string, stack: string[] = []): string {
    let out = '';
    let from = 0;
    for (;;) {
      const start = value.indexOf('var(', from);
      if (start < 0) return out + value.slice(from);
      const end = closingParen(value, start + 3);
      const [name, ...rest] = splitTopLevel(value.slice(start + 4, end), ',');
      const fallback = rest.length > 0 ? rest.join(',') : undefined;
      out += value.slice(from, start);
      if (stack.includes(name)) throw new Error(`Cyclic var(): ${[...stack, name].join(' → ')}`);
      if (this.values.has(name)) out += this.substitute(this.values.get(name)!, [...stack, name]);
      else if (fallback !== undefined) out += this.substitute(fallback, stack);
      else throw new Error(`Unresolved var(${name})${stack.length > 0 ? ` in ${stack.join(' → ')}` : ''}`);
      from = end + 1;
    }
  }
}

// ─── Source scans (dead-reference guard) ───────────────────────────────────

const SOURCE = /\.(css|ts|tsx)$/;
const TEST_FILE = /\.(test|spec)\.tsx?$/;

/** `src/**\/*.{css,ts,tsx}` without tests, test support or type declarations. */
export function sourceFiles(dir = repoPath('src')): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' || path === repoPath('src/test') ? [] : sourceFiles(path);
    return SOURCE.test(name) && !TEST_FILE.test(name) && !name.endsWith('.d.ts') ? [path] : [];
  });
}

/** Names defined by a CSS `--x:`, a TSX `'--x':` key or `setProperty('--x'`. */
export function customPropertyDefinitions(files: string[]): Set<string> {
  const defined = new Set<string>();
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const patterns = file.endsWith('.css')
      ? [/(?:^|[;{\s])(--[\w-]+)\s*:/g]
      : [/['"](--[\w-]+)['"]\s*\]?\s*:/g, /setProperty\(\s*['"](--[\w-]+)/g];
    for (const pattern of patterns) for (const match of text.matchAll(pattern)) defined.add(match[1]);
  }
  return defined;
}

/** Every `var(--x)` with no fallback, mapped to the repo-relative files that use it. */
export function bareVarReferences(files: string[]): Map<string, string[]> {
  const refs = new Map<string, string[]>();
  for (const file of files) {
    for (const match of readFileSync(file, 'utf8').matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) {
      const users = refs.get(match[1]) ?? [];
      const path = relative(REPO_ROOT, file);
      if (!users.includes(path)) users.push(path);
      refs.set(match[1], users);
    }
  }
  return refs;
}

/** A rule that sets both a text colour and a background, as written. */
export interface ColorPair {
  file: string;
  line: number;
  selector: string;
  color: string;
  background: string;
}

/**
 * The text/background pairs component rules render: every rule that declares
 * both `color` and `background(-color)`. A rule that sets only one of them
 * (a hover that changes just the fill) is not seen; the token pair lists
 * cover those.
 */
export function colorPairs(file: string): ColorPair[] {
  const pairs: ColorPair[] = [];
  parseCss(file).walkRules((rule) => {
    let color: string | undefined;
    let background: string | undefined;
    rule.each((node) => {
      if (node.type !== 'decl') return;
      if (node.prop === 'color') color = node.value;
      if (node.prop === 'background' || node.prop === 'background-color') background = node.value;
    });
    if (color && background) {
      pairs.push({ file, line: rule.source?.start?.line ?? 0, selector: rule.selector.replace(/\s+/g, ' '), color, background });
    }
  });
  return pairs;
}

// ─── Literal guard (MUT-103) ───────────────────────────────────────────────

/**
 * A colour literal in a CSS value: hex (not an HTML entity `&#9998;`), a colour
 * function, or white/black as a whole word (not `white-space`, not `--white-x`).
 */
export const COLOR_LITERAL = /(?<![\w&-])#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|(?<![\w-])(?:white|black)(?![\w-])/i;

/** A non-zero px or rem length; `0`, `%` and `em` stay relative. */
const PX_OR_REM = /(?<![\w.-])(?:\d*\.\d+|[1-9]\d*)(?:px|rem)\b/;
const NON_ZERO_PX = /(?<![\w.-])(?:\d*\.\d+|[1-9]\d*)px\b/;
/** Inner radius = outer token − a border width: the one px a radius may carry. */
const INNER_RADIUS = /calc\(\s*var\(--radius-[\w-]+\)\s*-\s*\d+px\s*\)/g;

export type LiteralKind = 'colour' | 'radius' | 'font-size' | 'style-element';

export interface Literal {
  line: number;
  kind: LiteralKind;
  text: string;
}

/** Inside `@media print`: paper, not the screen theme, so tokens (which follow the scheme) would be wrong there. */
function inPrint(node: { parent?: unknown }): boolean {
  for (let at = node.parent as { type?: string; name?: string; params?: string; parent?: unknown } | undefined; at; at = at.parent as typeof at) {
    if (at.type === 'atrule' && at.name === 'media' && /\bprint\b/.test(at.params ?? '')) return true;
  }
  return false;
}

/** Every colour, px radius and px/rem font size written into a stylesheet's declarations, outside print rules. */
export function cssLiterals(css: string): Literal[] {
  const found: Literal[] = [];
  postcss.parse(css).walkDecls((decl) => {
    if (inPrint(decl)) return;
    const line = decl.source?.start?.line ?? 0;
    const text = `${decl.prop}: ${decl.value}`;
    if (COLOR_LITERAL.test(decl.value)) found.push({ line, kind: 'colour', text });
    if (/radius$/.test(decl.prop) && NON_ZERO_PX.test(decl.value.replace(INNER_RADIUS, ''))) found.push({ line, kind: 'radius', text });
    if (decl.prop === 'font-size' && PX_OR_REM.test(decl.value)) found.push({ line, kind: 'font-size', text });
  });
  return found;
}

/** A string literal whose whole value is a colour, unless it is a link target (`href="#add"`). */
const SCRIPT_COLOR = /(?<!\b(?:href|to)=)(['"`])(#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^'"`\n]*\)|white|black)\1/gi;
/** A style-object size key given a number, or a px/rem string. */
const SCRIPT_SIZE = /\b(fontSize|border(?:(?:Top|Bottom|Start|End)(?:Left|Right|Start|End))?Radius)\s*:\s*(?:(['"`])\s*(?:\d*\.)?\d+(?:px|rem)?\s*\2|(?:\d*\.\d+|[1-9]\d*)(?![\w.]))/g;
const STYLE_ELEMENT = /<style[\s>]/g;

/** Literals in TS/TSX source: whole-string colours, numeric size keys, and (in TSX) `<style>` elements. */
export function scriptLiterals(code: string, tsx = true): Literal[] {
  const lineAt = (index: number) => code.slice(0, index).split('\n').length;
  const found: Literal[] = [];
  for (const match of code.matchAll(SCRIPT_COLOR)) found.push({ line: lineAt(match.index), kind: 'colour', text: match[0] });
  for (const match of code.matchAll(SCRIPT_SIZE)) {
    found.push({ line: lineAt(match.index), kind: match[1] === 'fontSize' ? 'font-size' : 'radius', text: match[0] });
  }
  if (tsx) for (const match of code.matchAll(STYLE_ELEMENT)) found.push({ line: lineAt(match.index), kind: 'style-element', text: match[0] });
  return found.sort((a, b) => a.line - b.line);
}

/** Selectors of rules that ask for tabular-nums without setting the Plex Mono role. */
export function tabularWithoutMono(css: string): string[] {
  const selectors: string[] = [];
  postcss.parse(css).walkRules((rule) => {
    let tabular = false;
    let mono = false;
    rule.each((node) => {
      if (node.type !== 'decl') return;
      if (node.prop === 'font-variant-numeric' && /tabular-nums/.test(node.value)) tabular = true;
      if ((node.prop === 'font-family' || node.prop === 'font') && /var\(--font-mono\)/.test(node.value)) mono = true;
    });
    if (tabular && !mono) selectors.push(rule.selector.replace(/\s+/g, ' '));
  });
  return selectors;
}

/** `sourceFiles()` minus src/styles, where the tokens themselves live. */
export function literalSourceFiles(): string[] {
  return sourceFiles().filter((file) => !file.startsWith(repoPath('src/styles') + '/'));
}
