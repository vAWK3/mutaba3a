import { useT } from '../../../lib/i18n';

export function FinalCTASection() {
  const t = useT();

  return (
    <section className="landing-section landing-final-cta">
      <div className="landing-container">
        <h2 className="landing-section-headline">{t('landing.finalCta.headline')}</h2>
        <p className="landing-trust">{t('landing.finalCta.trust')}</p>
        <div className="landing-final-actions">
          <a href="/app" className="landing-btn landing-btn--primary">
            {t('landing.hero.ctaPrimary')}
          </a>
          <a href="/download" className="landing-btn landing-btn--secondary">
            {t('landing.hero.ctaSecondary')}
          </a>
        </div>
      </div>
    </section>
  );
}
