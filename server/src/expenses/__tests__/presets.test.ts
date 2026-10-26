import { describe, expect, it } from 'vitest';
import { categoryNameKey } from '../names.js';
import { GENERAL_PRESET, LAW_FIRM_PRESET, PERSONAL_PRESET, presetFor } from '../presets.js';

/**
 * MUT-42 D2 checked these presets against the offline app's copy. MUT-445 (ADR-203) retired that app and its
 * `src/db/defaultExpenseCategories.ts`, so the server's lists are now the only copy and the drift case is gone.
 */
describe('expense category presets', () => {
  it('gives a Malafat firm the general business list, then legal and accounting costs, Other last', () => {
    const general = GENERAL_PRESET.slice(0, -1);
    expect(LAW_FIRM_PRESET.slice(0, general.length)).toEqual(general);
    expect(LAW_FIRM_PRESET.slice(general.length, -1).map((c) => c.name)).toEqual(['Court & Filing Fees', 'Notary & Service Fees', 'Experts & Translation', 'Professional Association Fees', 'Professional Liability Insurance', 'Continuing Professional Education']);
    expect(LAW_FIRM_PRESET.at(-1)).toEqual(GENERAL_PRESET.at(-1));
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
