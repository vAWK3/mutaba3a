import type { ReactNode } from 'react';
import { LanguageProvider, type Language } from '../../lib/i18n';
import { ThemeProvider } from '../../lib/theme';

/**
 * The marketing site opens in Arabic whatever the system language (MUT-202,
 * ADR-077). It is a default, not a stored preference: the web app shares the
 * language key, and a visit here must not switch the app's language.
 */
export const LANDING_DEFAULT_LANGUAGE: Language = 'ar';

/**
 * Everything the web build's marketing pages (`/`, `/download`, `/privacy`,
 * `/hosted`) get from `src/main.tsx`: theme and language (Arabic unless the
 * visitor chose otherwise), nothing of the app's. They mount outside the
 * router and `QueryClientProvider`, and never open the database, so nothing
 * they render may use React Query, router hooks or the repositories (the
 * app's `TopBar` uses all three). Tests render these pages through this
 * wrapper, so they see exactly what production sees.
 */
export function LandingProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <LanguageProvider defaultLanguage={LANDING_DEFAULT_LANGUAGE}>{children}</LanguageProvider>
    </ThemeProvider>
  );
}
