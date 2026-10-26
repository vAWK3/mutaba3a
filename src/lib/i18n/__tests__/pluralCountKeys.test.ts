import { describe, it, expect } from 'vitest';
import en from '../translations/en';
import ar from '../translations/ar';
import { createTranslator } from '../core';
import { createPluralTranslator } from '../plural';

// MUT-179: every counted string is a CLDR plural object read through tp()

/** Counted strings and the named placeholders (besides {count}) each must keep. */
const PLURALS: Record<string, readonly string[]> = {
  // The landing's mocks (MUT-179); the local app's counted strings were retired with it (MUT-445)
  'transactions.status.overdue': [],
  'transactions.status.dueIn': [],
  'clients.index.oldestOverdue': [],
};

/** Hand-rolled singular/plural keys that tp() replaces. */
const RETIRED = [
  'settings.importBackupDoneSingular',
  'settings.importBackupDonePlural',
  'orphanedRecords.assignedSingular',
  'orphanedRecords.assignedPlural',
  'orphanedRecords.partialFailureSingular',
  'orphanedRecords.partialFailurePlural',
  'integrity.orphanedRecordSingular',
  'integrity.orphanedRecordPlural',
  'integrity.checkIssuesSingular',
  'integrity.checkIssuesPlural',
  'integrity.toastIssuesSingular',
  'integrity.toastIssuesPlural',
  'clients.summary.clientsCountOne',
  'projects.summary.projectsCountOne',
];

const EN_FORMS = ['one', 'other'] as const;
const AR_FORMS = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;
/** Forms that may name the number in words ("يوم واحد", "يومان") instead of showing it. */
const WORDED_FORMS = ['zero', 'one', 'two'];

function lookup(dict: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], dict);
}

const tpEn = createPluralTranslator(createTranslator(en, 'en'), 'en');
const tpAr = createPluralTranslator(createTranslator(ar, 'ar'), 'ar');

describe('Counted strings (MUT-179)', () => {
  it.each([
    ['en', en, EN_FORMS],
    ['ar', ar, AR_FORMS],
  ] as const)('%s has every plural form of every counted string', (_locale, dict, forms) => {
    for (const [key, placeholders] of Object.entries(PLURALS)) {
      const value = lookup(dict, key) as Record<string, string> | undefined;
      expect(value, key).toBeTypeOf('object');
      for (const form of forms) {
        const text = value?.[form];
        expect(typeof text, `${key}.${form}`).toBe('string');
        expect(String(text).trim().length, `${key}.${form}`).toBeGreaterThan(0);
        for (const placeholder of placeholders) expect(text, `${key}.${form}`).toContain(placeholder);
        if (!WORDED_FORMS.includes(form)) expect(text, `${key}.${form}`).toContain('{count}');
      }
    }
  });

  it.each([
    ['en', en],
    ['ar', ar],
  ])('%s no longer has the hand-rolled singular/plural keys', (_locale, dict) => {
    for (const key of RETIRED) expect(lookup(dict, key), key).toBeUndefined();
  });

  it('reads English counts in the singular at 1', () => {
    expect(tpEn('transactions.status.dueIn', 1)).toBe('Due in 1d');
    expect(tpEn('transactions.status.dueIn', 2)).toBe('Due in 2d');
    expect(tpEn('transactions.status.overdue', 1)).toBe('1d overdue');
  });

  it('reads Arabic day counts in the few and many forms', () => {
    expect(tpAr('transactions.status.overdue', 3)).toBe('متأخر 3 أيام');
    expect(tpAr('transactions.status.overdue', 11)).toBe('متأخر 11 يومًا');
    expect(tpAr('transactions.status.dueIn', 3)).toBe('مستحق خلال 3 أيام');
    expect(tpAr('clients.index.oldestOverdue', 227)).toBe('الأقدم 227 يومًا');
    expect(tpAr('clients.index.oldestOverdue', 3)).toBe('الأقدم 3 أيام');
  });

  it('names one and two days in words in Arabic', () => {
    expect(tpAr('transactions.status.dueIn', 1)).not.toMatch(/\d/);
    expect(tpAr('transactions.status.overdue', 2)).not.toMatch(/\d/);
  });
});
