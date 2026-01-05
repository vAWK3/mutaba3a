/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { Language, Direction, LanguageContextValue, Translations } from './types';
import enTranslations from './translations/en.json';
import arTranslations from './translations/ar.json';

const translations: Record<Language, Translations> = {
  en: enTranslations as Translations,
  ar: arTranslations as Translations,
};

const STORAGE_KEY = 'mutaba3a-language';

/**
 * Detect the user's preferred language from browser settings
 */
function detectSystemLanguage(): Language {
  const browserLang = navigator.language.split('-')[0].toLowerCase();
  return browserLang === 'ar' ? 'ar' : 'en';
}

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

/**
 * Get the direction for a language
 */
function getDirection(lang: Language): Direction {
  return lang === 'ar' ? 'rtl' : 'ltr';
}

/**
 * Get the locale string for Intl APIs
 */
export function getLocale(lang: Language): string {
  return lang === 'ar' ? 'ar' : 'en-US';
}

// Context
const LanguageContext = createContext<LanguageContextValue | null>(null);

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
 * - Updates <html> lang and dir attributes
 * - Provides t() function for translations with interpolation
 */
export function LanguageProvider({ children }: LanguageProviderProps) {
  const [language, setLanguageState] = useState<Language>(getInitialLanguage);
  const direction = getDirection(language);

  // Update HTML attributes and localStorage when language changes
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = direction;
    localStorage.setItem(STORAGE_KEY, language);
  }, [language, direction]);

  // Language setter
  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
  }, []);

  // Translation function with interpolation support
  const t = useCallback((key: string, vars?: Record<string, string | number>): string => {
    const keys = key.split('.');
    let value: unknown = translations[language];

    // Navigate through nested keys
    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = (value as Record<string, unknown>)[k];
      } else {
        // Key not found - return key as fallback (helps identify missing translations)
        console.warn(`Translation missing: ${key} (${language})`);
        return key;
      }
    }

    // Ensure result is a string
    if (typeof value !== 'string') {
      console.warn(`Translation not a string: ${key} (${language})`);
      return key;
    }

    // Handle variable interpolation: {varName}
    if (vars) {
      return Object.entries(vars).reduce(
        (str, [varKey, varValue]) => str.replace(new RegExp(`\\{${varKey}\\}`, 'g'), String(varValue)),
        value
      );
    }

    return value;
  }, [language]);

  const contextValue: LanguageContextValue = {
    language,
    direction,
    setLanguage,
    t,
  };

  return (
    <LanguageContext.Provider value={contextValue}>
      {children}
    </LanguageContext.Provider>
  );
}

/**
 * useLanguage - Access the full language context
 *
 * Returns: { language, direction, setLanguage, t }
 */
export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}

/**
 * useT - Convenience hook for just the translation function
 *
 * Usage:
 *   const t = useT();
 *   return <h1>{t('nav.overview')}</h1>
 */
export function useT(): (key: string, vars?: Record<string, string | number>) => string {
  return useLanguage().t;
}

/**
 * useDirection - Convenience hook for just the direction
 *
 * Usage:
 *   const dir = useDirection();
 *   return <div className={dir === 'rtl' ? 'rtl-class' : 'ltr-class'} />
 */
export function useDirection(): Direction {
  return useLanguage().direction;
}
