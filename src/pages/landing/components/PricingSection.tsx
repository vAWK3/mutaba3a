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
            <div className="landing-pricing-support-links">
              <a
                href="https://buymeacoffee.com/elmokhtbr"
                target="_blank"
                rel="noopener noreferrer"
                className="landing-btn landing-btn--coffee"
              >
                {t('landing.pricing.supportBmac')}
              </a>
              <a
                href="https://ko-fi.com/elmokhtbr"
                target="_blank"
                rel="noopener noreferrer"
                className="landing-btn landing-btn--kofi"
              >
                {t('landing.pricing.supportKofi')}
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
