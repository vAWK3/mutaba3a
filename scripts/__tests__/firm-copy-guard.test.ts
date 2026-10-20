import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Firm books compliance copy guard (brief firm-books.md §14, MUT-299 B10 as
 * amended by O10; first firm strings in MUT-300). Mutaba3a reads e-invoices
 * and keeps a firm's books; it never claims compliance or files anything. So
 * no firm string may say it does. Phrase level, so "approved" stays allowed
 * for the approval states (D7). Later firm tickets add their keys under these
 * prefixes and inherit the check; phone ARB rows come with MUT-306/310.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DICTIONARIES = ['ar', 'en'].map((lang) => ({ lang, path: join(ROOT, `src/hosted/i18n/${lang}.json`) }));

/** Where firm strings live: `hosted.firm.*` and the request in `hosted.profiles.firm.*`. */
const FIRM_PREFIXES = ['hosted.firm', 'hosted.profiles.firm'];

const BANNED = [
  /\bcompliant\b/i,
  /\bcompliance\b/i,
  /\bcertified\b/i,
  /\btax return\b/i,
  /\bVAT return\b/i,
  /\bfiling\b/i,
  /\bZATCA[- ]approved\b/i,
  /متوافق/,
  /معتمد/,
  /إقرار ضريبي/,
  /تقديم الإقرار/,
];

type Tree = { [key: string]: string | Tree };

function stringsUnder(tree: Tree, prefix: string): Array<[string, string]> {
  const node = prefix.split('.').reduce<string | Tree | undefined>((at, part) => (at && typeof at === 'object' ? at[part] : undefined), tree);
  const out: Array<[string, string]> = [];
  const walk = (value: string | Tree, path: string) => {
    if (typeof value === 'string') out.push([path, value]);
    else for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
  };
  if (node !== undefined) walk(node, prefix);
  return out;
}

describe('firm copy guard (firm-books.md §14)', () => {
  for (const { lang, path } of DICTIONARIES) {
    const dictionary = JSON.parse(readFileSync(path, 'utf8')) as Tree;
    const firmStrings = FIRM_PREFIXES.flatMap((prefix) => stringsUnder(dictionary, prefix));

    it(`${lang}: has firm strings to check (the prefixes still match the dictionary)`, () => {
      expect(firmStrings.length).toBeGreaterThan(0);
    });

    it(`${lang}: no firm string claims compliance, certification or filing`, () => {
      const offending = firmStrings.filter(([, text]) => BANNED.some((re) => re.test(text))).map(([key, text]) => `${key}: ${text}`);
      expect(offending).toEqual([]);
    });
  }

  it('catches each banned phrase and lets "approved" through', () => {
    const hits = (text: string) => BANNED.some((re) => re.test(text));
    for (const phrase of ['Fully compliant', 'certified by', 'Ready for your VAT return', 'tax return', 'e-filing', 'ZATCA approved', 'متوافق مع', 'برنامج معتمد', 'إقرار ضريبي', 'تقديم الإقرار']) {
      expect(hits(phrase), phrase).toBe(true);
    }
    expect(hits('Approved by an owner')).toBe(false);
  });
});
