/**
 * MUT-336: reads the canonical, multi-part icon SVGs mirrored into
 * `assets/icons/source/*.svg` (MUT-335) and turns them into React icon
 * components under `src/components/icons/generated/`. Pure here (strings in,
 * strings out) so `npm run icons:generate` / `icons:check` (scripts/generate-icons.ts,
 * scripts/validate-icon-set.ts) and the tests exercise the same logic the real
 * run uses. See `assets/icons/README.md` for the end-to-end add/update flow.
 *
 * The source dialect is a small, controlled subset the design brief fixes:
 * one root <svg>, children only path/circle/rect/g (g nesting one level), each
 * optionally carrying `id` (a named sub-part for MUT-337's future animation
 * runtime to target). A named id becomes `data-part`, never a raw `id` — two
 * instances of the same icon on one page would otherwise collide on it.
 */

export class IconSetError extends Error {}

export interface SvgNode {
  tag: string;
  attrs: Record<string, string>;
  children: SvgNode[];
}

const ALLOWED_TAGS = new Set(['svg', 'path', 'circle', 'rect', 'g']);
const ALLOWED_ATTRS = new Set([
  'xmlns', 'viewBox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'd', 'id', 'cx', 'cy', 'r', 'x', 'y', 'width', 'height', 'rx',
]);

// Attribute names SVG spells with a hyphen that JSX requires as camelCase.
const CAMEL_CASE_ATTRS: Record<string, string> = {
  'stroke-width': 'strokeWidth',
  'stroke-linecap': 'strokeLinecap',
  'stroke-linejoin': 'strokeLinejoin',
};

interface Token {
  kind: 'open' | 'close' | 'self';
  tag: string;
  attrs: Record<string, string>;
}

const TOKEN_RE = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g;
const ATTR_RE = /([\w:-]+)="([^"]*)"/g;

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  for (const match of source.matchAll(TOKEN_RE)) {
    const [, closing, tag, attrString, selfClosing] = match;
    if (closing) {
      tokens.push({ kind: 'close', tag, attrs: {} });
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const [, name, value] of attrString.matchAll(ATTR_RE)) attrs[name] = value;
    tokens.push({ kind: selfClosing ? 'self' : 'open', tag, attrs });
  }
  return tokens;
}

/** Parses one source SVG's controlled dialect into a tree. Throws IconSetError, naming `fileLabel`, on anything outside it. */
export function parseSvg(source: string, fileLabel: string): SvgNode {
  const tokens = tokenize(source);
  if (tokens.length === 0 || tokens[0].tag !== 'svg' || tokens[0].kind === 'close') {
    throw new IconSetError(`${fileLabel}: expected a root <svg> element`);
  }

  let index = 0;
  function parseNode(): SvgNode {
    const token = tokens[index];
    if (!ALLOWED_TAGS.has(token.tag)) {
      throw new IconSetError(`${fileLabel}: unrecognized element <${token.tag}>`);
    }
    for (const attr of Object.keys(token.attrs)) {
      if (!ALLOWED_ATTRS.has(attr)) {
        throw new IconSetError(`${fileLabel}: unrecognized attribute "${attr}" on <${token.tag}>`);
      }
    }
    const node: SvgNode = { tag: token.tag, attrs: token.attrs, children: [] };
    index++;
    if (token.kind === 'self') return node;

    while (index < tokens.length && tokens[index].kind !== 'close') {
      node.children.push(parseNode());
    }
    if (index >= tokens.length || tokens[index].tag !== token.tag) {
      throw new IconSetError(`${fileLabel}: unclosed <${token.tag}>`);
    }
    index++;
    return node;
  }

  const root = parseNode();
  if (index !== tokens.length) {
    throw new IconSetError(`${fileLabel}: unexpected content after the root <svg>`);
  }
  return root;
}

/** `swap-horizontal.svg` -> `SwapHorizontalIcon`. */
export function kebabToComponentName(filename: string): string {
  const base = filename.replace(/\.svg$/, '');
  const pascal = base
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  return `${pascal}Icon`;
}

function renderAttr(name: string, value: string): string {
  const jsxName = CAMEL_CASE_ATTRS[name] ?? name;
  if (jsxName === 'strokeWidth') return `strokeWidth={${Number(value)}}`;
  return `${jsxName}={${JSON.stringify(value)}}`;
}

function renderNode(node: SvgNode, indent: string): string {
  const attrs = Object.entries(node.attrs)
    .filter(([name]) => name !== 'xmlns' && name !== 'id')
    .map(([name, value]) => renderAttr(name, value));
  if (node.attrs.id) attrs.push(`data-part=${JSON.stringify(node.attrs.id)}`);

  const openTag = [node.tag, ...attrs].join(' ');
  if (node.children.length === 0) return `${indent}<${openTag} />`;

  const children = node.children.map((child) => renderNode(child, `${indent}  `)).join('\n');
  return `${indent}<${openTag}>\n${children}\n${indent}</${node.tag}>`;
}

/** Emits the component's full `.tsx` source. `root` is the parsed <svg>; `size`/`className` are always injected on it. */
export function generateComponent(componentName: string, root: SvgNode, fileLabel: string): string {
  if (root.tag !== 'svg') {
    throw new IconSetError(`${fileLabel}: generateComponent expected a parsed <svg> root`);
  }

  const rootAttrs = Object.entries(root.attrs)
    .filter(([name]) => name !== 'xmlns')
    .map(([name, value]) => renderAttr(name, value));
  const svgOpenAttrs = ['width={size}', 'height={size}', ...rootAttrs, 'className={className}'].join('\n    ');

  const children = root.children.map((child) => renderNode(child, '    ')).join('\n');

  return `import type { IconProps } from './types';

export function ${componentName}({ size = 16, className }: IconProps) {
  return (
    <svg
    ${svgOpenAttrs}
    >
${children}
    </svg>
  );
}
`;
}

export const ICON_PROPS_MODULE = `export interface IconProps {
  size?: number;
  className?: string;
}
`;

/** One sorted `export { Name } from './Name';` line per component. */
export function generateBarrel(componentNames: string[]): string {
  return [...componentNames]
    .sort()
    .map((name) => `export { ${name} } from './${name}';`)
    .join('\n') + '\n';
}

export interface IconSetProblems {
  missingGenerated: string[];
  staleGenerated: string[];
  orphanedGenerated: string[];
}

const NON_ICON_GENERATED_FILES = new Set(['index.ts', 'types.ts']);

/**
 * Drift check: `npm run icons:check`'s logic. `sourceFiles` maps `name.svg` ->
 * content; `generatedFiles` maps `Name.tsx` (plus `index.ts`/`types.ts`) ->
 * content. Regenerates each source in memory and compares — this is what
 * makes "without manual post-editing" (MUT-336 AC #1) enforceable rather than
 * aspirational.
 */
export function findIconSetProblems({
  sourceFiles,
  generatedFiles,
}: {
  sourceFiles: Record<string, string>;
  generatedFiles: Record<string, string>;
}): IconSetProblems {
  const missingGenerated: string[] = [];
  const staleGenerated: string[] = [];
  const expectedGeneratedFiles = new Set<string>();

  for (const [filename, svgContent] of Object.entries(sourceFiles)) {
    const componentName = kebabToComponentName(filename);
    const generatedPath = `${componentName}.tsx`;
    expectedGeneratedFiles.add(generatedPath);

    if (!(generatedPath in generatedFiles)) {
      missingGenerated.push(componentName);
      continue;
    }
    const fresh = generateComponent(componentName, parseSvg(svgContent, filename), filename);
    if (generatedFiles[generatedPath] !== fresh) {
      staleGenerated.push(componentName);
    }
  }

  const orphanedGenerated = Object.keys(generatedFiles)
    .filter((name) => !NON_ICON_GENERATED_FILES.has(name) && !expectedGeneratedFiles.has(name))
    .map((name) => name.replace(/\.tsx$/, ''));

  return { missingGenerated, staleGenerated, orphanedGenerated };
}
