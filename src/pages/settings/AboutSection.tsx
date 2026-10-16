import { useT } from '../../lib/i18n';
import { useCheckForUpdates } from '../../hooks/useCheckForUpdates';

// Stable download URLs (redirected by Netlify to GitHub Releases latest)
const DOWNLOAD_URLS = {
  mac: '/download/mac',
  windows: '/download/windows',
} as const;

// App version injected by Vite at build time
declare const __APP_VERSION__: string | undefined;
const APP_VERSION = __APP_VERSION__ || '0.0.0';

/**
 * Settings › About (MUT-139): app info, update status and desktop downloads
 * under one heading — these three were separate h2 sections with no
 * standalone tests, so merging costs nothing and reads as one topic.
 */
export function AboutSection() {
  const t = useT();
  const { latestVersion, hasUpdate, isLoading: isCheckingUpdate, error: updateError } = useCheckForUpdates();

  return (
    <div className="settings-section settings-section-quiet">
      <h2 className="settings-section-title">{t('settings.about.title')}</h2>
      <div className="text-muted">
        <p>{t('settings.about.name')}</p>
        <p className="text-sm" style={{ marginTop: 'var(--space-2)' }}>
          {t('settings.about.description')}
        </p>
      </div>

      <div className="settings-row" style={{ marginTop: 'var(--space-4)' }}>
        <div>
          <div className="settings-label">{t('settings.about.support')}</div>
          <div className="settings-description">{t('settings.about.supportDesc')}</div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <a
            href="https://buymeacoffee.com/elmokhtbr"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            {t('settings.about.buyMeCoffee')}
          </a>
          <a
            href="https://ko-fi.com/elmokhtbr"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            {t('settings.about.kofi')}
          </a>
        </div>
      </div>

      {isCheckingUpdate ? (
        <div className="settings-row" style={{ marginTop: 'var(--space-4)' }}>
          <div>
            <div className="text-muted">{t('settings.updates.checking')}</div>
            <div className="settings-description">
              {t('settings.updates.currentVersion')}: <span style={{ fontFamily: 'var(--font-mono)' }}>{APP_VERSION}</span>
            </div>
          </div>
        </div>
      ) : updateError ? (
        <div className="settings-row" style={{ marginTop: 'var(--space-4)' }}>
          <div>
            <div className="text-muted">{t('settings.updates.checkFailed')}</div>
            <div className="settings-description">
              {t('settings.updates.currentVersion')}: <span style={{ fontFamily: 'var(--font-mono)' }}>{APP_VERSION}</span>
            </div>
          </div>
        </div>
      ) : hasUpdate ? (
        <div className="settings-update-card" style={{ marginTop: 'var(--space-4)' }}>
          <div className="settings-update-card-content">
            <div className="settings-update-card-title">{t('settings.updates.updateAvailable')}</div>
            <div className="settings-update-card-versions">
              {t('settings.updates.currentVersion')}: <span className="settings-update-card-version">{APP_VERSION}</span>
              {' → '}
              {t('settings.updates.latestVersion')}: <span className="settings-update-card-version">{latestVersion}</span>
            </div>
          </div>
          <a href="/download" className="btn btn-primary">
            {t('settings.updates.updateNow')}
          </a>
        </div>
      ) : (
        <div className="settings-row" style={{ marginTop: 'var(--space-4)' }}>
          <div>
            <div className="settings-label">{t('settings.updates.upToDate')}</div>
            <div className="settings-description">
              {t('settings.updates.currentVersion')}: <span style={{ fontFamily: 'var(--font-mono)' }}>{APP_VERSION}</span>
            </div>
          </div>
        </div>
      )}

      <div className="settings-row" style={{ marginTop: 'var(--space-4)' }}>
        <div>
          <div className="settings-label">{t('settings.desktopApp.download')}</div>
          <div className="settings-description">{t('settings.desktopApp.downloadDesc')}</div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <a href={DOWNLOAD_URLS.mac} className="btn btn-secondary" rel="noopener">
            {t('settings.desktopApp.downloadMac')}
          </a>
          <a href={DOWNLOAD_URLS.windows} className="btn btn-secondary" rel="noopener">
            {t('settings.desktopApp.downloadWindows')}
          </a>
        </div>
      </div>

      <div className="settings-row">
        <div>
          <div className="settings-label" style={{ color: 'var(--muted)' }}>{t('download.allVersions')}</div>
        </div>
        <a href="/download" className="btn btn-ghost">
          {t('settings.desktopApp.downloadBtn')}
        </a>
      </div>
    </div>
  );
}
