import { describe, it, expect } from 'vitest';
import en from '../../../lib/i18n/translations/en';
import ar from '../../../lib/i18n/translations/ar';
import { CURRENCY_NAME_KEYS, FAQ_CURRENCY_ID, FAQ_ENTRIES, faqFor } from '../landingCopy';

type Tree = { [key: string]: string | Tree };

function leafKeys(tree: Tree, prefix: string): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}${key}`] : leafKeys(value, `${prefix}${key}.`)
  );
}

describe('landing copy', () => {
  it('has the same landing keys in English and Arabic', () => {
    const enKeys = leafKeys((en as unknown as Tree).landing as Tree, 'landing.').sort();
    const arKeys = leafKeys((ar as unknown as Tree).landing as Tree, 'landing.').sort();
    expect(arKeys).toEqual(enKeys);
  });

  it('names every supported currency', () => {
    expect(Object.keys(CURRENCY_NAME_KEYS).sort()).toEqual(['EUR', 'ILS', 'JOD', 'USD']);
  });
});

describe('faqFor', () => {
  const ids = (state: Parameters<typeof faqFor>[0]) => faqFor(state).map((item) => item.id);
  const answer = (state: Parameters<typeof faqFor>[0], id: string) => faqFor(state).find((item) => item.id === id)?.answerKey;

  it('asks about invoicing only while the free Starter plan is on', () => {
    expect(ids({ signupOpen: true, starter: false })).not.toContain('invoices');
    expect(ids({ signupOpen: true, starter: true })).toContain('invoices');
    expect(ids({ signupOpen: true, starter: true })).toHaveLength(FAQ_ENTRIES.length);
  });

  it('answers the free-plan question for closed signup, open signup and Starter', () => {
    expect(answer({ signupOpen: false, starter: false }, 'free')).toBe('landing.faq.free.a');
    expect(answer({ signupOpen: true, starter: false }, 'free')).toBe('landing.faq.free.aOpen');
    expect(answer({ signupOpen: true, starter: true }, 'free')).toBe('landing.faq.free.aStarter');
    expect(answer({ signupOpen: true, starter: true }, 'businesses')).toBe('landing.faq.businesses.aStarter');
    expect(answer({ signupOpen: true, starter: false }, 'businesses')).toBe('landing.faq.businesses.a');
  });

  it.each(['en', 'ar'] as const)('has every question and answer it can show (%s)', (language) => {
    const faq = ((language === 'en' ? en : ar) as unknown as { landing: { faq: Record<string, Record<string, string>> } }).landing.faq;
    for (const entry of FAQ_ENTRIES) {
      const keys = ['q', 'a', ...(entry.open ? ['aOpen'] : []), ...(entry.starter ? ['aStarter'] : [])];
      for (const key of keys) expect(faq[entry.id]?.[key]?.trim(), `${entry.id}.${key}`).toBeTruthy();
    }
    expect(faq[FAQ_CURRENCY_ID].a).toContain('{currencies}');
  });
});
