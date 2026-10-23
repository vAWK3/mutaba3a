// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoPath } from '../../../test/css/brandCss';

/**
 * The product's name in copy (MUT-400, MUT-402 D5): English always writes MTB3A,
 * Arabic always متابعة. Identifiers, URLs and storage keys are not copy and stay
 * as they are. The current privacy policy is the one legal exemption until its
 * next real revision (D4); the dated terms live in src/content/legal, outside
 * these files.
 */

/** The privacy policy keeps "Mutaba3a" until its next version (Basel, MUT-400). */
const LEGAL_EXEMPT = /^landing\.privacyPolicy\./;

type Leaf = { file: string; key: string; value: string };

function leaves(file: string, node: unknown = JSON.parse(readFileSync(file, 'utf8')), path: string[] = []): Leaf[] {
  if (typeof node === 'string') return [{ file: file.slice(repoPath('').length), key: path.join('.'), value: node }];
  if (node && typeof node === 'object') return Object.entries(node).flatMap(([key, child]) => leaves(file, child, [...path, key]));
  return [];
}

function translationFiles(language: 'en' | 'ar'): string[] {
  const dir = repoPath(`src/lib/i18n/translations/${language}`);
  return [...readdirSync(dir).filter((name) => name.endsWith('.json')).map((name) => join(dir, name)), repoPath(`src/hosted/i18n/${language}.json`)];
}

/** Copy leaves that name the product other than as `language` writes it. */
export function offendingLeaves(entries: Leaf[], language: 'en' | 'ar'): string[] {
  const wrong = language === 'en' ? /Mutaba3a/ : /Mutaba3a|MTB3A/;
  return entries.filter(({ key, value }) => wrong.test(value) && !LEGAL_EXEMPT.test(key)).map(({ file, key }) => `${file} ${key}`);
}

function htmlTitle(file: string): string | undefined {
  return /<title>([^<]*)<\/title>/.exec(readFileSync(repoPath(file), 'utf8'))?.[1];
}

describe('the product name in copy', () => {
  it.each(['en', 'ar'] as const)('no %s translation names the product the other way', (language) => {
    const entries = translationFiles(language).flatMap((file) => leaves(file));
    expect(entries.length).toBeGreaterThan(100);
    expect(offendingLeaves(entries, language)).toEqual([]);
  });

  it('catches an English "Mutaba3a", lets the privacy policy keep it, and catches Latin in Arabic', () => {
    const leaf = (key: string, value: string): Leaf => ({ file: 'x.json', key, value });
    expect(offendingLeaves([leaf('landing.hero.title', 'Welcome to Mutaba3a')], 'en')).toEqual(['x.json landing.hero.title']);
    expect(offendingLeaves([leaf('landing.privacyPolicy.intro', 'Mutaba3a collects')], 'en')).toEqual([]);
    expect(offendingLeaves([leaf('landing.hero.title', 'MTB3A')], 'en')).toEqual([]);
    expect(offendingLeaves([leaf('shell.welcome', 'مرحبًا في MTB3A')], 'ar')).toEqual(['x.json shell.welcome']);
  });

  it.each(['index.html', 'hosted.html'])('%s opens with the Arabic title, the language both surfaces open in (ADR-077)', (file) => {
    expect(htmlTitle(file)).toBe('متابعة');
  });

  it('the OAuth client document names the product MTB3A on Malafat’s consent screen (D8)', () => {
    const client = JSON.parse(readFileSync(repoPath('public/.well-known/oauth-client.json'), 'utf8')) as { client_name: string };
    expect(client.client_name).toBe('MTB3A');
  });
});
