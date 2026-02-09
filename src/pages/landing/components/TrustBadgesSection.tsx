import { useT } from '../../../lib/i18n';
import './TrustBadgesSection.css';

const NoCloudIcon = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M2 2l20 20" />
    <path d="M8.5 9.5A6 6 0 0 1 17.6 14" />
    <path d="M12 3a6 6 0 0 1 5.8 4.5" />
    <path d="M18 18H6a4 4 0 0 1-4-4c0-1.3.6-2.5 1.6-3.3" />
    <path d="M20.4 12.3A4 4 0 0 1 18 18" />
  </svg>
);

const ShieldIcon = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="M9 12l2 2 4-4" />
  </svg>
);

const WifiOffIcon = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M2 2l20 20" />
    <path d="M8.5 16.5a5 5 0 0 1 7 0" />
    <path d="M2 8.82a15 15 0 0 1 4.17-2.65" />
    <path d="M10.66 5c4.01-.36 8.14.9 11.34 3.76" />
    <path d="M16.85 11.25a10 10 0 0 1 2.22 1.68" />
    <path d="M5 13a10 10 0 0 1 5.24-2.76" />
    <line x1="12" y1="20" x2="12.01" y2="20" />
  </svg>
);

const ExportIcon = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

interface TrustBadgeProps {
  icon: React.ReactNode;
  label: string;
  description: string;
}

function TrustBadge({ icon, label, description }: TrustBadgeProps) {
  return (
    <div className="trust-badge">
      <div className="trust-badge-icon">{icon}</div>
      <div className="trust-badge-content">
        <span className="trust-badge-label">{label}</span>
        <span className="trust-badge-desc">{description}</span>
      </div>
    </div>
  );
}

export function TrustBadgesSection() {
  const t = useT();

  return (
    <section className="landing-section landing-trust-badges">
      <div className="landing-container">
        <div className="trust-badges-grid">
          <TrustBadge
            icon={<NoCloudIcon />}
            label={t('landing.trustBadges.noCloud')}
            description={t('landing.trustBadges.noCloudDesc')}
          />
          <TrustBadge
            icon={<ShieldIcon />}
            label={t('landing.trustBadges.noTracking')}
            description={t('landing.trustBadges.noTrackingDesc')}
          />
          <TrustBadge
            icon={<WifiOffIcon />}
            label={t('landing.trustBadges.offline')}
            description={t('landing.trustBadges.offlineDesc')}
          />
          <TrustBadge
            icon={<ExportIcon />}
            label={t('landing.trustBadges.export')}
            description={t('landing.trustBadges.exportDesc')}
          />
        </div>
      </div>
    </section>
  );
}
