/**
 * Missing and orphaned translation keys (MUT-24). Pure, so the test runs it
 * against the real source and `npm run i18n:check` prints the same report.
 *
 * - A key is **missing** when code passes a literal to `t(…)`, `tp(…)` or
 *   `has(…)` and the dictionary has no string or plural at that path.
 * - A key is **orphaned** when no string literal in the source names it and no
 *   dynamic key reaches it. Three shapes are dynamic, each reaching every key
 *   under its prefix:
 *   - a template literal whose text before the first `${` holds a dot
 *     (`` `settings.items.${k}` ``, `` `landing.faq.q${n}` ``);
 *   - a concatenation onto a literal ending in a dot (`'nav.' + id`);
 *   - a literal naming a namespace rather than a string
 *     (`const T = 'landing.hostedOffer'`, then `` `${T}.hero.title` ``).
 *
 * Plurals (`{ one, other, … }`) count as one key at their parent path.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

type Node = string | { [key: string]: Node };

const PLURAL_FORMS = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);
const KEY_SHAPE = /^[A-Za-z][\w-]*(\.[\w-]+)+$/;

function isPlural(node: Node): boolean {
  return typeof node === 'object' && 'other' in node && Object.keys(node).every((k) => PLURAL_FORMS.has(k));
}

/** Every translatable key (string leaves, and plurals at their parent path) and every namespace path. */
export function dictionaryPaths(dictionary: object): { keys: string[]; namespaces: Set<string> } {
  const keys: string[] = [];
  const namespaces = new Set<string>();
  const walk = (node: Node, path: string) => {
    if (typeof node === 'string' || isPlural(node)) return void keys.push(path);
    if (path) namespaces.add(path);
    for (const [key, child] of Object.entries(node)) walk(child, path ? `${path}.${key}` : key);
  };
  walk(dictionary as Node, '');
  return { keys, namespaces };
}

export interface SourceRefs {
  /** Every quoted string that looks like a key (`a.b`). */
  literals: Set<string>;
  /** The literal start of each dynamic key. */
  prefixes: Set<string>;
  /** Literal keys passed straight to a translate call, with the file they are in. */
  calls: { key: string; file: string }[];
}

const QUOTED = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
const TEMPLATE_PREFIX = /`([A-Za-z][\w-]*\.[\w.-]*)\$\{/g;
const CONCAT_PREFIX = /(['"])([A-Za-z][\w.-]*\.)\1\s*\+/g;
const CALL = /\b(?:t|tp|has)\(\s*(['"])([^'"\n]+)\1/g;
/** Property access on a dictionary (`ar.landing.hero.title` in vite.config.ts). */
const PROPERTY = /\b(?:ar|en)((?:\.[A-Za-z]\w*)+)/g;

/** The key references in a set of source files, keyed by path. */
export function scanSources(files: Record<string, string>): SourceRefs {
  const refs: SourceRefs = { literals: new Set(), prefixes: new Set(), calls: [] };
  for (const [file, text] of Object.entries(files)) {
    for (const [, , value] of text.matchAll(QUOTED)) if (KEY_SHAPE.test(value)) refs.literals.add(value);
    for (const [, prefix] of text.matchAll(TEMPLATE_PREFIX)) refs.prefixes.add(prefix);
    for (const [, , prefix] of text.matchAll(CONCAT_PREFIX)) refs.prefixes.add(prefix);
    for (const [, , key] of text.matchAll(CALL)) if (KEY_SHAPE.test(key)) refs.calls.push({ key, file });
    for (const [, path] of text.matchAll(PROPERTY)) refs.literals.add(path.slice(1));
  }
  return refs;
}

export interface KeyProblems {
  missing: { key: string; file: string }[];
  orphaned: string[];
}

export function findKeyProblems(dictionary: object, refs: SourceRefs): KeyProblems {
  const { keys, namespaces } = dictionaryPaths(dictionary);
  const defined = new Set(keys);
  const namedNamespaces = [...refs.literals].filter((literal) => namespaces.has(literal)).map((ns) => `${ns}.`);
  const prefixes = [...refs.prefixes, ...namedNamespaces];
  const missing = refs.calls.filter(({ key }) => !defined.has(key));
  const orphaned = keys.filter(
    (key) => !refs.literals.has(key) && !prefixes.some((prefix) => key.startsWith(prefix)),
  );
  return { missing, orphaned };
}

/**
 * Where the app's keys are used: every non-test source file under `src/`
 * except the portal (`src/hosted`, which has its own dictionaries), plus
 * `vite.config.ts` (the share-card copy). Tests do not count as a use.
 */
const SKIPPED_DIRS = new Set(['__tests__', 'hosted', 'test', 'node_modules']);

export function collectSources(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        if (!SKIPPED_DIRS.has(name)) walk(path);
      } else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) {
        files[relative(root, path)] = readFileSync(path, 'utf8');
      }
    }
  };
  walk(join(root, 'src'));
  files['vite.config.ts'] = readFileSync(join(root, 'vite.config.ts'), 'utf8');
  return files;
}

/** The English dictionary, composed from its files the way the app's barrel does. */
export function loadDictionary(root: string, language: 'en' | 'ar' = 'en'): Record<string, unknown> {
  const dir = join(root, 'src/lib/i18n/translations', language);
  const files = readdirSync(dir).filter((name) => name.endsWith('.json'));
  return Object.assign({}, ...files.map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8'))));
}

/** One line per problem, for the CLI and for test failure output. */
export function formatProblems({ missing, orphaned }: KeyProblems): string[] {
  return [
    ...missing.map(({ key, file }) => `missing: ${key} (${file})`),
    ...orphaned.map((key) => `orphaned: ${key}`),
  ];
}
