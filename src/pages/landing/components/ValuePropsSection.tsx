import { useT } from '../../../lib/i18n';
import './ValuePropsSection.css';

const PrivacyIcon = () => (
  <svg
    width="32"
    height="32"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

const PowerIcon = () => (
  <svg
    width="32"
    height="32"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

const ControlIcon = () => (
  <svg
    width="32"
    height="32"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

interface ValueCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  bullets: string[];
}

function ValueCard({ icon, title, description, bullets }: ValueCardProps) {
  return (
    <div className="value-card">
      <div className="value-card-icon">{icon}</div>
      <h3 className="value-card-title">{title}</h3>
      <p className="value-card-desc">{description}</p>
      <ul className="value-card-list">
        {bullets.map((bullet, idx) => (
          <li key={idx}>{bullet}</li>
        ))}
      </ul>
    </div>
  );
}

export function ValuePropsSection() {
  const t = useT();

  return (
    <section className="landing-section landing-value-props">
      <div className="landing-container">
        <h2 className="landing-section-headline">{t('landing.valueProps.headline')}</h2>
        <p className="landing-section-subheadline">{t('landing.valueProps.subheadline')}</p>

        <div className="value-props-grid">
          <ValueCard
            icon={<PrivacyIcon />}
            title={t('landing.valueProps.privacy.title')}
            description={t('landing.valueProps.privacy.desc')}
            bullets={[
              t('landing.valueProps.privacy.bullet1'),
              t('landing.valueProps.privacy.bullet2'),
              t('landing.valueProps.privacy.bullet3'),
            ]}
          />
          <ValueCard
            icon={<PowerIcon />}
            title={t('landing.valueProps.power.title')}
            description={t('landing.valueProps.power.desc')}
            bullets={[
              t('landing.valueProps.power.bullet1'),
              t('landing.valueProps.power.bullet2'),
              t('landing.valueProps.power.bullet3'),
            ]}
          />
          <ValueCard
            icon={<ControlIcon />}
            title={t('landing.valueProps.control.title')}
            description={t('landing.valueProps.control.desc')}
            bullets={[
              t('landing.valueProps.control.bullet1'),
              t('landing.valueProps.control.bullet2'),
              t('landing.valueProps.control.bullet3'),
            ]}
          />
        </div>
      </div>
    </section>
  );
}
