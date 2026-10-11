/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import type { Language, Direction, LanguageContextValue } from './types';

/**
 * The i18n machinery without any translation files (MUT-43). The app's
 * `LanguageProvider` (context.tsx) and the hosted portal's provider both render
 * `I18nProvider` with their own dictionaries, so shared components that call
 * `useT()` work in both, and the portal bundle never carries the app's strings.
 */

export type TranslationVars = Record<string, string | number>;
export type Dictionary = Record<string, unknown>;

/** A translate function that can also say whether a key exists (used by `tp`). */
export interface Translator {
  (key: string, vars?: TranslationVars): string;
  has(key: string): boolean;
}

function lookup(dict: Dictionary, key: string): unknown {
  let value: unknown = dict;
  for (const part of key.split('.')) {
    if (value && typeof value === 'object' && part in value) {
      value = (value as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return value;
}

function interpolate(template: string, vars?: TranslationVars): string {
  if (!vars) return template;
  return Object.entries(vars).reduce(
    (str, [name, value]) => str.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value)),
    template,
  );
}

/** Nested-key lookup with `{var}` interpolation; a missing or non-string key returns the key itself, with a warning. */
export function createTranslator(dict: Dictionary, language: Language): Translator {
  const translate = (key: string, vars?: TranslationVars): string => {
    const value = lookup(dict, key);
    if (value === undefined) {
      console.warn(`Translation missing: ${key} (${language})`);
      return key;
    }
    if (typeof value !== 'string') {
      console.warn(`Translation not a string: ${key} (${language})`);
      return key;
    }
    return interpolate(value, vars);
  };
  return Object.assign(translate, { has: (key: string) => typeof lookup(dict, key) === 'string' });
}

export function getDirection(lang: Language): Direction {
  return lang === 'ar' ? 'rtl' : 'ltr';
}

/** The locale string for Intl APIs. */
export function getLocale(lang: Language): string {
  return lang === 'ar' ? 'ar' : 'en-US';
}

/** Browser language, reduced to the two the app supports. */
export function detectSystemLanguage(): Language {
  const browserLang = navigator.language.split('-')[0].toLowerCase();
  return browserLang === 'ar' ? 'ar' : 'en';
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

interface I18nProviderProps {
  translations: Record<Language, Dictionary>;
  language: Language;
  setLanguage: (lang: Language) => void;
  children: ReactNode;
}

/**
 * Controlled provider: the owner keeps the language state and decides what to
 * persist; this provides `t`, the direction, and keeps `<html lang dir>` in step.
 */
export function I18nProvider({ translations, language, setLanguage, children }: I18nProviderProps) {
  const direction = getDirection(language);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = direction;
  }, [language, direction]);

  const value = useMemo<LanguageContextValue>(
    () => ({ language, direction, setLanguage, t: createTranslator(translations[language], language) }),
    [translations, language, direction, setLanguage],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/** The full language context: `{ language, direction, setLanguage, t }`. */
export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}

/** Just the translation function. */
export function useT(): (key: string, vars?: TranslationVars) => string {
  return useLanguage().t;
}

/** Just the direction. */
export function useDirection(): Direction {
  return useLanguage().direction;
}
