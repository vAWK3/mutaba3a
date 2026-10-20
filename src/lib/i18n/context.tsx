/* eslint-disable react-refresh/only-export-components */
import { useEffect, useState, useCallback, useMemo, type ReactNode } from 'react';
import type { Language } from './types';
import { I18nProvider, createTranslator, detectSystemLanguage, useT, type Dictionary, type TranslationVars } from './core';
import enTranslations from './translations/en';
import arTranslations from './translations/ar';

export { useLanguage, useT, useDirection, getLocale, DEFAULT_LANGUAGE } from './core';

const translations: Record<Language, Dictionary> = {
  en: enTranslations,
  ar: arTranslations,
};

/** The language last used, shared by the landing and the app; written only when a person chooses (MUT-209). */
export const LANGUAGE_STORAGE_KEY = 'mutaba3a-language';
/**
 * Set only when a person picks a language (the switch, Settings), never by detection (MUT-202). A surface
 * with its own default trusts the stored language only alongside this mark: before it existed, the
 * landing and the app stored whatever they detected, so a stored value alone is not a choice.
 */
export const LANGUAGE_CHOSEN_KEY = 'mutaba3a-language-chosen';

/** Storage can throw (blocked cookies, some private modes); the language must still render. */
function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The choice holds for this visit only
  }
}

interface InitialLanguage {
  language: Language;
  /** Whether the language is stored on mount: always without a default (the app), only a real choice with one. */
  chosen: boolean;
}

function initialLanguage(defaultLanguage: Language | undefined): InitialLanguage {
  if (typeof window === 'undefined') return { language: defaultLanguage ?? 'en', chosen: false };
  const value = readStorage(LANGUAGE_STORAGE_KEY);
  const stored = value === 'en' || value === 'ar' ? value : null;
  if (defaultLanguage === undefined) return { language: stored ?? detectSystemLanguage(), chosen: true };
  const madeByAPerson = stored !== null && readStorage(LANGUAGE_CHOSEN_KEY) !== null;
  return madeByAPerson ? { language: stored, chosen: true } : { language: defaultLanguage, chosen: false };
}

// Provider Props
interface LanguageProviderProps {
  children: ReactNode;
  /**
   * The language to open in unless a person chose one, instead of the
   * system's (MUT-202: the marketing site opens in Arabic). It is a default,
   * not a preference: nothing is stored until someone chooses, so it never
   * changes the language of another surface that shares the key (the web
   * app), and a language some surface stored by detection does not beat it.
   */
  defaultLanguage?: Language;
}

/**
 * LanguageProvider - Provides language context to the entire app
 *
 * Features:
 * - Opens in `defaultLanguage` (every surface passes Arabic since MUT-209); without one, the system language
 * - Persists language choice to localStorage (a defaultLanguage only once someone chooses)
 * - Updates <html> lang and dir attributes (via I18nProvider)
 * - Provides t() function for translations with interpolation
 */
export function LanguageProvider({ children, defaultLanguage }: LanguageProviderProps) {
  const [initial] = useState(() => initialLanguage(defaultLanguage));
  const [language, setLanguageState] = useState<Language>(initial.language);
  const [chosen, setChosen] = useState(initial.chosen);

  useEffect(() => {
    if (chosen) writeStorage(LANGUAGE_STORAGE_KEY, language);
  }, [language, chosen]);

  const setLanguage = useCallback((lang: Language) => {
    writeStorage(LANGUAGE_CHOSEN_KEY, '1');
    setChosen(true);
    setLanguageState(lang);
  }, []);

  return (
    <I18nProvider translations={translations} language={language} setLanguage={setLanguage}>
      {children}
    </I18nProvider>
  );
}

/**
 * `t` for a text that names its own language (a /terms or /privacy `?lang` link, MUT-356):
 * that language's strings, or the page's `t` when it names none. Reads the dictionaries
 * only, so the page's language and the stored choice stay as they are.
 */
export function useTIn(language: Language | null): (key: string, vars?: TranslationVars) => string {
  const pageT = useT();
  const linkedT = useMemo(() => (language ? createTranslator(translations[language], language) : null), [language]);
  return linkedT ?? pageT;
}
