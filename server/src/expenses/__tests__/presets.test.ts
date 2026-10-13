import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GENERAL_PRESET, LAW_FIRM_PRESET, PERSONAL_PRESET, presetFor } from '../presets.js';

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

  it('picks law-firm for a Malafat-fed profile, personal for a personal profile and general for any other firm, in the user’s language', () => {
    expect(presetFor({ writerOfRecord: 'MALAFAT', personal: false }, 'ar')).toEqual({ preset: 'lawFirm', categories: LAW_FIRM_PRESET.map((c) => ({ name: c.nameAr, color: c.color })) });
    expect(presetFor({ writerOfRecord: null, personal: true }, 'en')).toEqual({ preset: 'personal', categories: PERSONAL_PRESET.map((c) => ({ name: c.name, color: c.color })) });
    expect(presetFor({ writerOfRecord: null, personal: true }, 'ar')).toEqual({ preset: 'personal', categories: PERSONAL_PRESET.map((c) => ({ name: c.nameAr, color: c.color })) });
    expect(presetFor({ writerOfRecord: null, personal: false }, 'en')).toEqual({ preset: 'general', categories: GENERAL_PRESET.map((c) => ({ name: c.name, color: c.color })) });
  });

  /**
   * MAL-1118: the personal preset is server-only — a person's own profile
   * (MUT-120) has no offline counterpart — so instead of a parity check these
   * invariants guard it. Names must also be distinct in any letter case: a
   * profile's category names are unique that way, so a collision would fail
   * the seed on every new personal profile's first list.
   */
  it('seeds the ten personal categories in order, Other last, translated, with no name colliding in either language', () => {
    expect(PERSONAL_PRESET.map((c) => c.name)).toEqual(['Transportation', 'Car', 'Rent', 'Groceries', 'Supplies', 'Gifts', 'Investments', 'Projects', 'Leisure', 'Other']);
    expect(PERSONAL_PRESET.at(-1)).toMatchObject({ name: 'Other', nameAr: 'أخرى' });
    for (const c of PERSONAL_PRESET) {
      expect(c.nameAr.trim()).not.toBe('');
      expect(c.color).toMatch(/^#[0-9a-f]{6}$/);
    }
    for (const key of ['name', 'nameAr'] as const) {
      expect(new Set(PERSONAL_PRESET.map((c) => c[key].toLocaleLowerCase())).size).toBe(PERSONAL_PRESET.length);
    }
  });
});
