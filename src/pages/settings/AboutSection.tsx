import { useT } from '../../lib/i18n';
import { useCheckForUpdates } from '../../hooks/useCheckForUpdates';
import { APP_VERSION } from '../../lib/appVersion';
import { RELEASE_NOTES, latestNotesUpTo, useWhatsNewStore } from '../../lib/whatsNew';

/**
 * Settings › About (MUT-139): app info and update status under one heading.
 * MUT-382: the desktop downloads are gone; MTB3A runs on iOS, Android and the web.
 */
export function AboutSection() {
  const t = useT();
  const { latestVersion, hasUpdate, isLoading: isCheckingUpdate, error: updateError } = useCheckForUpdates();
  const openWhatsNew = useWhatsNewStore((s) => s.openWhatsNew);
  const notes = latestNotesUpTo(RELEASE_NOTES, APP_VERSION);

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

      {notes && (
        <div className="settings-row" style={{ marginTop: 'var(--space-4)' }}>
          <div>
            <div className="settings-label">{t('whatsNew.open')}</div>
            <div className="settings-description">{t('whatsNew.openDesc')}</div>
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => openWhatsNew([notes])}>
            {t('whatsNew.open')}
          </button>
        </div>
      )}
    </div>
  );
}
