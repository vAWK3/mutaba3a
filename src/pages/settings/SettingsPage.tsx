import { useState, useRef, useEffect, useId } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { TopBar } from '../../components/layout';
import {
  useSettings,
  useUpdateSettings,
  useBusinessProfiles,
  useSetDefaultBusinessProfile,
  useArchiveBusinessProfile,
} from '../../hooks/useQueries';
import { useT, useLanguage } from '../../lib/i18n';
import { useTheme, THEME_MODES } from '../../lib/theme';
import { DeleteAllDataModal } from '../../components/modals';
import { AdvancedFeaturesSection } from './AdvancedFeaturesSection';
import { AboutSection } from './AboutSection';
import { YourDataSection } from './YourDataSection';
import { HostedAccountEntry } from './HostedAccountEntry';
import { MalafatEntry } from './MalafatEntry';
import { malafatSuggestionsEnabled } from '../../lib/malafatSuggestions';
import { goHostedEnabled } from '../../lib/goHosted';
import { useDrawerStore } from '../../lib/stores';
import { Select } from '../../components/ui';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { ProfileBadge } from '../../components/ui/ProfileBadge';
import type { Currency, BusinessProfile } from '../../types';
import type { Language } from '../../lib/i18n/types';

const LANGUAGE_OPTIONS: { value: Language; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'ar', label: 'العربية' },
];

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
  const t = useT();
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
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => setIsOpen(!isOpen)}
        aria-label={t('settings.profile.actionsFor', { name: profile.name })}
        aria-expanded={isOpen}
      >
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
            {t('common.edit')}
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
              {t('settings.profile.setDefault')}
            </button>
          )}
          {!profile.isDefault && (
            <button
              className="add-menu-item text-danger"
              onClick={() => {
                if (confirm(t('settings.profile.confirmArchive'))) {
                  onArchive();
                  setIsOpen(false);
                }
              }}
              disabled={isArchivePending}
            >
              {t('common.archive')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function MoreIcon() {
  return (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
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
  const [deleteSuccessMessage, setDeleteSuccessMessage] = useState<string>('');

  // Business profiles
  const { data: businessProfiles = [] } = useBusinessProfiles();
  const setDefaultMutation = useSetDefaultBusinessProfile();
  const archiveMutation = useArchiveBusinessProfile();
  const { openBusinessProfileDrawer } = useDrawerStore();
  const defaultCurrencyId = useId();
  const defaultCurrencyDescId = useId();
  const languageLabelId = useId();
  const themeLabelId = useId();

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
      {/* One scroll area (MUT-88): .page-content scrolls at full width and
          .settings-column only caps the reading width, so the scrollbar sits
          at the window edge and nothing renders outside the column. */}
      <div className="page-content">
        <div className="settings-column">
          {/* Businesses */}
          <div className="settings-section">
            <div className="settings-section-header">
              <div>
                <h2 className="settings-section-title">{t('settings.profile.title')}</h2>
                <p className="settings-section-description">{t('settings.profile.description')}</p>
              </div>
              <button
                className="btn btn-sm btn-secondary"
                onClick={() => openBusinessProfileDrawer({ mode: 'create' })}
              >
                {t('settings.profile.addProfile')}
              </button>
            </div>

            {businessProfiles.length === 0 ? (
              <div className="text-muted text-sm">
                {t('settings.profile.empty')}
              </div>
            ) : (
              <div className="business-profiles-list">
                {businessProfiles.map((profile) => (
                  <div key={profile.id} className="business-profile-item">
                    <div className="business-profile-info">
                      {profile.logoDataUrl ? (
                        <img
                          src={profile.logoDataUrl}
                          alt=""
                          className="business-profile-logo"
                        />
                      ) : (
                        <ProfileBadge profile={profile} size="md" decorative />
                      )}
                      <div className="business-profile-details">
                        <button
                          type="button"
                          className="business-profile-name business-profile-name-button"
                          onClick={() => openBusinessProfileDrawer({ mode: 'edit', profileId: profile.id })}
                        >
                          {profile.name}
                          {profile.nameEn && <span className="text-muted"> ({profile.nameEn})</span>}
                        </button>
                        <div className="business-profile-meta text-muted text-sm">
                          {profile.email}
                          {profile.isDefault && (
                            <span className="badge badge-primary" style={{ marginInlineStart: 8 }}>
                              {t('settings.profile.default')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <ProfileActionsMenu
                      profile={profile}
                      onEdit={() => openBusinessProfileDrawer({ mode: 'edit', profileId: profile.id })}
                      onSetDefault={() => setDefaultMutation.mutate(profile.id)}
                      onArchive={() => archiveMutation.mutate(profile.id)}
                      isSetDefaultPending={setDefaultMutation.isPending}
                      isArchivePending={archiveMutation.isPending}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Under the businesses: hosted, for the web build only (MUT-187) */}
            {goHostedEnabled() && <HostedAccountEntry />}
            {/* Then Malafat, for law firms and accounting offices: web build only (MUT-190) */}
            {malafatSuggestionsEnabled() && <MalafatEntry />}
          </div>

          {/* General (MUT-139 merged language, theme and currency into one card;
              MUT-88 named it General). The "Currency" label below is plain text,
              not a heading (SettingsPage.a11y.test.tsx forbids h3s). */}
          <div className="settings-section">
            <div className="settings-section-header">
              <div>
                <h2 className="settings-section-title">{t('settings.preferences.title')}</h2>
                <p className="settings-section-description">{t('settings.preferences.description')}</p>
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-label" id={languageLabelId}>{t('settings.language.title')}</div>
              <SegmentedControl
                labelledBy={languageLabelId}
                value={language}
                onChange={setLanguage}
                options={LANGUAGE_OPTIONS}
              />
            </div>

            <div className="settings-row">
              <div className="settings-label" id={themeLabelId}>{t('settings.theme.title')}</div>
              <SegmentedControl
                labelledBy={themeLabelId}
                value={theme}
                onChange={setTheme}
                options={THEME_MODES.map((mode) => ({ value: mode, label: t(`settings.theme.${mode}`) }))}
              />
            </div>

            <div className="settings-subdivider">{t('settings.currency.title')}</div>

            <div className="settings-row">
              <div className="settings-label">{t('settings.currency.enabled')}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['USD', 'ILS'] as Currency[]).map((curr) => (
                  <button
                    key={curr}
                    className={`btn btn-sm ${settings?.enabledCurrencies.includes(curr) ? 'currency-toggle-on' : 'btn-secondary'}`}
                    aria-pressed={settings?.enabledCurrencies.includes(curr)}
                    onClick={() => handleCurrencyToggle(curr)}
                  >
                    {curr}
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-row">
              <div>
                {/* A real <label>, not aria-labelledby: axe's label-title-only treats a
                    labelledby target scrolled out of the clipped shell as hidden (TD-009) */}
                <label className="settings-label" htmlFor={defaultCurrencyId}>{t('settings.currency.default')}</label>
                <div className="settings-description" id={defaultCurrencyDescId}>{t('settings.currency.defaultDesc')}</div>
              </div>
              <Select
                id={defaultCurrencyId}
                aria-describedby={defaultCurrencyDescId}
                value={settings?.defaultCurrency}
                onChange={(e) => handleDefaultCurrencyChange(e.target.value as Currency)}
              >
                {settings?.enabledCurrencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {/* Features: optional areas (MUT-12) */}
          <AdvancedFeaturesSection />

          {/* About, Updates, Desktop App (MUT-139: merged, one topic) */}
          <AboutSection />

          {/* Your data (MUT-88): Back up, Restore, Export a business, Export
              receipts, Check data: each action once. */}
          <YourDataSection />

          {/* Delete all data (MUT-88): alone at the very bottom, outside every
              card, behind a backup and a typed word (DeleteAllDataModal). */}
          <section className="settings-danger-zone" aria-label={t('settings.yourData.deleteZoneLabel')}>
            <div className="settings-description">{t('settings.data.deleteAllDesc')}</div>
            <div className="settings-danger-zone-action">
              {deleteSuccessMessage && (
                <span className="text-sm text-success">{deleteSuccessMessage}</span>
              )}
              <button className="btn btn-danger" onClick={() => setShowDeleteModal(true)}>
                {t('settings.data.deleteAllBtn')}
              </button>
            </div>
          </section>
        </div>
      </div>

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
