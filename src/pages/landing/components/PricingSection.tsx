import { useT } from '../../../lib/i18n';

export function PricingSection() {
  const t = useT();

  return (
    <section className="landing-section landing-pricing">
      <div className="landing-container">
        <h2 className="landing-section-headline">{t('landing.pricing.headline')}</h2>
        <div className="landing-pricing-content">
          <p className="landing-pricing-line">{t('landing.pricing.personal')}</p>
          <p className="landing-pricing-line landing-pricing-line--muted">
            {t('landing.pricing.commercial')}
          </p>
          <p className="landing-pricing-line landing-pricing-line--future">
            {t('landing.pricing.future')}
          </p>
          <div className="landing-pricing-support">
            <span>{t('landing.pricing.support')}</span>
            <a
              href="https://www.buymeacoffee.com/ahmad3"
              target="_blank"
              rel="noopener noreferrer"
              className="landing-btn landing-btn--coffee"
            >
              {t('landing.pricing.supportCta')}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
