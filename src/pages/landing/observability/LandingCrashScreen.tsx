import { useT } from '../../../lib/i18n';

/**
 * What a website page shows when it crashes (MUT-150 eng D9): the landing's
 * own words, in the visitor's language, instead of the app's English
 * "Your data is safe" fallback. It reuses the boundary's styles, which
 * `main.tsx` always loads, so it renders even when the page's own CSS
 * never arrived. It is the whole page, so its title is the page's h1, styled
 * like the boundary's h2, and its one button is a 44px touch target.
 */
export function LandingCrashScreen() {
  const t = useT();
  return (
    <div className="error-boundary-fallback landing-crash" role="alert">
      <div className="error-boundary-content">
        <h1>{t('landing.crash.title')}</h1>
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
