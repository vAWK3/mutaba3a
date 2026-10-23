import type { ReactNode } from 'react';
import { ErrorBoundary } from '../../components/ui/ErrorBoundary';
import en from '../i18n/en.json';
import ar from '../i18n/ar.json';
import { reportBoundaryError } from './errorReporting';

/**
 * The outermost boundary (MUT-149 design D8), above every provider: if one of
 * them crashes there is no language, theme or router left to lean on. So the
 * screen is static, Arabic first, then English (ADR-077), its words read
 * straight from the portal's dictionaries, styled by the boot-splash CSS only.
 */

const LANGUAGES = [
  { lang: 'ar', dir: 'rtl', copy: ar.hosted.crash },
  { lang: 'en', dir: 'ltr', copy: en.hosted.crash },
] as const;

function StaticCrash() {
  return (
    <div className="boot-splash" role="alert">
      {LANGUAGES.map(({ lang, dir, copy }) => (
        <div key={lang} lang={lang} dir={dir}>
          <h2>{copy.title}</h2>
          <p>{copy.body}</p>
        </div>
      ))}
      <button type="button" onClick={() => window.location.reload()}>
        {`${ar.hosted.crash.reload} · ${en.hosted.crash.reload}`}
      </button>
    </div>
  );
}

export function LastResortBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary fallback={<StaticCrash />} onError={(error, info) => reportBoundaryError(error, info.componentStack ?? undefined)}>
      {children}
    </ErrorBoundary>
  );
}
