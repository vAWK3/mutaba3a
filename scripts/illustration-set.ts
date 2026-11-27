/**
 * MUT-561: the scenes in `assets/illustrations/source/*.svg` (MUT-345, drawn in Claude Design) as React components
 * under `src/components/illustrations/generated/`, the portal's first illustration renderer. Pure (strings in, strings
 * out) so `npm run illustrations:generate` (scripts/generate-illustrations.ts) and the tests run the same logic.
 *
 * The scenes are drawn once, in the light hexes, with three colours only. Each becomes the brand token it stands for
 * (fieldBg, primary, peachStrong: the Flutter generator's `IllustrationColor` mapping), so dark mode follows the theme
 * with no second drawing, and any other colour fails the run. The dialect is the icons' (scripts/icon-set.ts) plus
 * dashed strokes (with an offset), an opacity from 0 to 1, and rotate/translate/scale/matrix transforms; no text, defs,
 * gradients or classes. A scene with a reading direction ships a second drawing, `<name>-rtl.svg`, which `Scene` picks
 * in an RTL document (2026-11-27). A scene's size follows its viewBox (160x160 or 120x96).
 */
import { ICON_ATTRS, parseSvg, renderNode, type SvgNode } from './icon-set';

export class IllustrationSetError extends Error {}

/** The three art hexes (lower case) and the token each one paints with. */
export const SCENE_PALETTE: Readonly<Record<string, string>> = {
  '#f4f2fb': 'var(--m-field-bg)',
  '#795dba': 'var(--m-primary)',
  '#e89960': 'var(--m-peach-strong)',
};

const SCENE_ATTRS: ReadonlySet<string> = new Set([...ICON_ATTRS, 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'transform']);
const COLOUR_ATTRS = ['fill', 'stroke'] as const;
const PLAIN_PAINT = new Set(['none']);

/**
 * A transform is a list of rotate(a cx cy), translate(x y), scale(s) or matrix(6 numbers). The 2026-11-27 art carries
 * the motion's pivots (`translate(p) scale(1) translate(-p)`) and flips a part with `matrix(-1 0 0 1 w 0)` inside its
 * own -rtl drawing; skews and anything malformed fail.
 */
const NUM = '-?\\d+(?:\\.\\d+)?';
const TRANSFORM_FN = new RegExp(
  `(?:rotate\\(${NUM}(?: ${NUM}){2}\\)|translate\\(${NUM}(?: ${NUM})?\\)|scale\\(${NUM}(?: ${NUM})?\\)|matrix\\(${NUM}(?: ${NUM}){5}\\))`,
);
const TRANSFORM = new RegExp(`^${TRANSFORM_FN.source}(?: ${TRANSFORM_FN.source})*$`);
const OPACITY = /^(?:0(?:\.\d+)?|1(?:\.0+)?)$/;

function paint(value: string, attr: string, fileLabel: string): string {
  if (PLAIN_PAINT.has(value)) return value;
  const token = SCENE_PALETTE[value.toLowerCase()];
  if (!token) throw new IllustrationSetError(`${fileLabel}: ${attr} ${value.toLowerCase()} is not one of the scene palette's three colours`);
  return token;
}

function mapNode(node: SvgNode, fileLabel: string): SvgNode {
  const attrs = { ...node.attrs };
  for (const attr of COLOUR_ATTRS) if (attrs[attr] !== undefined) attrs[attr] = paint(attrs[attr], attr, fileLabel);
  if (attrs.transform !== undefined && !TRANSFORM.test(attrs.transform)) {
    throw new IllustrationSetError(`${fileLabel}: transform "${attrs.transform}" must be rotate(a cx cy), translate, scale or matrix`);
  }
  if (attrs.opacity !== undefined && !OPACITY.test(attrs.opacity)) {
    throw new IllustrationSetError(`${fileLabel}: opacity "${attrs.opacity}" must be a number from 0 to 1`);
  }
  return { tag: node.tag, attrs, children: node.children.map((child) => mapNode(child, fileLabel)) };
}

/** Parses a scene and paints it with tokens. Throws IllustrationSetError (or IconSetError for the dialect), naming the file. */
export function sceneFromSvg(source: string, fileLabel: string): SvgNode {
  try {
    return mapNode(parseSvg(source, fileLabel, SCENE_ATTRS), fileLabel);
  } catch (error) {
    if (error instanceof IllustrationSetError) throw error;
    throw new IllustrationSetError((error as Error).message);
  }
}

/** `accountant-empty.svg` -> `AccountantEmptyScene`. */
export function sceneComponentName(filename: string): string {
  const pascal = filename
    .replace(/\.svg$/, '')
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  return `${pascal}Scene`;
}

/** The viewBox's drawn width and height (`0 0 120 96` -> 120, 96). Both must be positive. */
function viewBoxSize(viewBox: string, fileLabel: string): { width: number; height: number } {
  const parts = viewBox.trim().split(/[\s,]+/).map(Number);
  const [, , width, height] = parts;
  if (parts.length !== 4 || !(width > 0) || !(height > 0)) {
    throw new IllustrationSetError(`${fileLabel}: viewBox "${viewBox}" needs a positive width and height`);
  }
  return { width, height };
}

/**
 * The component's `.tsx`: decorative (`aria-hidden`), the parts kept as `data-part` for motion. `size` is the width in
 * px and defaults to the drawn width; the height keeps the art's aspect ratio (a 160x160 scene stays square, a 120x96
 * one stays 5:4).
 */
export function generateSceneComponent(componentName: string, root: SvgNode, fileLabel: string): string {
  if (root.tag !== 'svg' || !root.attrs.viewBox) throw new IllustrationSetError(`${fileLabel}: expected a root <svg> with a viewBox`);
  const { width, height } = viewBoxSize(root.attrs.viewBox, fileLabel);
  const heightExpr = width === height ? 'size' : `Math.round((size * ${height}) / ${width})`;
  const children = root.children.map((child) => renderNode(child, '      ')).join('\n');
  return `// Generated by \`npm run illustrations:generate\` from assets/illustrations/source/${fileLabel}. Do not edit.
import type { SceneArtProps } from './types';

export function ${componentName}({ size = ${width}, className }: SceneArtProps) {
  return (
    <svg width={size} height={${heightExpr}} viewBox={${JSON.stringify(root.attrs.viewBox)}} className={className} aria-hidden="true" focusable="false">
${children}
    </svg>
  );
}
`;
}

export const SCENE_PROPS_MODULE = `export interface SceneArtProps {
  /** Width in px (defaults to the drawn width); the height keeps the art's aspect ratio. */
  size?: number;
  className?: string;
}
`;

/** The registry: every scene by its file name, so `Scene` can tell a drawn scene from one still on its placeholder. */
export function generateSceneBarrel(filenames: string[]): string {
  const sorted = [...filenames].sort();
  const imports = sorted.map((file) => `import { ${sceneComponentName(file)} } from './${sceneComponentName(file)}';`);
  const key = (file: string) => {
    const name = file.replace(/\.svg$/, '');
    return /^[a-z]+$/.test(name) ? name : `'${name}'`;
  };
  const entries = sorted.map((file) => `  ${key(file)}: ${sceneComponentName(file)},`);
  return `// Generated by \`npm run illustrations:generate\`. Do not edit.
${imports.join('\n')}

export const SCENE_ART = {
${entries.join('\n')}
} as const;

export type SceneArtName = keyof typeof SCENE_ART;
export type { SceneArtProps } from './types';
`;
}
