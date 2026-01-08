import { useState, useEffect } from 'react';
import { useNavigate, Link } from '@tanstack/react-router';
import { TopBar } from '../../components/layout';
import {
  useSettings,
  useUpdateSettings,
  useBusinessProfiles,
  useDefaultBusinessProfile,
  useSetDefaultBusinessProfile,
  useArchiveBusinessProfile,
  useDocumentSequences,
  useUpdateDocumentSequence,
} from '../../hooks/useQueries';
import { db } from '../../db';
import { clearDatabase } from '../../db/seed';
import { useT, useLanguage } from '../../lib/i18n';
import { DeleteAllDataModal } from '../../components/modals';
import { useCheckForUpdates } from '../../hooks/useCheckForUpdates';
import { SyncSection } from '../../components/sync';
import { FALLBACK_DOWNLOAD_CONFIG } from '../../content/download-config';
import { useDrawerStore } from '../../lib/stores';

// App version injected by Vite at build time
declare const __APP_VERSION__: string | undefined;
const APP_VERSION = __APP_VERSION__ || '0.0.0';
import type { Currency, DocumentType, DocumentSequence } from '../../types';
import type { Language } from '../../lib/i18n/types';

// Document type display labels
const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  invoice: 'Invoice',
  receipt: 'Receipt',
  invoice_receipt: 'Invoice Receipt',
  credit_note: 'Credit Note',
  price_offer: 'Price Offer',
  proforma_invoice: 'Proforma Invoice',
  donation_receipt: 'Donation Receipt',
};

// Default prefixes for document types
const DEFAULT_PREFIXES: Record<DocumentType, string> = {
  invoice: 'INV',
  receipt: 'REC',
  invoice_receipt: 'IR',
  credit_note: 'CN',
  price_offer: 'PO',
  proforma_invoice: 'PI',
  donation_receipt: 'DR',
};

const ALL_DOCUMENT_TYPES: DocumentType[] = [
  'invoice',
  'receipt',
  'invoice_receipt',
  'credit_note',
  'price_offer',
  'proforma_invoice',
  'donation_receipt',
];

export function SettingsPage() {
  const { data: settings, isLoading } = useSettings();
  const updateMutation = useUpdateSettings();
  const t = useT();
  const navigate = useNavigate();
  const { language, setLanguage } = useLanguage();
  const [exportStatus, setExportStatus] = useState<string>('');
  const [importStatus, setImportStatus] = useState<string>('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteSuccessMessage, setDeleteSuccessMessage] = useState<string>('');
  const { latestVersion, hasUpdate, isLoading: isCheckingUpdate, error: updateError } = useCheckForUpdates();

  // Business profiles
  const { data: businessProfiles = [] } = useBusinessProfiles();
  const { data: defaultProfile } = useDefaultBusinessProfile();
  const setDefaultMutation = useSetDefaultBusinessProfile();
  const archiveMutation = useArchiveBusinessProfile();
  const { openBusinessProfileDrawer } = useDrawerStore();

  // Document sequences (for the default business profile)
  const { data: sequences = [] } = useDocumentSequences(defaultProfile?.id || '');
  const updateSequenceMutation = useUpdateDocumentSequence();

  // Build a map of sequences by document type for easy access
  const sequenceMap = sequences.reduce((acc, seq) => {
    acc[seq.documentType] = seq;
    return acc;
  }, {} as Record<DocumentType, DocumentSequence>);

  // Handler for updating sequence settings
  const handleSequenceUpdate = (
    documentType: DocumentType,
    field: 'prefix' | 'prefixEnabled' | 'lastNumber',
    value: string | boolean | number
  ) => {
    if (!defaultProfile) return;

    const updates: Partial<DocumentSequence> = {};
    if (field === 'prefix') {
      updates.prefix = value as string;
    } else if (field === 'prefixEnabled') {
      updates.prefixEnabled = value as boolean;
    } else if (field === 'lastNumber') {
      // When user sets "next number", we store lastNumber = nextNumber - 1
      updates.lastNumber = Math.max(0, (value as number) - 1);
    }

    updateSequenceMutation.mutate({
      businessProfileId: defaultProfile.id,
      documentType,
      updates,
    });
  };

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

  const handleExportData = async () => {
    try {
      setExportStatus(t('settings.data.exporting'));

      const data = {
        clients: await db.clients.toArray(),
        projects: await db.projects.toArray(),
        categories: await db.categories.toArray(),
        transactions: await db.transactions.toArray(),
        fxRates: await db.fxRates.toArray(),
        settings: await db.settings.toArray(),
        exportedAt: new Date().toISOString(),
      };

      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mutaba3a-backup-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);

      setExportStatus(t('settings.data.exported'));
      setTimeout(() => setExportStatus(''), 3000);
    } catch (error) {
      setExportStatus(t('settings.data.exportFailed'));
      console.error('Export error:', error);
    }
  };

  const handleImportData = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        setImportStatus(t('settings.data.importing'));

        const text = await file.text();
        const data = JSON.parse(text);

        // Validate structure
        if (!data.clients || !data.projects || !data.transactions) {
          throw new Error(t('settings.data.invalidFile'));
        }

        // Clear and import
        await clearDatabase();

        if (data.clients.length) await db.clients.bulkAdd(data.clients);
        if (data.projects.length) await db.projects.bulkAdd(data.projects);
        if (data.categories.length) await db.categories.bulkAdd(data.categories);
        if (data.transactions.length) await db.transactions.bulkAdd(data.transactions);
        if (data.fxRates?.length) await db.fxRates.bulkAdd(data.fxRates);
        if (data.settings?.length) await db.settings.bulkAdd(data.settings);

        setImportStatus(t('settings.data.imported'));
        setTimeout(() => window.location.reload(), 1500);
      } catch (error) {
        setImportStatus(t('settings.data.importFailed', { error: error instanceof Error ? error.message : 'Unknown error' }));
        console.error('Import error:', error);
      }
    };

    input.click();
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
        <TopBar title={t('settings.title')} />
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
      <TopBar title={t('settings.title')} />
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
                      <div className="business-profile-name">
                        {profile.name}
                        {profile.nameEn && <span className="text-muted"> ({profile.nameEn})</span>}
                      </div>
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
                  <div className="business-profile-actions">
                    {!profile.isDefault && (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setDefaultMutation.mutate(profile.id)}
                        disabled={setDefaultMutation.isPending}
                      >
                        Set Default
                      </button>
                    )}
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => openBusinessProfileDrawer({ mode: 'edit', profileId: profile.id })}
                    >
                      Edit
                    </button>
                    {!profile.isDefault && (
                      <button
                        className="btn btn-ghost btn-sm text-danger"
                        onClick={() => {
                          if (confirm('Are you sure you want to archive this business profile?')) {
                            archiveMutation.mutate(profile.id);
                          }
                        }}
                        disabled={archiveMutation.isPending}
                      >
                        Archive
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Document Numbering */}
        {defaultProfile && (
          <div className="settings-section">
            <h3 className="settings-section-title">Document Numbering</h3>
            <p className="text-muted text-sm" style={{ marginBottom: 16 }}>
              Configure how document numbers are generated for each type. Settings apply to the default business profile.
            </p>

            <table className="settings-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'start', padding: '8px 12px', borderBottom: '1px solid var(--color-border)' }}>Type</th>
                  <th style={{ textAlign: 'start', padding: '8px 12px', borderBottom: '1px solid var(--color-border)' }}>Prefix</th>
                  <th style={{ textAlign: 'center', padding: '8px 12px', borderBottom: '1px solid var(--color-border)' }}>Use Prefix</th>
                  <th style={{ textAlign: 'end', padding: '8px 12px', borderBottom: '1px solid var(--color-border)' }}>Next #</th>
                </tr>
              </thead>
              <tbody>
                {ALL_DOCUMENT_TYPES.map((type) => {
                  const seq = sequenceMap[type];
                  const prefix = seq?.prefix || DEFAULT_PREFIXES[type];
                  const prefixEnabled = seq?.prefixEnabled ?? true;
                  const nextNumber = (seq?.lastNumber || 0) + 1;

                  return (
                    <tr key={type}>
                      <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)' }}>
                        {DOCUMENT_TYPE_LABELS[type]}
                      </td>
                      <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)' }}>
                        <input
                          type="text"
                          className="input input-sm"
                          style={{ width: 80 }}
                          value={prefix}
                          onChange={(e) => handleSequenceUpdate(type, 'prefix', e.target.value)}
                          placeholder={DEFAULT_PREFIXES[type]}
                          disabled={!prefixEnabled}
                        />
                      </td>
                      <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)', textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={prefixEnabled}
                          onChange={(e) => handleSequenceUpdate(type, 'prefixEnabled', e.target.checked)}
                        />
                      </td>
                      <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)', textAlign: 'end' }}>
                        <input
                          type="number"
                          className="input input-sm"
                          style={{ width: 80, textAlign: 'end' }}
                          min={1}
                          value={nextNumber}
                          onChange={(e) => handleSequenceUpdate(type, 'lastNumber', parseInt(e.target.value) || 1)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <p className="text-muted text-sm" style={{ marginTop: 12 }}>
              Example: {sequenceMap['invoice']?.prefixEnabled !== false
                ? `${sequenceMap['invoice']?.prefix || 'INV'}-${String((sequenceMap['invoice']?.lastNumber || 0) + 1).padStart(4, '0')}`
                : String((sequenceMap['invoice']?.lastNumber || 0) + 1).padStart(4, '0')}
            </p>
          </div>
        )}

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
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {exportStatus && <span className="text-sm text-muted">{exportStatus}</span>}
              <button className="btn btn-secondary" onClick={handleExportData}>
                {t('settings.data.exportBtn')}
              </button>
            </div>
          </div>

          <div className="settings-row">
            <div>
              <div className="settings-label">{t('settings.data.import')}</div>
              <div className="settings-description">{t('settings.data.importDesc')}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {importStatus && <span className="text-sm text-muted">{importStatus}</span>}
              <button className="btn btn-secondary" onClick={handleImportData}>
                {t('settings.data.importBtn')}
              </button>
            </div>
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
                href={FALLBACK_DOWNLOAD_CONFIG.mac.downloadUrl}
                className="btn btn-secondary"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('settings.desktopApp.downloadMac')}
              </a>
              <a
                href={FALLBACK_DOWNLOAD_CONFIG.windows.msiUrl}
                className="btn btn-secondary"
                target="_blank"
                rel="noopener noreferrer"
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
