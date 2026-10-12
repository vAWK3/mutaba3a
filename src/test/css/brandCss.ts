/**
 * Brand v2 token harness (MUT-102, eng review D2). Pure Node: it reads the
 * stylesheets with postcss and answers questions a browser would, without one.
 *
 * - `fontFaces()` lists the `@font-face` rules of a stylesheet.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss, { type Root } from 'postcss';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** An absolute path from a repo-relative one. */
export function repoPath(relative: string): string {
  return resolve(REPO_ROOT, relative);
}

export function parseCss(file: string): Root {
  return postcss.parse(readFileSync(file, 'utf8'), { from: file });
}

/** The `url()`s in a declaration value, unquoted, in order. */
export function urlsIn(value: string): string[] {
  return [...value.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)].map((m) => m[2]);
}

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
