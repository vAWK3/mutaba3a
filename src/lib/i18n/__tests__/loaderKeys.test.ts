import { describe, it, expect } from 'vitest';
import en from '../translations/en';
import ar from '../translations/ar';
import portalEn from '../../../hosted/i18n/en.json';
import portalAr from '../../../hosted/i18n/ar.json';

/**
 * MUT-206: the bloom loader's words, in the app and the portal (DR13, DR5),
 * and the Import page's copy (R4) in both languages with the same {vars}.
 */

function lookup(dict: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], dict);
}

const vars = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

/** Every string leaf under a key, as dotted paths. */
function leaves(node: unknown, path: string): string[] {
  if (typeof node === 'string') return [path];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, child]) => leaves(child, `${path}.${key}`));
}

describe('loader i18n keys (MUT-206)', () => {
  it.each([
    ['app en', en, 'Loading', 'Still loading…'],
    ['app ar', ar, 'جارٍ التحميل', 'ما زلنا نحمّل…'],
    ['portal en', portalEn, 'Loading', 'Still loading…'],
    ['portal ar', portalAr, 'جارٍ التحميل', 'ما زلنا نحمّل…'],
  ])('%s: one label with no dots, and the slow caption', (_name, dict, label, slow) => {
    expect(lookup(dict, 'common.loaderLabel')).toBe(label);
    expect(lookup(dict, 'common.loadingSlow')).toBe(slow);
  });

  it('the portal boot screen says it is still connecting (MUT-207 DR5)', () => {
    expect(lookup(portalEn, 'hosted.auth.connectingSlow')).toBe('Still connecting…');
    expect(lookup(portalAr, 'hosted.auth.connectingSlow')).toBe('ما زلنا نتصل…');
  });

  it('keeps the "Loading..." drawer title as it was', () => {
    expect(lookup(en, 'common.loading')).toBe('Loading...');
  });
});

describe('Import page copy (MUT-206 R4)', () => {
  const enKeys = leaves(lookup(en, 'settings.import'), 'settings.import').filter((key) => !/\.importRows\./.test(key));

  it('has every English string in Arabic, with the same {vars}, and Arabic is Arabic', () => {
    const problems: string[] = [];
    for (const key of enKeys) {
      const arabic = lookup(ar, key);
      if (typeof arabic !== 'string' || !arabic.trim()) problems.push(`${key}: missing in ar`);
      else if (vars(arabic).join() !== vars(lookup(en, key) as string).join()) problems.push(`${key}: vars differ`);
      else if (!/[؀-ۿ]/.test(arabic)) problems.push(`${key}: not Arabic`);
    }
    expect(problems).toEqual([]);
  });

  it('pluralises the row count: en one/other, ar all six forms', () => {
    expect(Object.keys(lookup(en, 'settings.import.actions.importRows') as object).sort()).toEqual(['one', 'other']);
    expect(Object.keys(lookup(ar, 'settings.import.actions.importRows') as object).sort()).toEqual(['few', 'many', 'one', 'other', 'two', 'zero']);
  });
});
