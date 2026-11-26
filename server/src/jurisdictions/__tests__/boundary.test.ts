import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * MUT-741 (ADR-287, AC2 and AC3): the guard. Core code may not import `jurisdictions/il/**`; it goes through
 * `jurisdictions/index.ts` (the pack registry). The allowlist is the honest remainder: every entry names why, and an entry
 * whose file no longer imports Israel must be deleted (the second test), so the list only shrinks.
 */
const SRC = join(__dirname, '..', '..');

/** Files outside `jurisdictions/` that may import `jurisdictions/il/**` directly, and why. */
export const IL_IMPORT_ALLOWLIST: Readonly<Record<string, string>> = {
  'routes/tax-authority.ts': 'the Israel-only Tax Authority endpoints (/v1/tax-authority/*)',
  'routes/tax-authority-reminders.ts': 'the Israel-only reconnect-reminder doors',
  // Commit A only: these read Israel directly until commit B moves them behind the pack (then each line is deleted).
  'expenses/compose.ts': 'TEMPORARY (B): allocation-number input check',
  'receipts/extract/merge.ts': 'TEMPORARY (B): allocation threshold',
  'serializers.ts': 'TEMPORARY (B): allocation-number-required flag',
  'routes/business-lookup.ts': 'TEMPORARY (B): tax-ID check',
  'routes/customers.ts': 'TEMPORARY (B): tax-ID check',
  'routes/issuing.ts': 'TEMPORARY (B): tax-ID check, allocation hook',
  'repositories/memory.ts': 'models the Postgres CHECK on expenses.allocation_number (a schema rule of the Israeli column, not a pack rule)',
};

const IMPORT = /(?:from|import\(|vi\.mock\()\s*['"](\.{1,2}\/[^'"]+)['"]/g;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue;
      sourceFiles(full, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const posix = (p: string): string => relative(SRC, p).split(sep).join('/');

/** `{file: [resolved relative import targets]}` for the given sources. */
export function importsOf(sources: ReadonlyMap<string, string>): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  for (const [file, text] of sources) {
    const targets: string[] = [];
    for (const m of text.matchAll(IMPORT)) targets.push(normalize(join(dirname(file), m[1]!.replace(/\.js$/, ''))).split(sep).join('/'));
    graph.set(file, targets);
  }
  return graph;
}

/** Files outside `jurisdictions/` that import something under `jurisdictions/il/`. */
export function directIlImporters(graph: ReadonlyMap<string, string[]>): string[] {
  return [...graph]
    .filter(([file, targets]) => !file.startsWith('jurisdictions/') && targets.some((t) => t === 'jurisdictions/il' || t.startsWith('jurisdictions/il/')))
    .map(([file]) => file)
    .sort();
}

/** A cycle through any `jurisdictions/**` file, as a path of module names, or null. */
export function cycleThroughJurisdictions(graph: ReadonlyMap<string, string[]>): string[] | null {
  const resolve = (target: string): string | null => (graph.has(`${target}.ts`) ? `${target}.ts` : graph.has(`${target}/index.ts`) ? `${target}/index.ts` : null);
  const visit = (file: string, path: string[], seen: Set<string>): string[] | null => {
    for (const target of graph.get(file) ?? []) {
      const next = resolve(target);
      if (!next) continue;
      const at = path.indexOf(next);
      if (at >= 0) return path.slice(at).some((f) => f.startsWith('jurisdictions/')) ? [...path.slice(at), next] : null;
      if (seen.has(next)) continue;
      seen.add(next);
      const found = visit(next, [...path, next], seen);
      if (found) return found;
    }
    return null;
  };
  for (const file of graph.keys()) if (file.startsWith('jurisdictions/')) {
    const found = visit(file, [file], new Set([file]));
    if (found) return found;
  }
  return null;
}

const real = new Map(sourceFiles(SRC).map((f) => [posix(f), readFileSync(f, 'utf8')] as const));
const graph = importsOf(real);

describe('jurisdiction boundary (MUT-741)', () => {
  it('AC3: nothing outside jurisdictions/ imports jurisdictions/il/** except the named allowlist', () => {
    const outside = directIlImporters(graph).filter((f) => !(f in IL_IMPORT_ALLOWLIST));
    expect(outside, 'core code must import Israel through jurisdictions/index.ts (or add a reasoned allowlist entry)').toEqual([]);
  });

  it('the allowlist only shrinks: every entry still imports Israel', () => {
    const importers = new Set(directIlImporters(graph));
    expect(Object.keys(IL_IMPORT_ALLOWLIST).filter((f) => !importers.has(f)), 'delete these allowlist entries').toEqual([]);
  });

  it('no import cycle runs through jurisdictions/**', () => {
    expect(cycleThroughJurisdictions(graph)).toBeNull();
  });

  describe('the guard itself fails when it should', () => {
    const fake = (files: Record<string, string>) => importsOf(new Map(Object.entries(files)));
    it('flags a core file that imports il directly', () => {
      const g = fake({ 'issuing/compose.ts': "import { x } from '../jurisdictions/il/tax-id.js';", 'jurisdictions/il/tax-id.ts': '' });
      expect(directIlImporters(g)).toEqual(['issuing/compose.ts']);
    });
    it('lets the registry door and il itself import il', () => {
      const g = fake({ 'jurisdictions/index.ts': "export * from './il/tax-id.js';", 'jurisdictions/il/tax-id.ts': '', 'issuing/compose.ts': "import { x } from '../jurisdictions/index.js';" });
      expect(directIlImporters(g)).toEqual([]);
    });
    it('finds a cycle through jurisdictions', () => {
      const g = fake({ 'jurisdictions/il/a.ts': "import { b } from '../../issuing/b.js';", 'issuing/b.ts': "import { a } from '../jurisdictions/il/a.js';" });
      expect(cycleThroughJurisdictions(g)).not.toBeNull();
    });
    it('ignores a cycle that never touches jurisdictions', () => {
      const g = fake({ 'issuing/a.ts': "import { b } from './b.js';", 'issuing/b.ts': "import { a } from './a.js';" });
      expect(cycleThroughJurisdictions(g)).toBeNull();
    });
  });
});
