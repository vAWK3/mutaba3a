import { useT } from '../../../lib/i18n';
import { useLatestRelease } from '../../../hooks/useLatestRelease';
import './FinalCTASection.css';

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

export function FinalCTASection() {
  const t = useT();
  const { release, isLoading } = useLatestRelease();

  return (
    <section className="landing-section landing-final-cta">
      <div className="landing-container">
        <h2 className="final-cta-headline">{t('landing.finalCta.headline')}</h2>
        <p className="final-cta-subheadline">{t('landing.finalCta.subheadline')}</p>

        <div className="final-cta-trust-strip">
          <span>{t('landing.finalCta.trust1')}</span>
          <span className="final-cta-divider" aria-hidden="true" />
          <span>{t('landing.finalCta.trust2')}</span>
          <span className="final-cta-divider" aria-hidden="true" />
          <span>{t('landing.finalCta.trust3')}</span>
        </div>

        <div className="final-cta-buttons">
          <a href="/download/mac" className="final-cta-btn final-cta-btn--primary">
            <AppleIcon />
            <span>{t('landing.finalCta.downloadMac')}</span>
            <span className="final-cta-btn-version">
              {isLoading ? '' : release?.version ?? ''}
            </span>
          </a>
          <a href="/download/windows" className="final-cta-btn final-cta-btn--secondary">
            <WindowsIcon />
            <span>{t('landing.finalCta.downloadWindows')}</span>
          </a>
        </div>

        <p className="final-cta-web-note">
          {t('landing.finalCta.orTry')}{' '}
          <a href="/app" className="final-cta-web-link">
            {t('landing.finalCta.webApp')}
          </a>
        </p>
      </div>
    </section>
  );
}
