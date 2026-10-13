import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { getRepositories, findMatchingProfile, type ProfileExportFile } from '../../db';
import { useT, useLanguage } from '../../lib/i18n';
import { useBusinessProfiles } from '../../hooks/useQueries';
import { parseCSV, generateImportTemplate, downloadTextFile } from '../../utils/csv';
import { validateCSVImport, type CSVValidationResult } from '../../utils/csvValidation';
import { CSVValidationPreview } from '../../components/csv/CSVValidationPreview';
import { Select } from '../../components/ui';
import { isFullBackup, hasLegacyRows, takePendingImport } from '../../lib/dataFiles';
import type { BusinessProfile } from '../../types';
import './ImportDataPage.css';

type ImportStep = 'select' | 'preview' | 'validate' | 'importing' | 'done' | 'error';
type ImportMode = 'create' | 'merge' | 'legacy';
type FileType = 'json' | 'csv';

interface FileData {
  version?: number;
  profileId?: string;
  profile?: BusinessProfile;
  documents?: unknown[];
  transactions?: unknown[];
  clients?: unknown[];
  projects?: unknown[];
  categories?: unknown[];
  fxRates?: unknown[];
  settings?: unknown[];
  documentSequences?: unknown[];
  exportedAt?: string;
}

interface CSVPreviewData {
  clients: number;
  projects: number;
  income: number;
  expenses: number;
}

export function ImportDataPage() {
  const t = useT();
  const { language } = useLanguage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data: existingProfiles = [], isSuccess: profilesLoaded } = useBusinessProfiles();

  const [step, setStep] = useState<ImportStep>('select');
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [fileType, setFileType] = useState<FileType>('json');
  const [csvPreview, setCsvPreview] = useState<CSVPreviewData | null>(null);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [csvValidationResults, setCsvValidationResults] = useState<CSVValidationResult[]>([]);
  const [selectedRowIndices, setSelectedRowIndices] = useState<number[]>([]);
  const [importMode, setImportMode] = useState<ImportMode>('create');
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [error, setError] = useState<string>('');
  const [importStats, setImportStats] = useState<{ profiles: number; transactions: number } | null>(null);

  const handleFileSelect = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const isCSV = file.name.toLowerCase().endsWith('.csv');

      setFileName(file.name);
      setFileType(isCSV ? 'csv' : 'json');

      if (isCSV) {
        // Parse CSV
        const rows = parseCSV(text);

        if (rows.length === 0) {
          setError('CSV file is empty');
          return;
        }

        // Count entities by type
        const preview: CSVPreviewData = {
          clients: rows.filter(r => r.type === 'client').length,
          projects: rows.filter(r => r.type === 'project').length,
          income: rows.filter(r => r.type === 'income').length,
          expenses: rows.filter(r => r.type === 'expense').length,
        };

        setCsvRows(rows);
        setCsvPreview(preview);
        setImportMode('create');
        setStep('preview');
        setError('');
      } else {
        // Parse JSON
        const data = JSON.parse(text) as FileData;

        // A full backup ({ version, tables }) is restored from Settings › Your
        // data › Restore; the legacy path below would clear the database and
        // restore nothing from it (review F5). Refuse anything with no rows.
        if (isFullBackup(data)) {
          setError(t('settings.import.fullBackup'));
          return;
        }
        if (!(data.version === 2 && data.profile) && !hasLegacyRows(data)) {
          setError(t('settings.import.nothingToImport'));
          return;
        }
        setFileData(data);

        if (data.version === 2 && data.profile) {
          const existingProfile = findMatchingProfile(existingProfiles, data as ProfileExportFile);
          if (existingProfile) {
            setSelectedProfileId(existingProfile.id);
            setImportMode('merge');
          } else {
            setImportMode('create');
          }
        } else {
          setImportMode('legacy');
        }

        setStep('preview');
        setError('');
      }
    } catch (err) {
      setError(`Failed to read file. Please select a valid ${file.name.endsWith('.csv') ? 'CSV' : 'JSON'} file.`);
      console.error('File read error:', err);
    }
  }, [existingProfiles, t]);

  // A file handed over from Settings › Your data › Restore (MUT-88). Taken
  // only once the profiles have loaded, so a one-business export is matched
  // against the real list (merge vs create), and taken once, so a remount
  // never re-imports it.
  useEffect(() => {
    if (!profilesLoaded) return;
    const file = takePendingImport();
    if (file) void handleFileSelect(file);
  }, [profilesLoaded, handleFileSelect]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.json') || file.name.endsWith('.csv'))) {
      handleFileSelect(file);
    } else {
      setError('Please drop a .json or .csv file');
    }
  }, [handleFileSelect]);

  const handleDownloadTemplate = useCallback(() => {
    const template = generateImportTemplate();
    downloadTextFile('mutaba3a-import-template.csv', template);
  }, []);

  const handleValidateCSV = useCallback(async () => {
    const { clientNames, projectNames } = await getRepositories().base.dataset.csvValidationContext();

    const results = validateCSVImport(csvRows, clientNames, projectNames);
    setCsvValidationResults(results);

    const validIndices = results
      .map((r, i) => (r.status !== 'error' ? i : -1))
      .filter(i => i !== -1);
    setSelectedRowIndices(validIndices);

    setStep('validate');
  }, [csvRows]);

  const handleImport = async () => {
    if (!fileData && csvRows.length === 0) return;

    setStep('importing');
    setError('');

    try {
      const stats = { profiles: 0, transactions: 0 };

      const { dataset } = getRepositories().base;

      if (fileType === 'csv') {
        const selectedRows = csvRows.filter((_, index) => selectedRowIndices.includes(index));
        const imported = await dataset.importCsvRows(selectedRows, { selectedProfileId, language });
        stats.transactions = imported.transactions;
      } else if ((importMode === 'create' || importMode === 'merge') && fileData?.version === 2 && fileData.profile) {
        // v2 per-profile export (MUT-158): fresh IDs, every link remapped.
        const target =
          importMode === 'create'
            ? { mode: 'create' as const, makeDefault: existingProfiles.length === 0 }
            : selectedProfileId
              ? { mode: 'merge' as const, profileId: selectedProfileId }
              : null;
        if (!target) throw new Error('Choose a profile to merge into');
        const imported = await dataset.importProfile(fileData as ProfileExportFile, target);
        stats.profiles = imported.profiles;
        stats.transactions = imported.transactions;
      } else if (importMode === 'legacy' && fileData) {
        // Never clear the database for a file that brings nothing back.
        if (!hasLegacyRows(fileData)) throw new Error(t('settings.import.nothingToImport'));
        const imported = await dataset.importLegacyV1(fileData);
        stats.transactions = imported.transactions;
      }

      // Switch on the optional areas the imported data belongs to (MUT-12)
      await dataset.reconcileFeaturesAfterLoad('import');

      setImportStats(stats);
      await queryClient.invalidateQueries();
      setStep('done');
    } catch (err) {
      console.error('Import error:', err);
      setError(err instanceof Error ? err.message : 'Import failed');
      setStep('error');
    }
  };

  const isV2Format = fileData?.version === 2;
  const profileName = fileData?.profile?.name || fileData?.profile?.nameEn || 'Unknown';

  return (
    <div className="import-data-page">
      <div className="page-header">
        <button className="btn btn-text" onClick={() => navigate({ to: '/settings' })}>
          ← Back to Settings
        </button>
        <h1>Import Data</h1>
      </div>

      <div className="import-content">
        {step === 'select' && (
          <div className="import-step-select">
            <div
              className="import-dropzone"
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
            >
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <h3>Drop a .json or .csv file here</h3>
              <p>or click to select a file</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,.csv"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileSelect(file);
                }}
              />
              {error && <p className="text-danger">{error}</p>}
            </div>

            <div className="import-actions">
              <button className="btn btn-secondary" onClick={handleDownloadTemplate}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                {t('settings.data.downloadTemplate') || 'Download CSV Template'}
              </button>
            </div>

            <div className="import-help">
              <h4>Need help?</h4>
              <ul>
                <li><strong>CSV Import:</strong> Download the template, fill it with your data, and upload it back.</li>
                <li><strong>JSON Import:</strong> Use exported backup files from this app.</li>
              </ul>
            </div>
          </div>
        )}

        {step === 'preview' && (fileData || csvPreview) && (
          <div className="import-step-preview">
            <div className="import-file-info">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                <polyline points="13 2 13 9 20 9" />
              </svg>
              <div>
                <div className="file-name">{fileName}</div>
                <div className="file-meta">
                  {fileType === 'csv' && csvPreview ? (
                    <>
                      CSV Import: {csvPreview.clients} clients, {csvPreview.projects} projects,{' '}
                      {csvPreview.income} income, {csvPreview.expenses} expenses
                    </>
                  ) : isV2Format ? (
                    <>Profile: {profileName}</>
                  ) : (
                    <>Legacy format (all data)</>
                  )}
                  {fileData?.exportedAt && (
                    <> · Exported: {new Date(fileData.exportedAt).toLocaleDateString()}</>
                  )}
                </div>
              </div>
            </div>

            {isV2Format && (
              <div className="import-mode-select" role="radiogroup" aria-label={t('settings.import.mode.title')}>
                <h4>{t('settings.import.mode.title')}</h4>
                <label className="import-mode-option">
                  <input
                    type="radio"
                    name="importMode"
                    checked={importMode === 'create'}
                    onChange={() => setImportMode('create')}
                  />
                  <div>
                    <div className="import-mode-label">{t('settings.import.mode.create')}</div>
                    <div className="import-mode-desc text-muted text-sm">{t('settings.import.mode.createDesc')}</div>
                  </div>
                </label>
                {existingProfiles.length > 0 && (
                  <label className="import-mode-option">
                    <input
                      type="radio"
                      name="importMode"
                      checked={importMode === 'merge'}
                      onChange={() => setImportMode('merge')}
                    />
                    <div>
                      <div className="import-mode-label">{t('settings.import.mode.merge')}</div>
                      <div className="import-mode-desc text-muted text-sm">{t('settings.import.mode.mergeDesc')}</div>
                    </div>
                  </label>
                )}
                {importMode === 'merge' && (
                  <div className="import-profile-select">
                    <Select
                      aria-label={t('settings.import.mode.selectProfile')}
                      value={selectedProfileId || ''}
                      onChange={(e) => setSelectedProfileId(e.target.value)}
                    >
                      <option value="">{t('settings.import.mode.selectProfile')}</option>
                      {existingProfiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} {p.nameEn && `(${p.nameEn})`}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
              </div>
            )}

            {fileType === 'csv' && existingProfiles.length > 0 && (
              <div className="profile-select-section">
                <h4>Select Business Profile</h4>
                <Select
                  value={selectedProfileId || ''}
                  onChange={(e) => setSelectedProfileId(e.target.value)}
                >
                  <option value="">Select a profile...</option>
                  {existingProfiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.nameEn && `(${p.nameEn})`}
                    </option>
                  ))}
                </Select>
                <p className="help-text">
                  Choose which business profile to associate imported data with
                </p>
              </div>
            )}

            {!isV2Format && fileType === 'json' && (
              <div className="import-warning">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <p>This is a legacy backup file. Importing will replace all existing data.</p>
              </div>
            )}

            {fileType === 'csv' && (
              <div className="import-info">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                <p>
                  <strong>CSV Import:</strong> New data will be added without replacing existing records.
                  Clients and projects are matched by name.
                </p>
              </div>
            )}

            {error && <p className="text-danger">{error}</p>}

            <div className="import-actions">
              <button className="btn btn-secondary" onClick={() => setStep('select')}>
                Choose Different File
              </button>
              {fileType === 'json' && (
                <button
                  className="btn btn-primary"
                  onClick={handleImport}
                  disabled={importMode === 'merge' && !selectedProfileId}
                >
                  Import JSON
                </button>
              )}
              {fileType === 'csv' && (
                <button
                  className="btn btn-primary"
                  onClick={handleValidateCSV}
                  disabled={existingProfiles.length > 0 && !selectedProfileId}
                >
                  Next: Validate Data
                </button>
              )}
            </div>
          </div>
        )}

        {step === 'validate' && (
          <div className="import-step-validate">
            <h2>Validate CSV Data</h2>
            <CSVValidationPreview
              results={csvValidationResults}
              onSelectionChange={setSelectedRowIndices}
            />
            <div className="import-actions">
              <button className="btn btn-secondary" onClick={() => setStep('preview')}>
                ← Back
              </button>
              <button
                className="btn btn-primary"
                onClick={handleImport}
                disabled={selectedRowIndices.length === 0}
              >
                Import {selectedRowIndices.length} Row{selectedRowIndices.length !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        )}

        {step === 'importing' && (
          <div className="import-step-importing">
            <div className="spinner" />
            <h3>Importing data...</h3>
            <p>Please wait while we process your data.</p>
          </div>
        )}

        {step === 'done' && (
          <div className="import-step-done">
            <svg className="success-icon" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <h2>Import Complete!</h2>
            <p>
              {importStats && (
                <>
                  Imported {importStats.profiles > 0 && `${importStats.profiles} profile, `}
                  {importStats.transactions > 0 && `${importStats.transactions} transactions`}
                </>
              )}
            </p>
            <div className="import-actions">
              <button className="btn btn-secondary" onClick={() => setStep('select')}>
                Import More Data
              </button>
              <button className="btn btn-primary" onClick={() => navigate({ to: '/settings' })}>
                Back to Settings
              </button>
            </div>
          </div>
        )}

        {step === 'error' && (
          <div className="import-step-error">
            <svg className="error-icon" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
            <h2>Import Failed</h2>
            <p className="text-danger">{error}</p>
            <div className="import-actions">
              <button className="btn btn-secondary" onClick={() => setStep('select')}>
                Try Again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
