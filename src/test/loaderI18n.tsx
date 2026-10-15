import type { ReactNode } from 'react';
import { I18nProvider } from '../lib/i18n/core';
import type { Language } from '../lib/i18n/types';
import en from '../lib/i18n/translations/en.json';
import ar from '../lib/i18n/translations/ar.json';

const translations = { en, ar };
const noop = () => {};

/**
 * The real i18n core around a page, for tests that mock the app's `lib/i18n`
 * module: BrandLoader reads its label from the core's provider (MUT-206), which
 * that mock does not replace. Without it the loader renders with no label.
 */
export function LoaderI18n({ children, language = 'en' }: { children: ReactNode; language?: Language }) {
  return (
    <I18nProvider translations={translations} language={language} setLanguage={noop}>
      {children}
    </I18nProvider>
  );
}
