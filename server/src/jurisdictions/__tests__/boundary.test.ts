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
  'repositories/memory.ts': 'models the Postgres CHECK on expenses.allocation_number (a schema rule of the Israeli column, not a pack rule)',
};

/**
 * Files outside `jurisdictions/` that call `defaultPack()`: code with no issuer in hand. Each is a place that must learn
 * its country (MUT-742 gives documents a jurisdiction; MUT-743 the rest) before a second pack goes live. It may not spread.
 */
export const DEFAULT_PACK_USERS: Readonly<Record<string, string>> = {
  'app.ts': 'the boot-time default for the uniform-file house (software registration)',
  'expenses/compose.ts': 'allocation-number input on an expense: expenses carry no jurisdiction',
  'receipts/extract/merge.ts': 'allocation threshold hint on a scanned receipt',
  'serializers.ts': 'the expense list\'s allocation-number-missing flag',
  'vat-periods/pack.ts': 'a profile with no issuer details carries no country yet, yet an accountant may still choose its VAT period (MUT-782); the country on its issuer details is read first',
  'routes/business-lookup.ts': 'tax-ID check on a lookup: no issuer in the request',
  'routes/customers.ts': 'tax-ID check on a customer: customers carry no country yet',
  'routes/issuing.ts': 'the setup read before any issuer exists, and the uniform-file route\'s documented media type',
  'routes/issuing-retention.ts': 'archive file names: a document row carries no jurisdiction until MUT-742',
  'issuing/retention.ts': 'the keep period and the document day: a document row carries no jurisdiction until MUT-742',
};

const IMPORT = /(?:from|import\(|vi\.mock\()\s*['"](\.{1,2}\/[^'"]+)['"]/g;
/** `import type …` and `export type …` statements are erased at compile time: they cannot form a runtime cycle. */
const TYPE_ONLY = /^\s*(?:import|export)\s+type\b[^;]*;/gm;

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
    for (const m of text.replace(TYPE_ONLY, '').matchAll(IMPORT)) targets.push(normalize(join(dirname(file), m[1]!.replace(/\.js$/, ''))).split(sep).join('/'));
    graph.set(file, targets);
  }
  return graph;
}

/** A pack's own directory, `jurisdictions/<cc>` (MUT-745: every pack, not only Israel's). */
const PACK_DIR = /^jurisdictions\/[a-z]{2}(\/|$)/;

/**
 * Files outside `jurisdictions/` that import something under a pack's directory (`jurisdictions/il/`, `jurisdictions/jo/`,
 * …), or under one pack's when `cc` is given.
 */
export function directPackImporters(graph: ReadonlyMap<string, string[]>, cc?: string): string[] {
  const inPack = (t: string) => (cc ? t === `jurisdictions/${cc}` || t.startsWith(`jurisdictions/${cc}/`) : PACK_DIR.test(t));
  return [...graph]
    .filter(([file, targets]) => !file.startsWith('jurisdictions/') && targets.some(inPack))
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

/** Files outside `jurisdictions/` whose runtime code calls `defaultPack(`. */
export function defaultPackCallers(sources: ReadonlyMap<string, string>): string[] {
  return [...sources]
    .filter(([file, text]) => !file.startsWith('jurisdictions/') && /\bdefaultPack\(/.test(text.replace(TYPE_ONLY, '')))
    .map(([file]) => file)
    .sort();
}

describe('jurisdiction boundary (MUT-741)', () => {
  it('AC3: nothing outside jurisdictions/ imports a pack (jurisdictions/<cc>/**) except Israel\'s named allowlist', () => {
    const outside = directPackImporters(graph).filter((f) => !(f in IL_IMPORT_ALLOWLIST && directPackImporters(graph, 'il').includes(f)));
    expect(outside, 'core code must import a pack through jurisdictions/index.ts (or add a reasoned allowlist entry)').toEqual([]);
  });

  it('the allowlist only shrinks: every entry still imports Israel', () => {
    const importers = new Set(directPackImporters(graph, 'il'));
    expect(Object.keys(IL_IMPORT_ALLOWLIST).filter((f) => !importers.has(f)), 'delete these allowlist entries').toEqual([]);
  });

  it('defaultPack() is called only from the named list, and every entry still calls it', () => {
    const callers = defaultPackCallers(real);
    expect(callers.filter((f) => !(f in DEFAULT_PACK_USERS)), 'a new caller must be named (and explained) in DEFAULT_PACK_USERS, or take its pack from its issuer').toEqual([]);
    expect(Object.keys(DEFAULT_PACK_USERS).filter((f) => !callers.includes(f)), 'delete these entries').toEqual([]);
  });

  it('the issuing core and its routes name no currency (the pack does)', () => {
    for (const file of ['issuing/compose.ts', 'issuing/documents-due.ts', 'routes/issuing.ts', 'routes/documents-due.ts']) {
      expect(real.get(file) ?? '', file).not.toMatch(/'ILS'|"ILS"/);
    }
  });

  it('no import cycle runs through jurisdictions/**', () => {
    expect(cycleThroughJurisdictions(graph)).toBeNull();
  });

  describe('the guard itself fails when it should', () => {
    const fake = (files: Record<string, string>) => importsOf(new Map(Object.entries(files)));
    it('flags a core file that imports il directly', () => {
      const g = fake({ 'issuing/compose.ts': "import { x } from '../jurisdictions/il/tax-id.js';", 'jurisdictions/il/tax-id.ts': '' });
      expect(directPackImporters(g)).toEqual(['issuing/compose.ts']);
    });
    it('MUT-745: flags a core file that imports any other pack directly, and tells packs apart', () => {
      const g = fake({ 'routes/x.ts': "import { y } from '../jurisdictions/jo/vat.js';", 'jurisdictions/jo/vat.ts': '', 'jurisdictions/__tests__/z.ts': '' });
      expect(directPackImporters(g)).toEqual(['routes/x.ts']);
      expect(directPackImporters(g, 'il')).toEqual([]);
      expect(directPackImporters(g, 'jo')).toEqual(['routes/x.ts']);
    });
    it('lets the registry door and il itself import il', () => {
      const g = fake({ 'jurisdictions/index.ts': "export * from './il/tax-id.js';", 'jurisdictions/il/tax-id.ts': '', 'issuing/compose.ts': "import { x } from '../jurisdictions/index.js';" });
      expect(directPackImporters(g)).toEqual([]);
    });
    it('flags a defaultPack() call that is not on the list', () => {
      expect(defaultPackCallers(new Map([['issuing/compose.ts', 'const p = defaultPack();'], ['jurisdictions/registry.ts', 'defaultPack()'], ['routes/x.ts', "import type { defaultPack } from '../jurisdictions/index.js';"]]))).toEqual(['issuing/compose.ts']);
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
