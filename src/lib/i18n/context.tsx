/* eslint-disable react-refresh/only-export-components */
import { useEffect, useState, useCallback, type ReactNode } from 'react';
import type { Language } from './types';
import { I18nProvider, detectSystemLanguage, type Dictionary } from './core';
import enTranslations from './translations/en.json';
import arTranslations from './translations/ar.json';

export { useLanguage, useT, useDirection, getLocale } from './core';

const translations: Record<Language, Dictionary> = {
  en: enTranslations,
  ar: arTranslations,
};

const STORAGE_KEY = 'mutaba3a-language';

/**
 * Get the initial language from localStorage or system preference
 */
function getInitialLanguage(): Language {
  if (typeof window === 'undefined') return 'en';

  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'en' || stored === 'ar') {
    return stored;
  }

  return detectSystemLanguage();
}

// Provider Props
interface LanguageProviderProps {
  children: ReactNode;
}

/**
 * LanguageProvider - Provides language context to the entire app
 *
 * Features:
 * - Auto-detects system language on first visit
 * - Persists language choice to localStorage
 * - Updates <html> lang and dir attributes (via I18nProvider)
 * - Provides t() function for translations with interpolation
 */
export function LanguageProvider({ children }: LanguageProviderProps) {
  const [language, setLanguageState] = useState<Language>(getInitialLanguage);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, language);
  }, [language]);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
  }, []);

  return (
    <I18nProvider translations={translations} language={language} setLanguage={setLanguage}>
      {children}
    </I18nProvider>
  );
}
