import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useT } from '../../lib/i18n';
import { useFeatureNotice } from '../../lib/features/useFeatures';

/**
 * Tells the user once which optional areas were switched on for their
 * existing data (v20 upgrade, backup restore, import, demo or sync), and
 * points at Settings › Advanced features (MUT-12).
 *
 * The notice is cleared only when the user dismisses it, so it survives a
 * missed glance, a reload and a session restart; rendering is idempotent, so
 * StrictMode or a refetch cannot show it twice.
 */
export function FeatureNoticeBanner() {
  const { notice, isLoaded, dismiss } = useFeatureNotice();
  const t = useT();
  const [dismissing, setDismissing] = useState(false);

  if (!isLoaded || notice.length === 0) return null;

  const names = notice.map((key) => t(`settings.features.items.${key}.label`)).join(', ');

  const handleDismiss = async () => {
    setDismissing(true);
    try {
      await dismiss();
    } finally {
      setDismissing(false);
    }
  };

  return (
    <div className="feature-notice-banner" role="status" data-testid="feature-notice-banner">
      <span className="feature-notice-banner-icon" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
          <line x1="8" y1="7" x2="8" y2="11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="8" cy="4.75" r="0.75" fill="currentColor" />
        </svg>
      </span>
      <span className="feature-notice-banner-text">{t('settings.features.autoEnabled', { features: names })}</span>
      <Link to="/settings" className="feature-notice-banner-action">
        {t('settings.features.openSettings')}
      </Link>
      <button
        type="button"
        className="feature-notice-banner-dismiss"
        onClick={handleDismiss}
        disabled={dismissing}
        aria-label={t('settings.features.dismiss')}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
