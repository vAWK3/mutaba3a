import { useT } from '../../../lib/i18n';

/**
 * What a website page shows when it crashes (MUT-150 eng D9): the landing's
 * own words, in the visitor's language, instead of the app's English
 * "Your data is safe" fallback. It reuses the boundary's styles, which
 * `main.tsx` always loads, so it renders even when the page's own CSS
 * never arrived.
 */
export function LandingCrashScreen() {
  const t = useT();
  return (
    <div className="error-boundary-fallback" role="alert">
      <div className="error-boundary-content">
        <h2>{t('landing.crash.title')}</h2>
        <p>{t('landing.crash.body')}</p>
        <div className="error-boundary-actions">
          <button type="button" onClick={() => window.location.reload()} className="btn btn-primary">
            {t('landing.crash.reload')}
          </button>
        </div>
      </div>
    </div>
  );
}
