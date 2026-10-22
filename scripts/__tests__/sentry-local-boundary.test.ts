import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ADR-024 / ADR-091 (MUT-148): the portal's local mode runs the API in the browser (createLocalApp imports
 * server/src/app.ts), and the local app never reports errors. So nothing reachable from it may import the
 * Sentry SDK; only server/src/index.ts and the operator scripts import observability/sentry-node.ts.
 */
const ENTRIES = ['src/hosted/local/createLocalApp.ts', 'server/src/app-shell.ts'];
const IMPORT = /(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

/** A relative specifier as written (`./x.js`) to the file on disk (`x.ts` / `x.tsx` / `x/index.ts`). */
function resolveLocal(from: string, specifier: string): string | null {
  const base = resolve(dirname(from), specifier).replace(/\.js$/, '');
  for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, base]) {
    if (existsSync(candidate) && /\.tsx?$/.test(candidate)) return candidate;
  }
  return null;
}

/** Every file reachable through relative imports, and every package specifier any of them imports. */
function importGraph(entry: string): { files: Set<string>; packages: Map<string, string> } {
  const files = new Set<string>();
  const packages = new Map<string, string>();
  const queue = [resolve(entry)];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (files.has(file)) continue;
    files.add(file);
    for (const match of readFileSync(file, 'utf8').matchAll(IMPORT)) {
      const specifier = match[1] ?? match[2] ?? '';
      if (!specifier.startsWith('.')) {
        packages.set(specifier, file);
        continue;
      }
      const next = resolveLocal(file, specifier);
      if (next) queue.push(next);
    }
  }
  return { files, packages };
}

describe('the local app never reaches the Sentry SDK (MUT-148)', () => {
  it.each(ENTRIES)('nothing reachable from %s imports @sentry/ or sentry-node.ts', (entry) => {
    const { files, packages } = importGraph(entry);
    expect(files.size).toBeGreaterThan(1);
    const sdkImports = [...packages].filter(([specifier]) => specifier.startsWith('@sentry/')).map(([specifier, file]) => `${file} → ${specifier}`);
    expect(sdkImports).toEqual([]);
    expect([...files].filter((file) => file.endsWith('observability/sentry-node.ts'))).toEqual([]);
  });

  it('really follows the graph into the server (a sanity check on the walker)', () => {
    const { files } = importGraph('src/hosted/local/createLocalApp.ts');
    expect([...files].some((file) => file.endsWith('server/src/app-shell.ts'))).toBe(true);
    expect([...files].some((file) => file.endsWith('server/src/observability/reporter.ts'))).toBe(true);
  });

  it('would catch the SDK if app-shell imported it', () => {
    const { packages } = importGraph('server/src/index.ts');
    expect([...packages.keys()].some((specifier) => specifier.startsWith('@sentry/'))).toBe(true);
  });
});
