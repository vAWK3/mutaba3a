import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GENERAL_PRESET, LAW_FIRM_PRESET, presetFor } from '../presets.js';

/**
 * MUT-42 D2: the hosted seed mirrors the offline app's presets. The server is a
 * separate package, so the lists are copied; this test reads the offline source
 * and fails if the two drift.
 */
const OFFLINE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../src/db/defaultExpenseCategories.ts');

function offlinePreset(constName: string): Array<{ name: string; nameAr: string; color: string }> {
  const text = readFileSync(OFFLINE, 'utf8');
  const block = text.split(`export const ${constName}`)[1]?.split('];')[0];
  if (!block) throw new Error(`${constName} not found in ${OFFLINE}`);
  return [...block.matchAll(/\{\s*name:\s*'([^']*)',\s*nameAr:\s*'([^']*)',\s*color:\s*'([^']*)'\s*\}/g)].map((m) => ({ name: m[1]!, nameAr: m[2]!, color: m[3]! }));
}

describe('expense category presets', () => {
  it('match the offline general and law-firm presets exactly, in order', () => {
    expect(GENERAL_PRESET).toEqual(offlinePreset('GENERAL_CATEGORIES'));
    expect(LAW_FIRM_PRESET).toEqual(offlinePreset('LAW_FIRM_CATEGORIES'));
    expect(LAW_FIRM_PRESET.length).toBeGreaterThan(10);
  });

  it('picks the law-firm preset for a Malafat-fed profile and the general one otherwise, in the user’s language', () => {
    expect(presetFor('MALAFAT', 'ar')).toEqual({ preset: 'lawFirm', categories: LAW_FIRM_PRESET.map((c) => ({ name: c.nameAr, color: c.color })) });
    expect(presetFor(null, 'en')).toEqual({ preset: 'general', categories: GENERAL_PRESET.map((c) => ({ name: c.name, color: c.color })) });
  });
});
