import { describe, expect, it } from 'vitest';
import { categoryNameKey } from '../names.js';
import { displayCategoryNames, GENERAL_PRESET, LAW_FIRM_PRESET, PERSONAL_PRESET, presetFor, presetKeyForName, presetNameKeys, RETIRED_TEMPLATES } from '../presets.js';

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

/**
 * MUT-464: nothing stores which preset entry a category came from. The key is worked out from the stored name, in
 * either language, so the list can show it in the viewer's language. Every string a profile was ever seeded with must
 * keep resolving: an edited template string moves its old wording to RETIRED_TEMPLATES.
 */
describe('preset keys (MUT-464)', () => {
  const LIVE = [...GENERAL_PRESET, ...LAW_FIRM_PRESET, ...PERSONAL_PRESET];

  it('gives one concept one key in every preset, and one key one pair of names', () => {
    const pairs = new Map<string, string>();
    for (const t of [...LIVE, ...RETIRED_TEMPLATES]) {
      expect(t.key).toMatch(/^[a-z][a-z0-9_]*$/);
      const pair = `${t.name}|${t.nameAr}`;
      if (!LIVE.includes(t) && LIVE.some((l) => l.key === t.key)) continue; // a retired wording of a live entry
      expect(pairs.get(t.key) ?? pair).toBe(pair);
      pairs.set(t.key, pair);
    }
    expect(GENERAL_PRESET.at(-1)!.key).toBe('other');
    expect(PERSONAL_PRESET.at(-1)!.key).toBe('other');
    expect(PERSONAL_PRESET.find((t) => t.name === 'Rent')!.key).not.toBe(GENERAL_PRESET.find((t) => t.name === 'Office Rent')!.key);
  });

  it('never lets one name mean two keys', () => {
    const seen = new Map<string, string>();
    for (const t of [...LIVE, ...RETIRED_TEMPLATES]) {
      for (const name of [t.name, t.nameAr]) {
        const k = categoryNameKey(name);
        expect(seen.get(k) ?? t.key).toBe(t.key);
        seen.set(k, t.key);
      }
    }
  });

  it('finds the key from either language, in any case and spacing', () => {
    expect(presetKeyForName('Office Rent')).toBe('office_rent');
    expect(presetKeyForName('  office rent ')).toBe('office_rent');
    expect(presetKeyForName('إيجار المكتب')).toBe('office_rent');
    expect(presetKeyForName('Other')).toBe('other');
    expect(presetKeyForName('أخرى')).toBe('other');
    expect(presetKeyForName('Coffee')).toBeNull();
  });

  it('lists every stored name key of an entry, both languages', () => {
    expect(presetNameKeys('office_rent').sort()).toEqual(['office rent', 'إيجار المكتب'].sort());
    expect(presetNameKeys('nope')).toEqual([]);
  });

  it('recognises the names Malafat firms and personal profiles were seeded with before the lists changed', () => {
    for (const name of ['Legal Research Tools', 'Case Management Software', 'Bar Association Fees', 'Continuing Legal Education', 'Court Filing Fees', 'Process Service', 'Expert Witnesses', 'Document Management', 'Client Entertainment', 'Travel Expenses', 'Projects']) {
      expect(presetKeyForName(name), name).not.toBeNull();
    }
    expect(presetKeyForName('المشاريع')).toBe(presetKeyForName('Projects'));
    expect(presetKeyForName('رسوم نقابة المحامين')).toBe(presetKeyForName('Bar Association Fees'));
  });

  it('never seeds a retired name', () => {
    const seeded = new Set(LIVE.map((t) => t.name));
    for (const t of RETIRED_TEMPLATES) if (!LIVE.some((l) => l.key === t.key)) expect(seeded.has(t.name)).toBe(false);
  });

  const row = (id: string, name: string, minute: number) => ({ id, name, createdAt: new Date(Date.UTC(2026, 9, 27, 9, minute)) });

  it('shows seeded names in the viewer language and typed names as typed', () => {
    const rows = [row('a', 'إيجار المكتب', 0), row('b', 'أخرى', 1), row('c', 'Coffee', 2)];
    expect(displayCategoryNames(rows, 'en')).toEqual([
      { ...rows[0], name: 'Office Rent', presetKey: 'office_rent' },
      { ...rows[1], name: 'Other', presetKey: 'other' },
      { ...rows[2], name: 'Coffee', presetKey: null },
    ]);
    expect(displayCategoryNames(rows, 'ar').map((r) => r.name)).toEqual(['إيجار المكتب', 'أخرى', 'Coffee']);
  });

  it('shows a retired name in the viewer language too', () => {
    expect(displayCategoryNames([row('a', 'المشاريع', 0)], 'en')[0]!.name).toBe('Projects');
  });

  it('translates only the oldest of two rows with the same key; the other keeps its own name', () => {
    const rows = [row('late', 'Other', 5), row('early', 'أخرى', 1)];
    const shown = displayCategoryNames(rows, 'en');
    expect(shown.map((r) => [r.id, r.name, r.presetKey])).toEqual([
      ['late', 'Other', null],
      ['early', 'Other', 'other'],
    ]);
    expect(displayCategoryNames(rows, 'ar').map((r) => r.name)).toEqual(['Other', 'أخرى']);
  });
});
