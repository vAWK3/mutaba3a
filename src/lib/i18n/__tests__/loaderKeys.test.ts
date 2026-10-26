import { describe, it, expect } from 'vitest';
import en from '../translations/en';
import ar from '../translations/ar';
import portalEn from '../../../hosted/i18n/en.json';
import portalAr from '../../../hosted/i18n/ar.json';

/**
 * MUT-206: the bloom loader's words, on the website and in the portal (DR13, DR5). The website's loader only
 * names itself; the slow caption is the portal's (the local app that also showed it is retired, MUT-445).
 */

function lookup(dict: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], dict);
}

describe('loader i18n keys (MUT-206)', () => {
  it.each([
    ['website en', en, 'Loading'],
    ['website ar', ar, 'جارٍ التحميل'],
  ])('%s: one label with no dots', (_name, dict, label) => {
    expect(lookup(dict, 'common.loaderLabel')).toBe(label);
  });

  it.each([
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
});
