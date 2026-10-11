import { useMemo } from 'react';
import { getLocale, useLanguage, type TranslationVars, type Translator } from './core';
import type { Language } from './types';

/**
 * Plurals without an ICU parser (ADR-019; hosted-portal.md §7.7). A plural
 * string is an object of CLDR forms — `key.zero|one|two|few|many|other` — and
 * `tp(key, count)` picks the form `Intl.PluralRules` names for the language.
 * Arabic uses all six; English uses `one` and `other`. A missing form falls back
 * to `other`. `{count}` is always available to the string.
 */

export type PluralTranslate = (key: string, count: number, vars?: TranslationVars) => string;

const rules = new Map<Language, Intl.PluralRules>();

export function pluralKey(language: Language, count: number): Intl.LDMLPluralRule {
  let rule = rules.get(language);
  if (!rule) {
    rule = new Intl.PluralRules(getLocale(language));
    rules.set(language, rule);
  }
  return rule.select(count);
}

export function createPluralTranslator(t: Translator, language: Language): PluralTranslate {
  return (key, count, vars) => {
    const form = `${key}.${pluralKey(language, count)}`;
    return t(t.has(form) ? form : `${key}.other`, { ...vars, count });
  };
}

/** `tp(key, count, vars)` for the current language. */
export function useTp(): PluralTranslate {
  const { t, language } = useLanguage();
  return useMemo(() => {
    const translator = t as Partial<Translator> & ((key: string, vars?: TranslationVars) => string);
    const withHas: Translator = Object.assign((key: string, vars?: TranslationVars) => translator(key, vars), {
      has: translator.has ?? (() => true),
    });
    return createPluralTranslator(withHas, language);
  }, [t, language]);
}
