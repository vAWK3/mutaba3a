import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import {
  collectSources,
  dictionaryPaths,
  findKeyProblems,
  formatProblems,
  loadDictionary,
  scanSources,
} from '../i18n-keys';

const DICTIONARY = {
  nav: { home: 'Home', clients: 'Clients' },
  faq: { q1: 'Q', a1: 'A' },
  offer: { hero: { title: 'T' } },
  items: { count: { one: '{count} item', other: '{count} items' } },
  dead: { key: 'Never used' },
};

function problems(source: string) {
  return findKeyProblems(DICTIONARY, scanSources({ 'src/x.tsx': source }));
}

describe('dictionaryPaths', () => {
  it('lists string leaves and plurals as keys, and every object above them as a namespace', () => {
    const { keys, namespaces } = dictionaryPaths(DICTIONARY);
    expect(keys).toEqual(['nav.home', 'nav.clients', 'faq.q1', 'faq.a1', 'offer.hero.title', 'items.count', 'dead.key']);
    expect([...namespaces]).toEqual(['nav', 'faq', 'offer', 'offer.hero', 'items', 'dead']);
  });
});

describe('findKeyProblems', () => {
  const ALL_USED = "t('nav.home'); const k = 'nav.clients'; t(`faq.q${n}`); t(`faq.a${n}`); t('offer.hero.title'); tp('items.count', 2); t('dead.key');";

  it('finds nothing when every key is reached', () => {
    expect(problems(ALL_USED)).toEqual({ missing: [], orphaned: [] });
  });

  it('reports a key passed to t, tp or has that the dictionary lacks, with its file', () => {
    expect(problems(`${ALL_USED} t('nav.gone'); tp("items.gone", 1); has('faq.gone');`).missing).toEqual([
      { key: 'nav.gone', file: 'src/x.tsx' },
      { key: 'items.gone', file: 'src/x.tsx' },
      { key: 'faq.gone', file: 'src/x.tsx' },
    ]);
  });

  it('reports a key nothing reaches', () => {
    expect(problems(ALL_USED.replace("t('dead.key');", '')).orphaned).toEqual(['dead.key']);
  });

  it('counts a key held in data as used (labelKey: "nav.home")', () => {
    expect(problems('const items = [{ labelKey: "nav.home" }];').orphaned).not.toContain('nav.home');
  });

  it('lets a template literal reach every key under its text before ${', () => {
    expect(problems('t(`faq.${id}`)').orphaned).not.toEqual(expect.arrayContaining(['faq.q1', 'faq.a1']));
    expect(problems('t(`faq.q${n}`)').orphaned).toContain('faq.a1');
  });

  it("lets a concatenation onto a dotted literal reach that namespace ('nav.' + id)", () => {
    const { orphaned } = problems("t('nav.' + id)");
    expect(orphaned).not.toContain('nav.home');
    expect(orphaned).not.toContain('nav.clients');
  });

  it("lets a literal naming a namespace reach everything under it (const T = 'offer.hero')", () => {
    expect(problems("const T = 'offer.hero'; t(`${T}.title`)").orphaned).not.toContain('offer.hero.title');
  });

  it('counts property access on a dictionary as a use (ar.offer.hero.title in vite.config.ts)', () => {
    expect(problems('const title = ar.offer.hero.title;').orphaned).not.toContain('offer.hero.title');
  });

  it('formats one line per problem', () => {
    expect(formatProblems({ missing: [{ key: 'a.b', file: 'f.tsx' }], orphaned: ['c.d'] })).toEqual([
      'missing: a.b (f.tsx)',
      'orphaned: c.d',
    ]);
  });
});

describe('the app (MUT-24)', () => {
  const root = join(__dirname, '../..');

  it('asks for no key the dictionary lacks, and keeps no key nothing uses', () => {
    const report = formatProblems(findKeyProblems(loadDictionary(root), scanSources(collectSources(root))));
    expect(report, 'run `npm run i18n:check` for the full report').toEqual([]);
  });
});
