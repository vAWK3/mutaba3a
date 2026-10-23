// @vitest-environment node
import { createHash } from 'node:crypto';
import { type Dirent, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
/** Google Play takes a feature graphic as JPEG or 24-bit PNG with no alpha: 8 bits per channel, colour type 2 (RGB). */
const PLAY_BIT_DEPTH = 8;
const PNG_RGB = 2;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

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
const PATH_TOKEN = /[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

/**
 * A path's points in absolute coordinates. `ends` are the points its commands
 * land on; `hull` adds every control point (implied ones for S and T too), and
 * a curve never leaves the hull of its points, so the hull bounds the ink.
 * Arcs have no such hull and the logotype has none, so they are refused.
 * Anything it can't read throws, so a bad export fails instead of hanging.
 */
function pathPoints(d: string): { ends: Point[]; hull: Point[] } {
  // Only SVG's own whitespace (space, tab, LF, FF, CR) and single commas between numbers; a browser stops drawing at anything else.
  const leftover = d.replace(PATH_TOKEN, ' ').replace(/[ \t\n\f\r]+/g, '');
  if (leftover.replace(/,/g, '') !== '' || /,[ \t\n\f\r]*(,|[a-zA-Z]|$)|(^|[a-zA-Z])[ \t\n\f\r]*,/.test(d)) {
    throw new Error(`unreadable path data: "${d.slice(0, 40)}"`);
  }
  const tokens = d.match(PATH_TOKEN) ?? [];
  const ends: Point[] = [];
  const hull: Point[] = [];
  let x = 0, y = 0, startX = 0, startY = 0, command = '', i = 0;
  // S reflects only the last C/S control, T only the last Q/T control; any other command clears both (SVG spec).
  let lastCubic: Point | null = null;
  let lastQuad: Point | null = null;
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
      lastCubic = lastQuad = null;
      continue;
    }
    const values = Array.from({ length: ARG_COUNTS[upper] }, next);
    const reflect = (control: Point | null): Point => (control ? [2 * x - control[0], 2 * y - control[1]] : [x, y]);
    const controls: Point[] = [];
    if (upper === 'C') controls.push(at(values[0], values[1]), at(values[2], values[3]));
    if (upper === 'S') controls.push(reflect(lastCubic), at(values[0], values[1]));
    if (upper === 'Q') controls.push(at(values[0], values[1]));
    if (upper === 'T') controls.push(reflect(lastQuad));
    let end: Point;
    if (upper === 'H') end = [(relative ? x : 0) + values[0], y];
    else if (upper === 'V') end = [x, (relative ? y : 0) + values[0]];
    else end = at(values[values.length - 2], values[values.length - 1]);
    [x, y] = end;
    if (upper === 'M') { [startX, startY] = end; command = relative ? 'l' : 'L'; }
    lastCubic = upper === 'C' || upper === 'S' ? controls[controls.length - 1] : null;
    lastQuad = upper === 'Q' || upper === 'T' ? controls[0] : null;
    ends.push(end);
    hull.push(...controls, end);
  }
  return { ends, hull };
}

/** An SVG fixture as a document, for proving the checks fail on what they guard against. */
function fixture(markup: string): Document {
  return new JSDOM(markup, { contentType: 'image/svg+xml' }).window.document;
}

/** Whether an element is allowed where it stands: its name, namespace and, for the C2PA pair, its parent. */
function allowedHere(node: Element, root: Element): boolean {
  if (!Object.hasOwn(ALLOWED_ELEMENTS, node.localName)) return false;
  if (node.localName === 'manifest') return node.namespaceURI === C2PA_NAMESPACE && node.parentElement?.localName === 'metadata';
  if (node.namespaceURI !== SVG_NAMESPACE) return false;
  if (node.localName === 'svg') return node === root;
  if (node.localName === 'metadata') return node.parentElement === root;
  return true;
}

/** Elements and attributes outside the allowlist, as `<name>` or `<name attr>`. */
function offendingNodes(doc: Document): string[] {
  const root = doc.documentElement;
  // Outside the root only comments may stand: a processing instruction can link a stylesheet, a doctype can declare entities.
  const outside = [...doc.childNodes].flatMap((node) => {
    if (node === root || node.nodeType === node.COMMENT_NODE) return [];
    if (node.nodeType === node.PROCESSING_INSTRUCTION_NODE) return [`<?${node.nodeName}>`];
    if (node.nodeType === node.DOCUMENT_TYPE_NODE) return [`<!DOCTYPE ${node.nodeName}>`];
    return [`<#${node.nodeName}>`];
  });
  return [...outside, ...allElements(doc).flatMap((node) => {
    if (!allowedHere(node, root)) return [`<${node.localName}>`];
    const allowed = ALLOWED_ELEMENTS[node.localName];
    return [...node.attributes].filter((attr) => !allowed.includes(attr.name)).map((attr) => `<${node.localName} ${attr.name}>`);
  })];
}

/** Anything in `<metadata>` that is not the single C2PA manifest as base64 text (whitespace aside). */
function metadataProblems(doc: Document): string[] {
  const problems: string[] = [];
  for (const metadata of doc.querySelectorAll('metadata')) {
    const others = [...metadata.childNodes].filter((child) =>
      !(child.nodeType === child.TEXT_NODE && !(child.textContent ?? '').trim()) &&
      !(child.nodeType === child.ELEMENT_NODE && (child as Element).namespaceURI === C2PA_NAMESPACE && (child as Element).localName === 'manifest'));
    const manifests = [...metadata.children].filter((child) => child.namespaceURI === C2PA_NAMESPACE && child.localName === 'manifest');
    if (others.length > 0) problems.push(`metadata holds ${others.length} node(s) besides the manifest`);
    if (manifests.length !== 1) problems.push(`metadata holds ${manifests.length} manifests`);
    for (const manifest of manifests) {
      if (manifest.childNodes.length !== 1 || manifest.firstChild?.nodeType !== manifest.TEXT_NODE) problems.push('the manifest holds more than text');
      if (!BASE64.test(manifest.textContent ?? '')) problems.push('the manifest is not base64');
    }
  }
  return problems;
}

/** Why a PNG is not a Play feature graphic: its size, or anything but 8-bit RGB with no transparency. */
function pngProblems(bytes: Buffer): string[] {
  const problems: string[] = [];
  const size = [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  if (size.join('x') !== '1024x500') problems.push(`size ${size.join('x')}`);
  if (bytes[24] !== PLAY_BIT_DEPTH) problems.push(`bit depth ${bytes[24]}, not 8`);
  if (bytes[25] !== PNG_RGB) problems.push(`colour type ${bytes[25]}, not RGB (2)`);
  if (bytes.includes(Buffer.from('tRNS'))) problems.push('a tRNS chunk adds transparency');
  return problems;
}

/** Every file under a directory (recursive) with `/` separators, and every symlink there (followed by nothing, so reported). */
function filesUnder(root: string): { files: string[]; links: string[] } {
  if (!existsSync(root)) return { files: [], links: [] };
  const entries = readdirSync(root, { recursive: true, withFileTypes: true });
  const pathOf = (entry: Dirent) => join(entry.parentPath, entry.name).replaceAll('\\', '/');
  return {
    files: entries.filter((entry) => entry.isFile()).map(pathOf),
    links: entries.filter((entry) => entry.isSymbolicLink()).map(pathOf),
  };
}

/** A 1024×500 PNG header with the given bit depth and colour type, for the feature-graphic checks. */
function pngHeader(depth: number, colourType: number): Buffer {
  const bytes = Buffer.alloc(33);
  Buffer.from('\x89PNG\r\n\x1a\n', 'latin1').copy(bytes, 0);
  bytes.write('IHDR', 12, 'latin1');
  bytes.writeUInt32BE(1024, 16);
  bytes.writeUInt32BE(500, 20);
  bytes[24] = depth;
  bytes[25] = colourType;
  return bytes;
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

  it('reflects the previous control point for S after C or S, and for T after Q or T, absolute and relative', () => {
    expect(pathPoints('M0 0 C0 10 10 10 10 0 S20 -10 20 0').hull).toContainEqual([10, -10]);
    expect(pathPoints('M0 0 Q5 10 10 0 T20 0').hull).toContainEqual([15, -10]);
    expect(pathPoints('M0 0 c0 10 10 10 10 0 s10 -10 10 0').hull).toEqual([[0, 0], [0, 10], [10, 10], [10, 0], [10, -10], [20, -10], [20, 0]]);
    expect(pathPoints('M0 0 q5 10 10 0 t10 0 t10 0').hull).toEqual([[0, 0], [5, 10], [10, 0], [15, -10], [20, 0], [25, 10], [30, 0]]);
  });

  it('uses the current point as the implied control when the previous command was of another kind (SVG spec)', () => {
    expect(pathPoints('M0 0 C0 10 10 10 10 0 T20 0').hull).toEqual([[0, 0], [0, 10], [10, 10], [10, 0], [10, 0], [20, 0]]);
    expect(pathPoints('M0 0 Q5 10 10 0 S20 -10 20 0').hull).toEqual([[0, 0], [5, 10], [10, 0], [10, 0], [20, -10], [20, 0]]);
    expect(pathPoints('M0 0 L10 0 T20 0').hull).toEqual([[0, 0], [10, 0], [10, 0], [20, 0]]);
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
    expect(() => pathPoints('M0 0 L1 1 # ; L5 5')).toThrow(/unreadable/);
    expect(() => pathPoints('M0 0 L1 1 L2 2')).toThrow(/unreadable/);
    expect(() => pathPoints('M0 0,,L1 1')).toThrow(/unreadable/);
    expect(() => pathPoints('M0 0 L1 1,L2 2')).toThrow(/unreadable/);
  });

  it('accepts commas, signs, packed decimals and SVG whitespace, as the grammar allows', () => {
    expect(pathPoints('M0,0L1-2,3+4').ends).toEqual([[0, 0], [1, -2], [3, 4]]);
    expect(pathPoints('M.5.5\n\tl-.5-.5 1e-3,0z').ends).toEqual([[0.5, 0.5], [0, 0], [0.001, 0]]);
  });
});

describe('the logotype checks fail on what they guard against', () => {
  const SVG = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"';

  it('rejects elements nobody listed, including names Object.prototype owns and a nested svg', () => {
    expect(offendingNodes(fixture(`<svg ${SVG}><constructor/></svg>`))).toEqual(['<constructor>']);
    expect(offendingNodes(fixture(`<svg ${SVG}><toString id="x"/></svg>`))).toEqual(['<toString>']);
    expect(offendingNodes(fixture(`<svg ${SVG}><svg viewBox="0 0 1 1"/></svg>`))).toEqual(['<svg>']);
    expect(offendingNodes(fixture(`<svg ${SVG}><path d="M0 0"><set attributeName="fill" to="red"/></path></svg>`))).toEqual(['<set>']);
  });

  it('rejects an allowlisted name in the wrong namespace or place', () => {
    expect(offendingNodes(fixture(`<svg ${SVG}><path xmlns="urn:other" d="M0 0"/></svg>`))).toEqual(['<path>']);
    expect(offendingNodes(fixture(`<svg ${SVG} xmlns:c2pa="${C2PA_NAMESPACE}"><g><metadata/></g></svg>`))).toEqual(['<metadata>']);
    expect(offendingNodes(fixture(`<svg ${SVG} xmlns:c2pa="${C2PA_NAMESPACE}"><c2pa:manifest>AA==</c2pa:manifest></svg>`))).toEqual(['<manifest>']);
  });

  it('rejects a stylesheet instruction or doctype outside the root', () => {
    expect(offendingNodes(fixture(`<?xml-stylesheet href="x.css"?><svg ${SVG}/>`))).toEqual(['<?xml-stylesheet>']);
    expect(offendingNodes(fixture(`<!DOCTYPE svg><svg ${SVG}/>`))).toEqual(['<!DOCTYPE svg>']);
  });

  it('rejects anything in <metadata> beyond the base64 manifest', () => {
    const wrap = (inner: string) => fixture(`<svg ${SVG} xmlns:c2pa="${C2PA_NAMESPACE}"><metadata>${inner}</metadata></svg>`);
    expect(metadataProblems(wrap('<c2pa:manifest>AAAA</c2pa:manifest>'))).toEqual([]);
    expect(metadataProblems(wrap('loose text<c2pa:manifest>AAAA</c2pa:manifest>'))).not.toEqual([]);
    expect(metadataProblems(wrap('<c2pa:manifest>AAAA</c2pa:manifest><![CDATA[x]]>'))).not.toEqual([]);
    expect(metadataProblems(wrap('<c2pa:manifest>not base64!</c2pa:manifest>'))).not.toEqual([]);
    expect(metadataProblems(wrap('\n  <c2pa:manifest>AA\nAA</c2pa:manifest>\n'))).toEqual([]);
    expect(metadataProblems(wrap(''))).toEqual(['metadata holds 0 manifests']);
    expect(metadataProblems(wrap('<c2pa:manifest>AAAA</c2pa:manifest><c2pa:manifest>AAAA</c2pa:manifest>'))).toEqual(['metadata holds 2 manifests']);
    expect(metadataProblems(wrap('<c2pa:manifest><![CDATA[AAAA]]></c2pa:manifest>'))).toEqual(['the manifest holds more than text']);
  });

  it('rejects a feature graphic with alpha, a palette, or 16-bit channels', () => {
    expect(pngProblems(pngHeader(8, 2))).toEqual([]);
    expect(pngProblems(pngHeader(8, 6))).not.toEqual([]);
    expect(pngProblems(pngHeader(16, 2))).not.toEqual([]);
    expect(pngProblems(pngHeader(8, 0))).not.toEqual([]);
    expect(pngProblems(pngHeader(8, 3))).not.toEqual([]);
    expect(pngProblems(Buffer.concat([pngHeader(8, 2), Buffer.from('tRNS')]))).toEqual(['a tRNS chunk adds transparency']);
  });

  it('reports a symlink in a scanned folder instead of skipping it', () => {
    const root = mkdtempSync(join(tmpdir(), 'wordmark-scan-'));
    try {
      mkdirSync(join(root, 'real'));
      writeFileSync(join(root, 'real', 'a.svg'), '<svg/>');
      symlinkSync(join(root, 'real'), join(root, 'linked'));
      symlinkSync(join(root, 'missing'), join(root, 'dangling'));
      // Whether Node walks into the linked folder varies by version; the link itself is always reported, and the copy check fails on any.
      const { files, links } = filesUnder(root);
      expect(files).toContain(`${root}/real/a.svg`);
      expect(links.sort()).toEqual([`${root}/dangling`, `${root}/linked`]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('wordmark.svg (MUT-401)', () => {
  it('ships as one file with a viewBox, and no dark variant (eng D7)', () => {
    expect(existsSync(repoPath(WORDMARK))).toBe(true);
    expect(svgDocument(WORDMARK).documentElement.getAttribute('viewBox')).toMatch(/^0 0 \d+(\.\d+)? \d+(\.\d+)?$/);
    expect(existsSync(repoPath('src/assets/brand/wordmark-dark.svg'))).toBe(false);
  });

  it('holds only allowlisted elements and attributes, so nothing can animate, hide, move, style or link it (eng D4)', () => {
    expect(offendingNodes(svgDocument(WORDMARK))).toEqual([]);
  });

  it('keeps only the C2PA manifest, as base64 text, inside <metadata>', () => {
    expect(metadataProblems(svgDocument(WORDMARK))).toEqual([]);
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
    const own = readFileSync(repoPath(WORDMARK));
    const scans = COPY_ROOTS.map((dir) => filesUnder(repoPath(dir)));
    const files = scans.flatMap((scan) => scan.files);
    expect(scans.flatMap((scan) => scan.links), 'a symlink could hide a copy from this scan').toEqual([]);
    expect(files.filter((file) => readFileSync(file).equals(own))).toEqual([]);
    expect(files.filter((file) => /(wordmark|mtb3a)[^/]*\.svg$/i.test(file))).toEqual([]);
  });
});

describe('the Play feature graphic (MUT-401, for MUT-404)', () => {
  it('is a 1024×500, 24-bit RGB PNG with no alpha, as Google Play requires', () => {
    expect(pngSize(repoPath(FEATURE_GRAPHIC))).toEqual([1024, 500]);
    expect(pngProblems(readFileSync(repoPath(FEATURE_GRAPHIC)))).toEqual([]);
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
