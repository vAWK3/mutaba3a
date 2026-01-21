import { useT } from '../../../lib/i18n';
import { useLatestRelease } from '../../../hooks/useLatestRelease';
import './DownloadSection.css';

const AppleIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
  </svg>
);

const WindowsIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
    <path d="M3 5.548L10.475 4.61v6.638H3V5.548zM3 18.452L10.475 19.39v-6.638H3v5.7zm8.166 1.047L21 21V12.752H11.166v6.747zM11.166 4.51v6.738H21V3L11.166 4.51z" />
  </svg>
);

export function DownloadSection() {
  const { release, isLoading } = useLatestRelease();
  const t = useT();

  return (
    <section className="landing-section landing-download">
      <div className="landing-container">
        <h2 className="landing-section-headline">{t('landing.download.headline')}</h2>

        <div className="download-version">
          <span className="version-label">{t('landing.download.latestLabel')}: </span>
          <span className="version-number">
            {isLoading ? '...' : release?.version ?? '—'}
          </span>
          {release && (
            <a
              href={release.releaseNotesUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="version-notes-link"
            >
              {t('landing.download.releaseNotes')}
            </a>
          )}
        </div>

        <div className="download-cards">
          <a href="/download/mac" className="download-card">
            <div className="download-card-icon">
              <AppleIcon />
            </div>
            <span className="download-card-label">{t('landing.download.mac')}</span>
            <span className="download-card-hint">{t('landing.download.macHint')}</span>
          </a>

          <a href="/download/windows" className="download-card">
            <div className="download-card-icon">
              <WindowsIcon />
            </div>
            <span className="download-card-label">{t('landing.download.windowsMsi')}</span>
            <span className="download-card-hint">{t('landing.download.windowsHint')}</span>
          </a>
        </div>

        <div className="download-alt">
          <a href="/download/windows-exe" className="download-alt-link">
            {t('landing.download.windowsExe')}
          </a>
        </div>

        <p className="landing-pwa-note">{t('landing.download.pwaNote')}</p>
      </div>
    </section>
  );
}
