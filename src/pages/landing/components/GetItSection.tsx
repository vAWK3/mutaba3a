import { useT } from '../../../lib/i18n';
import { useLatestRelease } from '../../../hooks/useLatestRelease';
import { DOWNLOAD_URLS, HOSTED_OFFER_URL, WEB_APP_URL } from '../../../content/download-config';
import { AppleIcon, BrowserIcon, WindowsIcon } from './PlatformIcons';

/**
 * Every way to get the app: the free apps first, then the paid hosted account
 * and phone app with one link to /hosted (MUT-172). The Windows installer is
 * offered only when the latest release actually has one; while the release is
 * unknown the stable redirect is offered, because it usually resolves.
 */
export function GetItSection() {
  const t = useT();
  const { release, isLoading } = useLatestRelease();
  const windowsAvailable = release?.hasWindowsBuild !== false;

  return (
    <section id="get-it" data-part="get-it" aria-labelledby="get-it-title" className="landing-section landing-get-it">
      <div className="landing-container">
        <h2 id="get-it-title" className="landing-section-headline">
          {t('landing.getIt.title')}
        </h2>
        <p className="landing-get-it-free">{t('landing.getIt.free')}</p>
        <p className="landing-get-it-note">{t('landing.getIt.freeNote')}</p>

        <div className="landing-get-it-options">
          <a href={DOWNLOAD_URLS.mac} className="landing-get-it-option">
            <AppleIcon size={24} />
            <span className="landing-get-it-label">{t('landing.getIt.mac')}</span>
            <span className="landing-get-it-hint">{t('landing.getIt.macHint')}</span>
          </a>

          {windowsAvailable ? (
            <a href={DOWNLOAD_URLS.windowsMsi} className="landing-get-it-option">
              <WindowsIcon size={24} />
              <span className="landing-get-it-label">{t('landing.getIt.windows')}</span>
              <span className="landing-get-it-hint">{t('landing.getIt.windowsHint')}</span>
            </a>
          ) : (
            <div className="landing-get-it-option landing-get-it-option--unavailable" role="note">
              <WindowsIcon size={24} />
              <span className="landing-get-it-hint">{t('landing.getIt.windowsUnavailable')}</span>
            </div>
          )}

          <a href={WEB_APP_URL} className="landing-get-it-option">
            <BrowserIcon size={24} />
            <span className="landing-get-it-label">{t('landing.getIt.webApp')}</span>
            <span className="landing-get-it-hint">{t('landing.getIt.webAppHint')}</span>
          </a>
        </div>

        <p className="landing-get-it-meta">
          {windowsAvailable && (
            <a href={DOWNLOAD_URLS.windowsExe} className="landing-get-it-alt">
              {t('landing.getIt.windowsExe')}
            </a>
          )}
          {isLoading && <span className="landing-get-it-version">…</span>}
          {release && (
            <span className="landing-get-it-version">
              {t('landing.getIt.version', { version: release.version })}
              {' · '}
              <a href={release.releaseNotesUrl} target="_blank" rel="noopener noreferrer">
                {t('landing.getIt.releaseNotes')}
              </a>
            </span>
          )}
        </p>

        <div className="landing-get-it-paid" data-part="get-it-paid">
          <p className="landing-get-it-paid-lead">{t('landing.getIt.paid.lead')}</p>
          <p className="landing-get-it-paid-hint">{t('landing.getIt.paid.hint')}</p>
          <a href={HOSTED_OFFER_URL} className="landing-get-it-paid-cta">
            {t('landing.getIt.paid.cta')}
          </a>
        </div>
      </div>
    </section>
  );
}
