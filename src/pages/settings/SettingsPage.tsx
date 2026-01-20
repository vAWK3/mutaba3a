import { useState, useRef, useEffect } from 'react';
import { useNavigate, Link } from '@tanstack/react-router';
import { TopBar } from '../../components/layout';
import {
  useSettings,
  useUpdateSettings,
  useBusinessProfiles,
  useSetDefaultBusinessProfile,
  useArchiveBusinessProfile,
} from '../../hooks/useQueries';
import { useT, useLanguage } from '../../lib/i18n';
import { useTheme, type ThemeMode } from '../../lib/theme';
import { DeleteAllDataModal, ExportDataModal, ImportDataModal } from '../../components/modals';
import { useCheckForUpdates } from '../../hooks/useCheckForUpdates';
import { SyncSection } from '../../components/sync';
import { useDrawerStore } from '../../lib/stores';

// Stable download URLs (redirected by Netlify to GitHub Releases latest)
const DOWNLOAD_URLS = {
  mac: '/download/mac',
  windows: '/download/windows',
} as const;

// App version injected by Vite at build time
declare const __APP_VERSION__: string | undefined;
const APP_VERSION = __APP_VERSION__ || '0.0.0';
import type { Currency, BusinessProfile } from '../../types';
import type { Language } from '../../lib/i18n/types';

// Profile Actions Menu Component
interface ProfileActionsMenuProps {
  profile: BusinessProfile;
  onEdit: () => void;
  onSetDefault: () => void;
  onArchive: () => void;
  isSetDefaultPending: boolean;
  isArchivePending: boolean;
}

function ProfileActionsMenu({
  profile,
  onEdit,
  onSetDefault,
  onArchive,
  isSetDefaultPending,
  isArchivePending,
}: ProfileActionsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  return (
    <div className="add-menu-container" ref={containerRef}>
      <button className="btn btn-ghost btn-sm" onClick={() => setIsOpen(!isOpen)}>
        <MoreIcon />
      </button>
      {isOpen && (
        <div className="add-menu">
          <button
            className="add-menu-item"
            onClick={() => {
              onEdit();
              setIsOpen(false);
            }}
          >
            Edit
          </button>
          {!profile.isDefault && (
            <button
              className="add-menu-item"
              onClick={() => {
                onSetDefault();
                setIsOpen(false);
              }}
              disabled={isSetDefaultPending}
            >
              Set as Default
            </button>
          )}
          {!profile.isDefault && (
            <button
              className="add-menu-item text-danger"
              onClick={() => {
                if (confirm('Are you sure you want to archive this business profile?')) {
                  onArchive();
                  setIsOpen(false);
                }
              }}
              disabled={isArchivePending}
            >
              Archive
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function MoreIcon() {
  return (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 12.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 18.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Z" />
    </svg>
  );
}

export function SettingsPage() {
  const { data: settings, isLoading } = useSettings();
  const updateMutation = useUpdateSettings();
  const t = useT();
  const navigate = useNavigate();
  const { language, setLanguage } = useLanguage();
  const { theme, setTheme } = useTheme();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [deleteSuccessMessage, setDeleteSuccessMessage] = useState<string>('');
  const { latestVersion, hasUpdate, isLoading: isCheckingUpdate, error: updateError } = useCheckForUpdates();

  // Business profiles
  const { data: businessProfiles = [] } = useBusinessProfiles();
  const setDefaultMutation = useSetDefaultBusinessProfile();
  const archiveMutation = useArchiveBusinessProfile();
  const { openBusinessProfileDrawer } = useDrawerStore();

  const handleCurrencyToggle = (currency: Currency) => {
    if (!settings) return;

    const current = settings.enabledCurrencies;
    const isEnabled = current.includes(currency);

    // Don't allow disabling if only one currency is enabled
    if (isEnabled && current.length === 1) return;

    const updated = isEnabled
      ? current.filter((c) => c !== currency)
      : [...current, currency];

    updateMutation.mutate({ enabledCurrencies: updated });
  };

  const handleDefaultCurrencyChange = (currency: Currency) => {
    updateMutation.mutate({ defaultCurrency: currency });
  };

  const handleDeleteSuccess = () => {
    setShowDeleteModal(false);
    setDeleteSuccessMessage(t('settings.data.deleteModal.success'));
    setTimeout(() => {
      setDeleteSuccessMessage('');
      navigate({ to: '/' });
    }, 2000);
  };

  if (isLoading) {
    return (
      <>
        <TopBar title={t('settings.title')} hideAddMenu />
        <div className="page-content">
          <div className="loading">
            <div className="spinner" />
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar title={t('settings.title')} hideAddMenu />
      <div className="page-content" style={{ maxWidth: 600 }}>
        {/* Language Settings */}
        <div className="settings-section">
          <h3 className="settings-section-title">{t('settings.language.title')}</h3>

          <div className="settings-row">
            <div>
              <div className="settings-label">{t('settings.language.description')}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['en', 'ar'] as Language[]).map((lang) => (
                <button
                  key={lang}
                  className={`btn btn-sm ${language === lang ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setLanguage(lang)}
                >
                  {lang === 'en' ? 'English' : 'العربية'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Theme Settings */}
        <div className="settings-section">
          <h3 className="settings-section-title">{t('settings.theme.title')}</h3>

          <div className="settings-row">
            <div>
              <div className="settings-label">{t('settings.theme.description')}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['light', 'dark', 'system'] as ThemeMode[]).map((mode) => (
                <button
                  key={mode}
                  className={`btn btn-sm ${theme === mode ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setTheme(mode)}
                >
                  {t(`settings.theme.${mode}`)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Sync Settings */}
        <div className="settings-section">
          <SyncSection />
        </div>

        {/* Business Profiles */}
        <div className="settings-section">
          <div className="settings-section-header">
            <h3 className="settings-section-title">Business Profiles</h3>
            <button
              className="btn btn-sm btn-secondary"
              onClick={() => openBusinessProfileDrawer({ mode: 'create' })}
            >
              + Add Profile
            </button>
          </div>

          {businessProfiles.length === 0 ? (
            <div className="text-muted text-sm">
              No business profiles yet. Create one to start issuing invoices.
            </div>
          ) : (
            <div className="business-profiles-list">
              {businessProfiles.map((profile) => (
                <div key={profile.id} className="business-profile-item">
                  <div className="business-profile-info">
                    {profile.logoDataUrl && (
                      <img
                        src={profile.logoDataUrl}
                        alt=""
                        className="business-profile-logo"
                      />
                    )}
                    <div className="business-profile-details">
                      <Link
                        to="/settings/profiles/$profileId"
                        params={{ profileId: profile.id }}
                        className="business-profile-name"
                        style={{ textDecoration: 'none', color: 'inherit' }}
                      >
                        {profile.name}
                        {profile.nameEn && <span className="text-muted"> ({profile.nameEn})</span>}
                      </Link>
                      <div className="business-profile-meta text-muted text-sm">
                        {profile.email}
                        {profile.isDefault && (
                          <span className="badge badge-primary" style={{ marginInlineStart: 8 }}>
                            Default
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <ProfileActionsMenu
                    profile={profile}
                    onEdit={() => navigate({ to: '/settings/profiles/$profileId', params: { profileId: profile.id } })}
                    onSetDefault={() => setDefaultMutation.mutate(profile.id)}
                    onArchive={() => archiveMutation.mutate(profile.id)}
                    isSetDefaultPending={setDefaultMutation.isPending}
                    isArchivePending={archiveMutation.isPending}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Currency Settings */}
        <div className="settings-section">
          <h3 className="settings-section-title">{t('settings.currency.title')}</h3>

          <div className="settings-row">
            <div>
              <div className="settings-label">{t('settings.currency.enabled')}</div>
              <div className="settings-description">{t('settings.currency.enabledDesc')}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['USD', 'ILS'] as Currency[]).map((curr) => (
                <button
                  key={curr}
                  className={`btn btn-sm ${settings?.enabledCurrencies.includes(curr) ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => handleCurrencyToggle(curr)}
                >
                  {curr}
                </button>
              ))}
            </div>
          </div>

          <div className="settings-row">
            <div>
              <div className="settings-label">{t('settings.currency.default')}</div>
              <div className="settings-description">{t('settings.currency.defaultDesc')}</div>
            </div>
            <select
              className="select"
              value={settings?.defaultCurrency}
              onChange={(e) => handleDefaultCurrencyChange(e.target.value as Currency)}
            >
              {settings?.enabledCurrencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Data Management */}
        <div className="settings-section">
          <h3 className="settings-section-title">{t('settings.data.title')}</h3>

          <div className="settings-row">
            <div>
              <div className="settings-label">{t('settings.data.export')}</div>
              <div className="settings-description">{t('settings.data.exportDesc')}</div>
            </div>
            <button className="btn btn-secondary" onClick={() => setShowExportModal(true)}>
              {t('settings.data.exportBtn')}
            </button>
          </div>

          <div className="settings-row">
            <div>
              <div className="settings-label">{t('settings.data.import')}</div>
              <div className="settings-description">{t('settings.data.importDesc')}</div>
            </div>
            <button className="btn btn-secondary" onClick={() => setShowImportModal(true)}>
              {t('settings.data.importBtn')}
            </button>
          </div>

          <div className="settings-row" style={{ borderTop: '1px solid var(--color-border)', paddingTop: 16, marginTop: 8 }}>
            <div>
              <div className="settings-label text-danger">{t('settings.data.deleteAll')}</div>
              <div className="settings-description">{t('settings.data.deleteAllDesc')}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {deleteSuccessMessage && (
                <span className="text-sm text-success">{deleteSuccessMessage}</span>
              )}
              <button className="btn btn-danger" onClick={() => setShowDeleteModal(true)}>
                {t('settings.data.deleteAllBtn')}
              </button>
            </div>
          </div>
        </div>

        {/* About */}
        <div className="settings-section">
          <h3 className="settings-section-title">{t('settings.about.title')}</h3>
          <div className="text-muted">
            <p>{t('settings.about.name')}</p>
            <p className="text-sm" style={{ marginTop: 8 }}>
              {t('settings.about.description')}
            </p>
            <p className="text-sm" style={{ marginTop: 12 }}>
              {t('settings.updates.currentVersion')}: <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{APP_VERSION}</span>
            </p>
          </div>
        </div>

        {/* Updates */}
        <div className="settings-section">
          <h3 className="settings-section-title">{t('settings.updates.title')}</h3>

          {isCheckingUpdate ? (
            <div className="text-muted">{t('settings.updates.checking')}</div>
          ) : updateError ? (
            <div className="text-muted">{t('settings.updates.checkFailed')}</div>
          ) : hasUpdate ? (
            <div className="update-banner">
              <div className="update-banner-content">
                <div className="update-banner-title">{t('settings.updates.updateAvailable')}</div>
                <div className="update-banner-versions">
                  {t('settings.updates.currentVersion')}: <span className="update-banner-version">{APP_VERSION}</span>
                  {' → '}
                  {t('settings.updates.latestVersion')}: <span className="update-banner-version">{latestVersion}</span>
                </div>
              </div>
              <Link to="/download" className="btn btn-primary">
                {t('settings.updates.updateNow')}
              </Link>
            </div>
          ) : (
            <div className="settings-row">
              <div>
                <div className="settings-label">{t('settings.updates.upToDate')}</div>
                <div className="settings-description">
                  {t('settings.updates.currentVersion')}: <span style={{ fontFamily: 'var(--font-mono)' }}>{APP_VERSION}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Desktop App */}
        <div className="settings-section">
          <h3 className="settings-section-title">{t('settings.desktopApp.title')}</h3>

          <div className="settings-row">
            <div>
              <div className="settings-label">{t('settings.desktopApp.download')}</div>
              <div className="settings-description">{t('settings.desktopApp.downloadDesc')}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <a
                href={DOWNLOAD_URLS.mac}
                className="btn btn-secondary"
                rel="noopener"
              >
                {t('settings.desktopApp.downloadMac')}
              </a>
              <a
                href={DOWNLOAD_URLS.windows}
                className="btn btn-secondary"
                rel="noopener"
              >
                {t('settings.desktopApp.downloadWindows')}
              </a>
            </div>
          </div>

          <div className="settings-row">
            <div>
              <div className="settings-label" style={{ color: 'var(--color-text-muted)' }}>{t('download.allVersions')}</div>
            </div>
            <Link to="/download" className="btn btn-ghost">
              {t('settings.desktopApp.downloadBtn')}
            </Link>
          </div>
        </div>
      </div>

      {/* Export Data Modal */}
      {showExportModal && (
        <ExportDataModal onClose={() => setShowExportModal(false)} />
      )}

      {/* Import Data Modal */}
      {showImportModal && (
        <ImportDataModal onClose={() => setShowImportModal(false)} />
      )}

      {/* Delete All Data Modal */}
      {showDeleteModal && (
        <DeleteAllDataModal
          onClose={() => setShowDeleteModal(false)}
          onSuccess={handleDeleteSuccess}
        />
      )}
    </>
  );
}
