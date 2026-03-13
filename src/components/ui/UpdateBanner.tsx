import { useCallback, useState, useEffect } from 'react';
import { useT } from '../../lib/i18n';
import { useTauriUpdater } from '../../hooks/useTauriUpdater';
import { isTauri } from '../../lib/platform';
import './UpdateBanner.css';

const DISMISSED_KEY = 'update-banner-dismissed-version';

export function UpdateBanner() {
  const t = useT();
  const { status, availableVersion, downloadProgress, downloadAndInstall, applyUpdate } =
    useTauriUpdater();

  const [dismissed, setDismissed] = useState(() => {
    if (!availableVersion) return false;
    return localStorage.getItem(DISMISSED_KEY) === availableVersion;
  });

  // Update dismissed state when availableVersion changes
  /* eslint-disable react-hooks/set-state-in-effect -- Syncing state with prop changes is intentional */
  useEffect(() => {
    if (availableVersion) {
      const storedVersion = localStorage.getItem(DISMISSED_KEY);
      setDismissed(storedVersion === availableVersion);
    }
  }, [availableVersion]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleDismiss = useCallback(() => {
    if (availableVersion) {
      localStorage.setItem(DISMISSED_KEY, availableVersion);
    }
    setDismissed(true);
  }, [availableVersion]);

  const handleDownload = useCallback(() => {
    downloadAndInstall();
  }, [downloadAndInstall]);

  const handleRestart = useCallback(() => {
    applyUpdate();
  }, [applyUpdate]);

  // Only show in Tauri environment
  if (!isTauri()) return null;

  // Don't show if dismissed for this version
  if (dismissed) return null;

  // Don't show if no update available or still checking
  if (status === 'idle' && !availableVersion) return null;
  if (status === 'checking' || status === 'up-to-date') return null;

  // Determine what to show
  let message: string;
  let primaryAction: { label: string; onClick: () => void } | null = null;
  let showDismiss = true;

  if (status === 'downloading') {
    message = t('updateBanner.downloading', { progress: downloadProgress });
    showDismiss = false;
  } else if (status === 'ready') {
    message = t('updateBanner.ready');
    primaryAction = { label: t('updateBanner.restart'), onClick: handleRestart };
  } else if (status === 'error') {
    message = t('updateBanner.error');
  } else if (availableVersion) {
    message = t('updateBanner.available', { version: availableVersion });
    primaryAction = { label: t('updateBanner.download'), onClick: handleDownload };
  } else {
    return null;
  }

  return (
    <div className="update-banner" role="banner" data-testid="update-banner">
      <span className="update-banner-message">{message}</span>
      <div className="update-banner-actions">
        {primaryAction && (
          <button
            type="button"
            className="update-banner-cta"
            onClick={primaryAction.onClick}
          >
            {primaryAction.label}
          </button>
        )}
        {showDismiss && (
          <button
            type="button"
            className="update-banner-dismiss"
            onClick={handleDismiss}
            aria-label={t('updateBanner.dismiss')}
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
        )}
      </div>
    </div>
  );
}
