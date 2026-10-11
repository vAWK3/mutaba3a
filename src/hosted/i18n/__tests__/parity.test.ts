import { describe, it, expect } from 'vitest';
import en from '../en.json';
import ar from '../ar.json';
import appEn from '../../../lib/i18n/translations/en.json';
import appAr from '../../../lib/i18n/translations/ar.json';

/**
 * hosted-portal.md §7.7: the portal's dictionaries have the same shape in both
 * languages, the same `{var}` names per string, and every plural carries the
 * forms its language needs (en: one + other; ar: all six CLDR forms).
 */

type Node = string | { [key: string]: Node };
const PLURAL_FORMS = ['zero', 'one', 'two', 'few', 'many', 'other'];

function isPlural(node: Node): node is Record<string, string> {
  return typeof node === 'object' && 'other' in node && Object.keys(node).every((k) => PLURAL_FORMS.includes(k));
}

function vars(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

function compare(a: Node, b: Node, path: string, problems: string[]) {
  if (isPlural(a) || isPlural(b)) {
    if (!isPlural(a) || !isPlural(b)) return void problems.push(`${path}: plural in one language only`);
    if (!('one' in a && 'other' in a)) problems.push(`${path}: en plural needs one and other`);
    const missing = PLURAL_FORMS.filter((f) => !(f in b));
    if (missing.length) problems.push(`${path}: ar plural missing ${missing.join(', ')}`);
    const named = (forms: Record<string, string>) => [...new Set(Object.values(forms).flatMap(vars))].filter((v) => v !== 'count').sort();
    if (named(a).join() !== named(b).join()) problems.push(`${path}: plural vars differ`);
    return;
  }
  if (typeof a !== typeof b) return void problems.push(`${path}: ${typeof a} vs ${typeof b}`);
  if (typeof a === 'string') {
    if (vars(a).join() !== vars(b as string).join()) problems.push(`${path}: vars ${vars(a)} vs ${vars(b as string)}`);
    if (!(b as string).trim()) problems.push(`${path}: empty in ar`);
    return;
  }
  const bObj = b as Record<string, Node>;
  const keys = new Set([...Object.keys(a), ...Object.keys(bObj)]);
  for (const key of keys) {
    if (!(key in a)) problems.push(`${path}.${key}: only in ar`);
    else if (!(key in bObj)) problems.push(`${path}.${key}: only in en`);
    else compare(a[key], bObj[key], `${path}.${key}`, problems);
  }
}

describe('hosted i18n', () => {
  it('has en/ar parity across the whole portal dictionary', () => {
    const problems: string[] = [];
    compare(en as Node, ar as Node, '', problems);
    expect(problems).toEqual([]);
  });

  it('carries only the app `common` keys its reused components need, with the app’s exact wording', () => {
    for (const [portal, app] of [
      [en.common, appEn.common],
      [ar.common, appAr.common],
    ] as const) {
      for (const [key, value] of Object.entries(portal)) {
        expect(value, `common.${key}`).toBe((app as Record<string, string>)[key]);
      }
    }
  });

  it('has only `common` and `hosted` at the top level', () => {
    expect(Object.keys(en).sort()).toEqual(['common', 'hosted']);
  });
});
