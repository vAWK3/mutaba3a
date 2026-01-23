import { useState, useEffect, useCallback } from 'react';
import { useT } from '../../lib/i18n';
import { isTauri, isMacOS } from '../../lib/platform';
import './MacDownloadBanner.css';

const STORAGE_KEY = 'hideDownloadBanner';

export function MacDownloadBanner() {
  const t = useT();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Only show on macOS in browser (not Tauri)
    if (!isMacOS() || isTauri()) return;

    // Check if user has dismissed the banner
    const hidden = localStorage.getItem(STORAGE_KEY);
    if (hidden === 'true') return;

    setIsVisible(true);
  }, []);

  const handleDismiss = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setIsVisible(false);
  }, []);

  if (!isVisible) return null;

  return (
    <div className="mac-download-banner" role="banner">
      <span className="mac-download-banner-message">
        {t('downloadBanner.message')}
      </span>
      <div className="mac-download-banner-actions">
        <a
          href="/download"
          className="mac-download-banner-cta"
          data-cta="download-banner-mac"
        >
          {t('downloadBanner.cta')}
        </a>
        <button
          type="button"
          className="mac-download-banner-dismiss"
          onClick={handleDismiss}
          aria-label={t('downloadBanner.dismiss')}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
