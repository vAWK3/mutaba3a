import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { categoryNameKey } from '../names.js';
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

  it('picks law-firm for a Malafat-fed profile, personal for a PERSONAL profile and general for a BUSINESS one or any firm, in the user’s language', () => {
    expect(presetFor({ writerOfRecord: 'MALAFAT', profileType: null }, 'ar')).toEqual({ preset: 'lawFirm', categories: LAW_FIRM_PRESET.map((c) => ({ name: c.nameAr, color: c.color })) });
    expect(presetFor({ writerOfRecord: null, profileType: 'PERSONAL' }, 'en')).toEqual({ preset: 'personal', categories: PERSONAL_PRESET.map((c) => ({ name: c.name, color: c.color })) });
    expect(presetFor({ writerOfRecord: null, profileType: 'PERSONAL' }, 'ar')).toEqual({ preset: 'personal', categories: PERSONAL_PRESET.map((c) => ({ name: c.nameAr, color: c.color })) });
    // MUT-182: a BUSINESS profile a person owns gets the general preset, exactly as an operator firm does.
    expect(presetFor({ writerOfRecord: null, profileType: 'BUSINESS' }, 'en')).toEqual({ preset: 'general', categories: GENERAL_PRESET.map((c) => ({ name: c.name, color: c.color })) });
    expect(presetFor({ writerOfRecord: null, profileType: null }, 'en')).toEqual({ preset: 'general', categories: GENERAL_PRESET.map((c) => ({ name: c.name, color: c.color })) });
    // ADR-066: Malafat as writer of record wins, even over a PERSONAL type.
    expect(presetFor({ writerOfRecord: 'MALAFAT', profileType: 'PERSONAL' }, 'en').preset).toBe('lawFirm');
  });

  /**
   * MAL-1118: the personal preset is server-only — a person's own profile
   * (MUT-120) has no offline counterpart — so instead of a parity check these
   * invariants guard it. MAL-1137 replaced "Projects" (read as a freelance
   * ledger item) with Shopping, Communications & Internet and Health & Insurance.
   */
  it('seeds the personal categories in order, Other last, translated', () => {
    expect(PERSONAL_PRESET.map((c) => c.name)).toEqual(['Groceries', 'Transportation', 'Car', 'Rent', 'Shopping', 'Communications & Internet', 'Health & Insurance', 'Investments', 'Leisure', 'Gifts', 'Supplies', 'Other']);
    expect(PERSONAL_PRESET.at(-1)).toMatchObject({ name: 'Other', nameAr: 'أخرى' });
    for (const c of PERSONAL_PRESET) {
      expect(c.nameAr.trim()).not.toBe('');
      expect(c.color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  /**
   * A profile's category names are unique by `categoryNameKey`, and the
   * Postgres seed inserts with `skipDuplicates`, so two preset names sharing a
   * key would silently seed one category short — no error, and the memory
   * store would not notice. Check every preset with the production key.
   */
  it('gives every preset name its own name key in both languages', () => {
    for (const preset of [PERSONAL_PRESET, GENERAL_PRESET, LAW_FIRM_PRESET]) {
      for (const key of ['name', 'nameAr'] as const) {
        expect(new Set(preset.map((c) => categoryNameKey(c[key]))).size).toBe(preset.length);
      }
    }
  });
});
