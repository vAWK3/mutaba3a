/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { DEFAULT_LANGUAGE, I18nProvider, type Dictionary } from '../../lib/i18n/core';
import { setRequestLanguage } from '../api/client';
import type { Language } from '../../lib/i18n/types';
import en from './en.json';
import ar from './ar.json';

/**
 * The portal's language (mut-43-auth-states.md E4). It persists only an explicit
 * choice, so "this browser has a stored choice" means the person picked one here;
 * otherwise the account's locale applies after sign-in, and is remembered as a hint
 * for the next boot; with neither, Arabic (MUT-209). The language (choice and hint)
 * is the one thing the portal stores (hosted-portal.md §7.1).
 */

export const PORTAL_LANGUAGE_KEY = 'mutaba3a-portal-language';
/**
 * The last signed-in account's locale (MUT-209): a hint, never a choice. The
 * portal boots in it, so an English account doesn't open in Arabic and flip
 * once `/v1/me` answers; a choice made in this browser still beats it.
 */
export const PORTAL_ACCOUNT_LOCALE_KEY = 'mutaba3a-portal-account-locale';

const translations: Record<Language, Dictionary> = { en, ar };

function storedLanguage(key: string): Language | null {
  try {
    const value = localStorage.getItem(key);
    return value === 'en' || value === 'ar' ? value : null;
  } catch {
    return null;
  }
}

const storedChoice = () => storedLanguage(PORTAL_LANGUAGE_KEY);

function persist(key: string, language: Language) {
  try {
    localStorage.setItem(key, language);
  } catch {
    // Private mode or blocked storage: the language still applies for this visit.
  }
}

/**
 * MUT-464: the API learns a language when the portal does, before the render that keys queries on it, so a refetch
 * never goes out in the old one.
 */
function sendsLanguage(language: Language): Language {
  setRequestLanguage(language);
  return language;
}

const AdoptContext = createContext<(locale: Language) => void>(() => {});

export function HostedLanguageProvider({ children, linkedLanguage = null }: { children: ReactNode; linkedLanguage?: Language | null }) {
  // The link's `?lang` (MUT-369 D5: the landing's page language, never stored), else a choice here, else the last
  // account's locale, else Arabic (MUT-209); never the browser's language
  const [language, setLanguageState] = useState<Language>(() =>
    sendsLanguage(linkedLanguage ?? storedChoice() ?? storedLanguage(PORTAL_ACCOUNT_LOCALE_KEY) ?? DEFAULT_LANGUAGE),
  );

  const choose = useCallback((next: Language) => {
    persist(PORTAL_LANGUAGE_KEY, next);
    setLanguageState(sendsLanguage(next));
  }, []);

  const adoptAccountLocale = useCallback((locale: Language) => {
    persist(PORTAL_ACCOUNT_LOCALE_KEY, locale);
    if (storedChoice() === null) setLanguageState(sendsLanguage(locale));
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
