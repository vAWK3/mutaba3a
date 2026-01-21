import { useT } from '../../../lib/i18n';

const CheckIcon = () => (
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
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export function PrivacySection() {
  const t = useT();

  return (
    <section className="landing-section landing-privacy">
      <div className="landing-container">
        <h2 className="landing-section-headline">{t('landing.privacy.headline')}</h2>
        <p className="landing-privacy-intro">{t('landing.privacy.intro')}</p>
        <ul className="landing-trust-list">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <li key={i} className="landing-trust-item">
              <CheckIcon />
              <span>{t(`landing.privacy.point${i}`)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
