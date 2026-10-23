// @vitest-environment node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import brandPins from '../../assets/brand/brand.sha256.json';
import { parseColor, repoPath, toHex } from '../../test/css/brandCss';
import { pngSize } from '../../test/pngSize';

/**
 * The MTB3A logotype (MUT-401): one outlined SVG, used by MUT-402 as a CSS
 * mask over the ink token, so its single fill only shapes the stencil (eng D7).
 * These checks run on the delivered bytes; a file that fails is re-exported
 * from Claude Design, never hand-edited (eng D4).
 */

const WORDMARK = 'src/assets/brand/wordmark.svg';
const FEATURE_GRAPHIC = 'docs/brand/wordmark/store/feature-graphic-en-1024x500.png';
/** Where a second copy of the logotype could ship or drift (eng D3). */
const COPY_ROOTS = ['docs/brand', 'public', 'src/hosted/public'];
/** One percent of the frame: the slack the tight-frame check allows at each edge (eng D8). */
const FRAME_TOLERANCE = 0.01;
/** PNG colour types without an alpha channel: grey, RGB, palette (palette is checked for tRNS separately). */
const OPAQUE_PNG_COLOUR_TYPES = [0, 2, 3];

/**
 * Everything the logotype may contain. Anything else (animation, nested svg,
 * symbols, markers, filters, masks, images, text, styles, scripts, or an
 * attribute that hides, moves or links) fails, including kinds nobody listed.
 */
const ALLOWED_ELEMENTS: Record<string, readonly string[]> = {
  svg: ['xmlns', 'xmlns:c2pa', 'viewBox', 'role', 'aria-label'],
  title: ['id'],
  desc: ['id'],
  metadata: [],
  manifest: [],
  g: ['id', 'fill', 'fill-rule', 'clip-rule'],
  path: ['id', 'fill', 'fill-rule', 'clip-rule', 'd'],
};
const C2PA_NAMESPACE = 'http://c2pa.org/manifest';
const BASE64 = /^[A-Za-z0-9+/=\s]*$/;

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(repoPath(path))).digest('hex');
}

/** The SVG as a parsed document, metadata included. */
function svgDocument(path: string): Document {
  return new JSDOM(readFileSync(repoPath(path), 'utf8'), { contentType: 'image/svg+xml' }).window.document;
}

function allElements(doc: Document): Element[] {
  return [doc.documentElement, ...doc.documentElement.querySelectorAll('*')];
}

/** The fill a shape paints with: its own `fill`, else the nearest ancestor's, else null (SVG would paint its default black). */
function effectiveFill(shape: Element): string | null {
  for (let node: Element | null = shape; node; node = node.parentElement) {
    const fill = node.getAttribute('fill');
    if (fill !== null) return fill;
  }
  return null;
}

type Point = [number, number];
const ARG_COUNTS: Record<string, number> = { M: 2, L: 2, T: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, A: 7, Z: 0 };

/**
 * A path's points in absolute coordinates. `ends` are the points its commands
 * land on; `hull` adds every control point (implied ones for S and T too), and
 * a curve never leaves the hull of its points, so the hull bounds the ink.
 * Arcs have no such hull and the logotype has none, so they are refused.
 * Anything it can't read throws, so a bad export fails instead of hanging.
 */
function pathPoints(d: string): { ends: Point[]; hull: Point[] } {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const ends: Point[] = [];
  const hull: Point[] = [];
  let x = 0, y = 0, startX = 0, startY = 0, command = '', i = 0;
  let lastControl: Point | null = null;
  const isCommand = (token: string | undefined) => token !== undefined && /^[a-zA-Z]$/.test(token);
  const next = () => {
    if (i >= tokens.length || isCommand(tokens[i])) throw new Error(`path ends mid-command ${command}: "${d.slice(0, 40)}"`);
    return Number(tokens[i++]);
  };
  while (i < tokens.length) {
    if (isCommand(tokens[i])) command = tokens[i++];
    const upper = command.toUpperCase();
    if (!(upper in ARG_COUNTS)) throw new Error(`unsupported path command "${command || tokens[i]}"`);
    if (upper === 'A') throw new Error('arcs have no control-point hull, so the frame check refuses them');
    const relative = command !== upper;
    const at = (dx: number, dy: number): Point => [(relative ? x : 0) + dx, (relative ? y : 0) + dy];
    if (upper === 'Z') {
      if (i < tokens.length && !isCommand(tokens[i])) throw new Error('a number follows Z without a command');
      [x, y] = [startX, startY];
      lastControl = null;
      continue;
    }
    const values = Array.from({ length: ARG_COUNTS[upper] }, next);
    const controls: Point[] = [];
    if (upper === 'C') controls.push(at(values[0], values[1]), at(values[2], values[3]));
    if (upper === 'Q') controls.push(at(values[0], values[1]));
    if (upper === 'S' || upper === 'T') {
      const reflected: Point = lastControl ? [2 * x - lastControl[0], 2 * y - lastControl[1]] : [x, y];
      controls.push(reflected);
      if (upper === 'S') controls.push(at(values[0], values[1]));
    }
    let end: Point;
    if (upper === 'H') end = [(relative ? x : 0) + values[0], y];
    else if (upper === 'V') end = [x, (relative ? y : 0) + values[0]];
    else end = at(values[values.length - 2], values[values.length - 1]);
    [x, y] = end;
    if (upper === 'M') { [startX, startY] = end; command = relative ? 'l' : 'L'; }
    lastControl = controls.length > 0 ? controls[controls.length - 1] : null;
    ends.push(end);
    hull.push(...controls, end);
  }
  return { ends, hull };
}

/** Every file under a repo directory (recursive), as repo-relative paths with `/` separators. */
function filesUnder(dir: string): string[] {
  if (!existsSync(repoPath(dir))) return [];
  return (readdirSync(repoPath(dir), { recursive: true }) as string[])
    .map((file) => `${dir}/${file.replaceAll('\\', '/')}`)
    .filter((file) => statSync(repoPath(file)).isFile());
}

describe('pathPoints (the frame check reads these)', () => {
  it('follows absolute and relative moves, lines and closes', () => {
    expect(pathPoints('M10 10 h5 v5 l-5 0 z m2 2 L0 0').ends).toEqual([[10, 10], [15, 10], [15, 15], [10, 15], [12, 12], [0, 0]]);
  });

  it('lands on a curve’s end point, and puts its control points in the hull', () => {
    const { ends, hull } = pathPoints('M0 0 C100 -50 200 50 10 20 Q-40 0 1 1');
    expect(ends).toEqual([[0, 0], [10, 20], [1, 1]]);
    expect(hull).toEqual([[0, 0], [100, -50], [200, 50], [10, 20], [-40, 0], [1, 1]]);
  });

  it('reflects the previous control point for S and T', () => {
    expect(pathPoints('M0 0 C0 10 10 10 10 0 S20 -10 20 0').hull).toContainEqual([10, -10]);
    expect(pathPoints('M0 0 Q5 10 10 0 T20 0').hull).toContainEqual([15, -10]);
  });

  it('treats coordinates after a move as implicit lines, and reads upper-case exponents', () => {
    expect(pathPoints('m1 1 2 2 3 3').ends).toEqual([[1, 1], [3, 3], [6, 6]]);
    expect(pathPoints('M1E1 0').ends).toEqual([[10, 0]]);
  });

  it('throws, never hangs, on path data it cannot read', () => {
    expect(() => pathPoints('5 5 L1 1')).toThrow(/unsupported/);
    expect(() => pathPoints('M0 0 X1 1')).toThrow(/unsupported/);
    expect(() => pathPoints('M0 0 L1 1 Z 2 2')).toThrow(/follows Z/);
    expect(() => pathPoints('M0 0 L1')).toThrow(/mid-command/);
    expect(() => pathPoints('M0 0 A5 5 0 0 1 10 0')).toThrow(/arcs/);
  });
});

describe('wordmark.svg (MUT-401)', () => {
  it('ships as one file with a viewBox, and no dark variant (eng D7)', () => {
    expect(existsSync(repoPath(WORDMARK))).toBe(true);
    expect(svgDocument(WORDMARK).documentElement.getAttribute('viewBox')).toMatch(/^0 0 \d+(\.\d+)? \d+(\.\d+)?$/);
    expect(existsSync(repoPath('src/assets/brand/wordmark-dark.svg'))).toBe(false);
  });

  it('holds only allowlisted elements and attributes, so nothing can animate, hide, move, style or link it (eng D4)', () => {
    const doc = svgDocument(WORDMARK);
    const offending = allElements(doc).flatMap((node) => {
      const allowed = ALLOWED_ELEMENTS[node.localName];
      if (!allowed || (node.localName === 'svg' && node !== doc.documentElement)) return [`<${node.localName}>`];
      return [...node.attributes].filter((attr) => !allowed.includes(attr.name)).map((attr) => `<${node.localName} ${attr.name}>`);
    });
    expect(offending).toEqual([]);
  });

  it('keeps only the C2PA manifest, as base64 text, inside <metadata>', () => {
    for (const metadata of svgDocument(WORDMARK).querySelectorAll('metadata')) {
      const children = [...metadata.children];
      expect(children.map((child) => [child.namespaceURI, child.localName])).toEqual([[C2PA_NAMESPACE, 'manifest']]);
      expect(children[0].children).toHaveLength(0);
      expect(BASE64.test(children[0].textContent ?? '')).toBe(true);
    }
  });

  it('paints every path with one opaque fill, so the mask has no gaps or half-tones', () => {
    const shapes = [...svgDocument(WORDMARK).querySelectorAll('path')];
    expect(shapes.length).toBeGreaterThan(0);

    const fills = shapes.map(effectiveFill);
    expect(fills, 'a shape with no fill renders black').not.toContain(null);
    const colours = new Set(fills.map((fill) => {
      expect(fill).not.toMatch(/^(none|currentColor|url\()/i);
      const rgba = parseColor(fill!);
      expect(rgba.a, `${fill} is not opaque`).toBe(1);
      return toHex(rgba);
    }));
    expect([...colours]).toHaveLength(1);
  });

  it('frames the ink exactly: the outline touches all four edges and no curve leaves the viewBox (eng D8)', () => {
    const doc = svgDocument(WORDMARK);
    const [minX, minY, width, height] = doc.documentElement.getAttribute('viewBox')!.split(/\s+/).map(Number);
    const parsed = [...doc.querySelectorAll('path')].map((path) => pathPoints(path.getAttribute('d') ?? ''));
    const ends = parsed.flatMap((p) => p.ends);
    const hull = parsed.flatMap((p) => p.hull);
    const slackX = width * FRAME_TOLERANCE;
    const slackY = height * FRAME_TOLERANCE;

    expect(Math.min(...hull.map(([x]) => x))).toBeGreaterThanOrEqual(minX);
    expect(Math.max(...hull.map(([x]) => x))).toBeLessThanOrEqual(minX + width);
    expect(Math.min(...hull.map(([, y]) => y))).toBeGreaterThanOrEqual(minY);
    expect(Math.max(...hull.map(([, y]) => y))).toBeLessThanOrEqual(minY + height);

    expect(Math.min(...ends.map(([x]) => x)) - minX).toBeLessThanOrEqual(slackX);
    expect(minX + width - Math.max(...ends.map(([x]) => x))).toBeLessThanOrEqual(slackX);
    expect(Math.min(...ends.map(([, y]) => y)) - minY).toBeLessThanOrEqual(slackY);
    expect(minY + height - Math.max(...ends.map(([, y]) => y))).toBeLessThanOrEqual(slackY);
  });

  it('lives in one place: no copy of its bytes, and no wordmark or MTB3A SVG, in docs/brand, public or the portal (eng D3)', () => {
    const own = sha256(WORDMARK);
    const files = COPY_ROOTS.flatMap(filesUnder);
    expect(files.filter((file) => sha256(file) === own)).toEqual([]);
    expect(files.filter((file) => /(wordmark|mtb3a)[^/]*\.svg$/i.test(file))).toEqual([]);
  });
});

describe('the Play feature graphic (MUT-401, for MUT-404)', () => {
  it('is 1024×500 with no alpha channel, as Google Play requires', () => {
    const bytes = readFileSync(repoPath(FEATURE_GRAPHIC));
    expect(pngSize(repoPath(FEATURE_GRAPHIC))).toEqual([1024, 500]);
    expect(OPAQUE_PNG_COLOUR_TYPES, `PNG colour type ${bytes[25]} carries alpha`).toContain(bytes[25]);
    expect(bytes.includes(Buffer.from('tRNS')), 'a tRNS chunk adds transparency').toBe(false);
  });
});

describe('delivered brand files stay byte-identical (MUT-401 eng D5, D9)', () => {
  it('pins exactly the files under test, so a new or dropped pin is a reviewed change', () => {
    expect(Object.keys(brandPins.files).sort()).toEqual([
      'public/apple-touch-icon.png',
      'public/favicon-16.png',
      'public/favicon-32.png',
      'public/favicon-48.png',
      'public/favicon.svg',
      'public/icons/icon-1024.png',
      'public/icons/icon-192.png',
      'public/icons/icon-512.png',
      'public/icons/maskable-512.png',
      'src/assets/brand/mark-dark.svg',
      'src/assets/brand/mark.svg',
      WORDMARK,
    ]);
  });

  it.each(Object.entries(brandPins.files))('%s matches its pin', (file, hash) => {
    expect(sha256(file)).toBe(hash);
  });
});
