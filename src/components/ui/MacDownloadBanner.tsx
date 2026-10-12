import { useState, useCallback } from 'react';
import { useT } from '../../lib/i18n';
import { isTauri, currentDevice } from '../../lib/platform';
import './MacDownloadBanner.css';

const STORAGE_KEY = 'hideDownloadBanner';

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Offers the Mac app on a Mac, in a browser, until dismissed for good (MUT-79,
 * decision A1). It sits in the page's flow at the bottom of the main area, so
 * it never covers content. `currentDevice()` tells an iPad (which reports
 * `MacIntel`) from a Mac (TD-049).
 */
export function MacDownloadBanner() {
  const t = useT();
  const [isVisible, setIsVisible] = useState(
    () => currentDevice() === 'mac' && !isTauri() && !wasDismissed(),
  );

  const handleDismiss = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, 'true');
    } catch {
      // Storage blocked: the bar still goes away for this visit
    }
    setIsVisible(false);
  }, []);

  if (!isVisible) return null;

  return (
    <div className="mac-download-banner">
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
