import { useState } from 'react';
import { useNavigate, Link } from '@tanstack/react-router';
import { TopBar } from '../../components/layout';
import { useSettings, useUpdateSettings } from '../../hooks/useQueries';
import { db } from '../../db';
import { clearDatabase } from '../../db/seed';
import { useT, useLanguage } from '../../lib/i18n';
import { DeleteAllDataModal } from '../../components/modals';
import { useCheckForUpdates, DOWNLOAD_CONFIG } from '../../hooks/useCheckForUpdates';
import type { Currency } from '../../types';
import type { Language } from '../../lib/i18n/types';

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
                  {t('settings.updates.currentVersion')}: <span className="update-banner-version">{DOWNLOAD_CONFIG.version}</span>
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
                  {t('settings.updates.currentVersion')}: <span style={{ fontFamily: 'var(--font-mono)' }}>{DOWNLOAD_CONFIG.version}</span>
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
            <Link to="/download" className="btn btn-secondary">
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
