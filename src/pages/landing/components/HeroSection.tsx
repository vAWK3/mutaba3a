import { useT } from '../../../lib/i18n';
import { useLatestRelease } from '../../../hooks/useLatestRelease';
import { DOWNLOAD_URLS, WEB_APP_URL } from '../../../content/download-config';
import { AppleIcon, WindowsIcon } from './PlatformIcons';
import './HeroSection.css';

export function HeroSection() {
  const t = useT();
  const { release } = useLatestRelease();
  const windowsAvailable = release?.hasWindowsBuild !== false;

  return (
    <section data-part="hero" aria-labelledby="hero-title" className="landing-section landing-hero">
      <div className="landing-container">
        <div className="hero-layout">
          <div className="hero-content">
            <h1 id="hero-title" className="landing-headline-large">
              <span className="hero-headline-line">{t('landing.hero.headlineLine1')}</span>{' '}
              <span className="hero-headline-line">{t('landing.hero.headlineLine2')}</span>
            </h1>
            <p className="landing-subheadline-large">{t('landing.hero.subheadline')}</p>

            <div className="hero-download-ctas">
              <a href={DOWNLOAD_URLS.mac} className="hero-download-btn hero-download-btn--mac">
                <AppleIcon />
                <span className="hero-download-btn-text">
                  <span className="hero-download-btn-label">{t('landing.hero.downloadMac')}</span>
                  <span className="hero-download-btn-hint">{t('landing.hero.appleSilicon')}</span>
                </span>
              </a>
              {windowsAvailable && (
                <a href={DOWNLOAD_URLS.windowsMsi} className="hero-download-btn hero-download-btn--windows">
                  <WindowsIcon />
                  <span className="hero-download-btn-text">
                    <span className="hero-download-btn-label">
                      {t('landing.hero.downloadWindows')}
                    </span>
                    {release && <span className="hero-download-btn-hint">{release.version}</span>}
                  </span>
                </a>
              )}
            </div>

            <p className="hero-alt-link">
              <a href={WEB_APP_URL} className="hero-web-link">
                {t('landing.hero.webAppLink')}
              </a>
            </p>
          </div>

          <div className="hero-preview">
            <div className="hero-preview-frame">
              <img
                src="/assets/landing/hero-dashboard.png"
                alt={t('landing.hero.previewAlt')}
                className="hero-preview-img"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
