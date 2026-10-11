/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { I18nProvider, detectSystemLanguage, type Dictionary } from '../../lib/i18n/core';
import type { Language } from '../../lib/i18n/types';
import en from './en.json';
import ar from './ar.json';

/**
 * The portal's language (mut-43-auth-states.md E4). Unlike the app, it persists
 * only an explicit choice, so "this browser has a stored choice" means the person
 * picked one here; otherwise the account's locale applies after sign-in. The
 * language is the one thing the portal stores (hosted-portal.md §7.1).
 */

export const PORTAL_LANGUAGE_KEY = 'mutaba3a-portal-language';

const translations: Record<Language, Dictionary> = { en, ar };

function storedChoice(): Language | null {
  try {
    const value = localStorage.getItem(PORTAL_LANGUAGE_KEY);
    return value === 'en' || value === 'ar' ? value : null;
  } catch {
    return null;
  }
}

function persistChoice(language: Language) {
  try {
    localStorage.setItem(PORTAL_LANGUAGE_KEY, language);
  } catch {
    // Private mode or blocked storage: the choice still applies for this visit.
  }
}

const AdoptContext = createContext<(locale: Language) => void>(() => {});

export function HostedLanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => storedChoice() ?? detectSystemLanguage());

  const choose = useCallback((next: Language) => {
    persistChoice(next);
    setLanguageState(next);
  }, []);

  const adoptAccountLocale = useCallback((locale: Language) => {
    if (storedChoice() === null) setLanguageState(locale);
  }, []);

  return (
    <AdoptContext.Provider value={adoptAccountLocale}>
      <I18nProvider translations={translations} language={language} setLanguage={choose}>
        {children}
      </I18nProvider>
    </AdoptContext.Provider>
  );
}

/** Apply the signed-in account's locale unless this browser already has a chosen language. */
export function useAdoptAccountLocale(): (locale: Language) => void {
  return useContext(AdoptContext);
}
