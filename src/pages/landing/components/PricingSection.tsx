import { useT } from '../../../lib/i18n';
import './PricingSection.css';

const CheckIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const AlertIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

interface PricingCardProps {
  title: string;
  price: string;
  priceNote: string;
  description: string;
  features: string[];
  ctaLabel: string;
  ctaHref: string;
  highlighted?: boolean;
}

function PricingCard({
  title,
  price,
  priceNote,
  description,
  features,
  ctaLabel,
  ctaHref,
  highlighted,
}: PricingCardProps) {
  return (
    <div className={`pricing-card ${highlighted ? 'pricing-card--highlighted' : ''}`}>
      {highlighted && <div className="pricing-card-badge">Recommended</div>}
      <h3 className="pricing-card-title">{title}</h3>
      <div className="pricing-card-price">
        <span className="pricing-price-amount">{price}</span>
        <span className="pricing-price-note">{priceNote}</span>
      </div>
      <p className="pricing-card-desc">{description}</p>
      <ul className="pricing-card-features" role="list">
        {features.map((feature, idx) => (
          <li key={idx}>
            <CheckIcon />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <a
        href={ctaHref}
        className={`pricing-card-cta ${highlighted ? 'pricing-card-cta--primary' : ''}`}
      >
        {ctaLabel}
      </a>
    </div>
  );
}

export function PricingSection() {
  const t = useT();

  return (
    <section className="landing-section landing-pricing" aria-labelledby="pricing-headline">
      <div className="landing-container">
        <h2 id="pricing-headline" className="landing-section-headline">
          {t('landing.pricing.headline')}
        </h2>
        <p className="landing-section-subheadline">{t('landing.pricing.subheadline')}</p>

        <div className="pricing-grid">
          <PricingCard
            title={t('landing.pricing.web.title')}
            price={t('landing.pricing.web.price')}
            priceNote={t('landing.pricing.web.priceNote')}
            description={t('landing.pricing.web.description')}
            features={[
              t('landing.pricing.web.feature1'),
              t('landing.pricing.web.feature2'),
              t('landing.pricing.web.feature3'),
              t('landing.pricing.web.feature4'),
            ]}
            ctaLabel={t('landing.pricing.web.cta')}
            ctaHref="/app"
          />

          <PricingCard
            title={t('landing.pricing.desktop.title')}
            price={t('landing.pricing.desktop.price')}
            priceNote={t('landing.pricing.desktop.priceNote')}
            description={t('landing.pricing.desktop.description')}
            features={[
              t('landing.pricing.desktop.feature1'),
              t('landing.pricing.desktop.feature2'),
              t('landing.pricing.desktop.feature3'),
              t('landing.pricing.desktop.feature4'),
              t('landing.pricing.desktop.feature5'),
            ]}
            ctaLabel={t('landing.pricing.desktop.cta')}
            ctaHref="/download"
            highlighted
          />

          <PricingCard
            title={t('landing.pricing.support.title')}
            price={t('landing.pricing.support.price')}
            priceNote={t('landing.pricing.support.priceNote')}
            description={t('landing.pricing.support.description')}
            features={[
              t('landing.pricing.support.feature1'),
              t('landing.pricing.support.feature2'),
              t('landing.pricing.support.feature3'),
            ]}
            ctaLabel={t('landing.pricing.support.cta')}
            ctaHref="mailto:support@mutaba3a.app"
          />
        </div>

        <div className="pricing-disclaimer" role="alert">
          <AlertIcon />
          <div className="pricing-disclaimer-content">
            <strong>{t('landing.pricing.disclaimer.title')}</strong>
            <p>{t('landing.pricing.disclaimer.text')}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
