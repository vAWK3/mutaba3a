import { useT } from '../../../lib/i18n';
import { useLatestRelease } from '../../../hooks/useLatestRelease';
import './HeroSection.css';

const ShieldIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

const AppleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
  </svg>
);

const WindowsIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M3 5.548L10.475 4.61v6.638H3V5.548zM3 18.452L10.475 19.39v-6.638H3v5.7zm8.166 1.047L21 21V12.752H11.166v6.747zM11.166 4.51v6.738H21V3L11.166 4.51z" />
  </svg>
);

export function HeroSection() {
  const t = useT();
  const { release, isLoading } = useLatestRelease();

  return (
    <section className="landing-section landing-hero">
      <div className="landing-container">
        <div className="hero-layout">
          <div className="hero-content">
            <div className="hero-badge">
              <ShieldIcon />
              <span>{t('landing.hero.badge')}</span>
            </div>

            <h1 className="landing-headline-large">{t('landing.hero.headline')}</h1>
            <p className="landing-subheadline-large">{t('landing.hero.subheadline')}</p>

            <div className="hero-value-strip">
              <span className="hero-value-item">{t('landing.hero.value1')}</span>
              <span className="hero-value-divider" aria-hidden="true" />
              <span className="hero-value-item">{t('landing.hero.value2')}</span>
              <span className="hero-value-divider" aria-hidden="true" />
              <span className="hero-value-item">{t('landing.hero.value3')}</span>
            </div>

            <div className="hero-download-ctas">
              <a href="/download/mac" className="hero-download-btn hero-download-btn--mac">
                <AppleIcon />
                <div className="hero-download-btn-text">
                  <span className="hero-download-btn-label">{t('landing.hero.downloadMac')}</span>
                  <span className="hero-download-btn-hint">
                    {isLoading ? '...' : release?.version ?? 'Universal'}
                  </span>
                </div>
              </a>
              <a href="/download/windows" className="hero-download-btn hero-download-btn--windows">
                <WindowsIcon />
                <div className="hero-download-btn-text">
                  <span className="hero-download-btn-label">
                    {t('landing.hero.downloadWindows')}
                  </span>
                  <span className="hero-download-btn-hint">
                    {isLoading ? '...' : release?.version ?? 'MSI'}
                  </span>
                </div>
              </a>
            </div>

            <p className="hero-alt-link">
              {t('landing.hero.orTry')}{' '}
              <a href="/app" className="hero-web-link">
                {t('landing.hero.webApp')}
              </a>
            </p>
          </div>

          <div className="hero-preview">
            <div className="hero-preview-frame">
              <img
                src="/assets/landing/hero-dashboard.png"
                alt="Mutaba3a Dashboard"
                className="hero-preview-img"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
