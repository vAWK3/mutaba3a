import type { ReactNode } from 'react';
import { LanguageProvider } from '../../lib/i18n';
import { ThemeProvider } from '../../lib/theme';

/**
 * Everything the web build's marketing pages (`/`, `/download`, `/privacy`)
 * get from `src/main.tsx`: theme and language, nothing of the app's. They
 * mount outside the router and `QueryClientProvider`, and never open the
 * database, so nothing they render may use React Query, router hooks or the
 * repositories (the app's `TopBar` uses all three). Tests render these pages
 * through this wrapper, so they see exactly what production sees.
 */
export function LandingProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <LanguageProvider>{children}</LanguageProvider>
    </ThemeProvider>
  );
}
