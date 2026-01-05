import { useState } from 'react';
import { TopBar } from '../../components/layout';
import { useSettings, useUpdateSettings } from '../../hooks/useQueries';
import { db } from '../../db';
import { seedDatabase, clearDatabase } from '../../db/seed';
import type { Currency } from '../../types';

export function SettingsPage() {
  const { data: settings, isLoading } = useSettings();
  const updateMutation = useUpdateSettings();
  const [exportStatus, setExportStatus] = useState<string>('');
  const [importStatus, setImportStatus] = useState<string>('');

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
      setExportStatus('Exporting...');

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

      setExportStatus('Exported successfully!');
      setTimeout(() => setExportStatus(''), 3000);
    } catch (error) {
      setExportStatus('Export failed');
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
        setImportStatus('Importing...');

        const text = await file.text();
        const data = JSON.parse(text);

        // Validate structure
        if (!data.clients || !data.projects || !data.transactions) {
          throw new Error('Invalid backup file format');
        }

        // Clear and import
        await clearDatabase();

        if (data.clients.length) await db.clients.bulkAdd(data.clients);
        if (data.projects.length) await db.projects.bulkAdd(data.projects);
        if (data.categories.length) await db.categories.bulkAdd(data.categories);
        if (data.transactions.length) await db.transactions.bulkAdd(data.transactions);
        if (data.fxRates?.length) await db.fxRates.bulkAdd(data.fxRates);
        if (data.settings?.length) await db.settings.bulkAdd(data.settings);

        setImportStatus('Imported successfully! Refreshing...');
        setTimeout(() => window.location.reload(), 1500);
      } catch (error) {
        setImportStatus('Import failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
        console.error('Import error:', error);
      }
    };

    input.click();
  };

  const handleResetData = async () => {
    if (!confirm('This will delete all data and reset with sample data. Are you sure?')) return;

    try {
      await clearDatabase();
      await seedDatabase();
      window.location.reload();
    } catch (error) {
      console.error('Reset error:', error);
    }
  };

  if (isLoading) {
    return (
      <>
        <TopBar title="Settings" />
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
      <TopBar title="Settings" />
      <div className="page-content" style={{ maxWidth: 600 }}>
        {/* Currency Settings */}
        <div className="settings-section">
          <h3 className="settings-section-title">Currency</h3>

          <div className="settings-row">
            <div>
              <div className="settings-label">Enabled Currencies</div>
              <div className="settings-description">Select which currencies to track</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['USD', 'ILS'] as Currency[]).map((currency) => (
                <button
                  key={currency}
                  className={`btn btn-sm ${settings?.enabledCurrencies.includes(currency) ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => handleCurrencyToggle(currency)}
                >
                  {currency}
                </button>
              ))}
            </div>
          </div>

          <div className="settings-row">
            <div>
              <div className="settings-label">Default Currency</div>
              <div className="settings-description">Default selection in filters</div>
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
          <h3 className="settings-section-title">Data Management</h3>

          <div className="settings-row">
            <div>
              <div className="settings-label">Export Data</div>
              <div className="settings-description">Download a backup of all your data</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {exportStatus && <span className="text-sm text-muted">{exportStatus}</span>}
              <button className="btn btn-secondary" onClick={handleExportData}>
                Export JSON
              </button>
            </div>
          </div>

          <div className="settings-row">
            <div>
              <div className="settings-label">Import Data</div>
              <div className="settings-description">Restore from a backup file (replaces all data)</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {importStatus && <span className="text-sm text-muted">{importStatus}</span>}
              <button className="btn btn-secondary" onClick={handleImportData}>
                Import JSON
              </button>
            </div>
          </div>

          <div className="settings-row" style={{ borderTop: '1px solid var(--color-border)', paddingTop: 16, marginTop: 8 }}>
            <div>
              <div className="settings-label text-danger">Reset Data</div>
              <div className="settings-description">Delete all data and load sample data</div>
            </div>
            <button className="btn btn-danger" onClick={handleResetData}>
              Reset to Sample Data
            </button>
          </div>
        </div>

        {/* About */}
        <div className="settings-section">
          <h3 className="settings-section-title">About</h3>
          <div className="text-muted">
            <p>Mutaba3a - Mini CRM</p>
            <p className="text-sm" style={{ marginTop: 8 }}>
              A local-first financial tracking tool for freelancers and small businesses.
              Your data is stored locally in your browser using IndexedDB.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
