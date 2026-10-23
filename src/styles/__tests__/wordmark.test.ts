// @vitest-environment node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import brandPins from '../../assets/brand/brand.sha256.json';
import { parseColor, repoPath, toHex } from '../../test/css/brandCss';

/**
 * The MTB3A logotype (MUT-401): one outlined SVG, used by MUT-402 as a CSS
 * mask over the ink token, so its single fill only shapes the stencil (D7).
 * These checks run on the delivered bytes; a file that fails is re-exported
 * from Claude Design, never hand-edited (D4).
 */

const WORDMARK = 'src/assets/brand/wordmark.svg';
const SHAPES = 'path, rect, circle, ellipse, polygon, polyline, line';
/** Elements that would paint something other than one flat fill, or pull in another resource. */
const FORBIDDEN_ELEMENTS = [
  'text', 'tspan', 'font', 'font-face', 'style', 'script', 'foreignObject', 'image', 'use',
  'linearGradient', 'radialGradient', 'pattern', 'mask', 'clipPath', 'filter',
];
/** One percent of the frame: the slack the tight-frame check allows at each edge (D8). */
const FRAME_TOLERANCE = 0.01;

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(repoPath(path))).digest('hex');
}

/** The SVG as a document, without its `<metadata>` (the C2PA manifest is base64, never markup). */
function svgDocument(path: string): Document {
  const doc = new JSDOM(readFileSync(repoPath(path), 'utf8'), { contentType: 'image/svg+xml' }).window.document;
  doc.querySelectorAll('metadata').forEach((node) => node.remove());
  return doc;
}

function allElements(doc: Document): Element[] {
  return [doc.documentElement, ...doc.documentElement.querySelectorAll('*')];
}

/** The fill a shape paints with: its own `fill`, else the nearest ancestor's, else SVG's default black. */
function effectiveFill(shape: Element): string | null {
  for (let node: Element | null = shape; node; node = node.parentElement) {
    const fill = node.getAttribute('fill');
    if (fill !== null) return fill;
  }
  return null;
}

/** Every point a path's commands land on, in absolute coordinates (control points excluded). */
function pathPoints(d: string): Array<[number, number]> {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  const points: Array<[number, number]> = [];
  const args: Record<string, number> = { M: 2, L: 2, T: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, A: 7, Z: 0 };
  let x = 0, y = 0, startX = 0, startY = 0, command = '', i = 0;
  const next = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) command = tokens[i++];
    const upper = command.toUpperCase();
    const relative = command !== upper;
    if (upper === 'Z') { x = startX; y = startY; continue; }
    const values = Array.from({ length: args[upper] }, next);
    if (upper === 'H') x = (relative ? x : 0) + values[0];
    else if (upper === 'V') y = (relative ? y : 0) + values[0];
    else {
      x = (relative ? x : 0) + values[values.length - 2];
      y = (relative ? y : 0) + values[values.length - 1];
    }
    if (upper === 'M') { startX = x; startY = y; command = relative ? 'l' : 'L'; }
    points.push([x, y]);
  }
  return points;
}

describe('pathPoints (the tight-frame check reads these)', () => {
  it('follows absolute and relative moves, lines and closes', () => {
    expect(pathPoints('M10 10 h5 v5 l-5 0 z m2 2 L0 0')).toEqual([[10, 10], [15, 10], [15, 15], [10, 15], [12, 12], [0, 0]]);
  });

  it('lands on a curve’s end point, never its control points', () => {
    expect(pathPoints('M0 0 C100 -50 200 50 10 20 s5 5 10 0 Q-40 0 1 1')).toEqual([[0, 0], [10, 20], [20, 20], [1, 1]]);
  });

  it('treats coordinates after a move as implicit lines', () => {
    expect(pathPoints('m1 1 2 2 3 3')).toEqual([[1, 1], [3, 3], [6, 6]]);
  });
});

describe('wordmark.svg (MUT-401)', () => {
  it('ships as one file with a viewBox, and no dark variant (D7)', () => {
    expect(existsSync(repoPath(WORDMARK))).toBe(true);
    expect(svgDocument(WORDMARK).documentElement.getAttribute('viewBox')).toMatch(/^0 0 \d+(\.\d+)? \d+(\.\d+)?$/);
    expect(existsSync(repoPath('src/assets/brand/wordmark-dark.svg'))).toBe(false);
  });

  it('is outlines and flat shapes only: no text, fonts, styles, scripts, images, gradients or masks', () => {
    const found = allElements(svgDocument(WORDMARK)).map((node) => node.localName).filter((name) => FORBIDDEN_ELEMENTS.includes(name));
    expect(found).toEqual([]);
  });

  it('carries no style, class, event, font or external-link attribute, so the portal CSP cannot change it (D4)', () => {
    const offending = allElements(svgDocument(WORDMARK)).flatMap((node) =>
      [...node.attributes]
        .filter((attr) =>
          attr.name === 'style' ||
          attr.name === 'class' ||
          attr.name.startsWith('on') ||
          attr.name.startsWith('font') ||
          (/(^|:)href$/.test(attr.name) && !attr.value.startsWith('#')),
        )
        .map((attr) => `<${node.localName} ${attr.name}>`),
    );
    expect(offending).toEqual([]);
  });

  it('paints every shape with one opaque fill and no stroke, so the mask has no gaps or half-tones', () => {
    const doc = svgDocument(WORDMARK);
    const shapes = [...doc.querySelectorAll(SHAPES)];
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

    const halfTones = allElements(doc).flatMap((node) =>
      ['opacity', 'fill-opacity', 'stroke', 'stroke-width']
        .filter((name) => node.hasAttribute(name) && !(name === 'stroke' && node.getAttribute(name) === 'none'))
        .map((name) => `<${node.localName} ${name}>`),
    );
    expect(halfTones).toEqual([]);
  });

  it('frames the ink exactly: the shapes touch all four edges and never leave the viewBox (D8)', () => {
    const doc = svgDocument(WORDMARK);
    const [minX, minY, width, height] = doc.documentElement.getAttribute('viewBox')!.split(/\s+/).map(Number);
    expect(doc.querySelectorAll(SHAPES).length, 'the frame check reads paths only').toBe(doc.querySelectorAll('path').length);
    expect(allElements(doc).some((node) => node.hasAttribute('transform')), 'a transform would move ink the check cannot see').toBe(false);

    const points = [...doc.querySelectorAll('path')].flatMap((path) => pathPoints(path.getAttribute('d') ?? ''));
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    const slackX = width * FRAME_TOLERANCE;
    const slackY = height * FRAME_TOLERANCE;

    expect(Math.min(...xs)).toBeGreaterThanOrEqual(minX);
    expect(Math.max(...xs)).toBeLessThanOrEqual(minX + width);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(minY);
    expect(Math.max(...ys)).toBeLessThanOrEqual(minY + height);
    expect(Math.min(...xs) - minX).toBeLessThanOrEqual(slackX);
    expect(minX + width - Math.max(...xs)).toBeLessThanOrEqual(slackX);
    expect(Math.min(...ys) - minY).toBeLessThanOrEqual(slackY);
    expect(minY + height - Math.max(...ys)).toBeLessThanOrEqual(slackY);
  });

  it('lives in one place: no wordmark*.svg copy anywhere under docs/brand/ (D3)', () => {
    const copies = (readdirSync(repoPath('docs/brand'), { recursive: true }) as string[])
      .filter((file) => /(^|\/)wordmark[^/]*\.svg$/.test(file));
    expect(copies).toEqual([]);
  });
});

describe('delivered brand files stay byte-identical (MUT-401 D5, D9)', () => {
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
