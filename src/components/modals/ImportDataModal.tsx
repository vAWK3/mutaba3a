import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { db } from '../../db';
import { clearDatabase } from '../../db/seed';
import { useT } from '../../lib/i18n';
import { useBusinessProfiles } from '../../hooks/useQueries';
import { parseCSV, generateImportTemplate, downloadTextFile } from '../../utils/csv';
import { validateCSVImport, type CSVValidationResult } from '../../utils/csvValidation';
import { CSVValidationPreview } from '../csv/CSVValidationPreview';
import type { BusinessProfile } from '../../types';
import './DeleteAllDataModal.css';

interface ImportDataModalProps {
  onClose: () => void;
  onSuccess?: () => void;
}

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

export function ImportDataModal({ onClose, onSuccess }: ImportDataModalProps) {
  const t = useT();
  const queryClient = useQueryClient();
  const modalRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data: existingProfiles = [] } = useBusinessProfiles();

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
  const [importStats, setImportStats] = useState<{ profiles: number; documents: number; transactions: number } | null>(null);

  // Handle ESC key
  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  // Focus trap
  useEffect(() => {
    const modal = modalRef.current;
    if (modal) {
      modal.focus();
    }
  }, []);

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
        setImportMode('create'); // CSV always creates new data
        setStep('preview');
        setError('');
      } else {
        // Parse JSON
        const data = JSON.parse(text) as FileData;
        setFileData(data);

        // Determine if v2 (profile-scoped) or v1 (legacy)
        if (data.version === 2 && data.profile) {
          // Check if profile already exists
          const existingProfile = existingProfiles.find(
            (p) => p.id === data.profileId || p.email === data.profile?.email
          );
          if (existingProfile) {
            setSelectedProfileId(existingProfile.id);
            setImportMode('merge');
          } else {
            setImportMode('create');
          }
        } else {
          // Legacy format
          setImportMode('legacy');
        }

        setStep('preview');
        setError('');
      }
    } catch (err) {
      setError(`Failed to read file. Please select a valid ${file.name.endsWith('.csv') ? 'CSV' : 'JSON'} file.`);
      console.error('File read error:', err);
    }
  }, [existingProfiles]);

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
    // Get existing clients and projects for duplicate detection
    const existingClients = await db.clients.toArray();
    const existingProjects = await db.projects.toArray();

    const clientNames = existingClients.map(c => c.name);
    const projectNames = existingProjects.map(p => p.name);

    // Validate all rows
    const results = validateCSVImport(csvRows, clientNames, projectNames);
    setCsvValidationResults(results);

    // Auto-select valid rows
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
      const stats = { profiles: 0, documents: 0, transactions: 0 };

      if (fileType === 'csv') {
        // CSV import - only import selected rows
        const selectedRows = csvRows.filter((_, index) => selectedRowIndices.includes(index));

        // Maps to track name -> ID for resolving references
        const clientNameToId = new Map<string, string>();
        const projectNameToId = new Map<string, string>();

        // Group selected rows by type
        const clientRows = selectedRows.filter(r => r.type === 'client');
        const projectRows = selectedRows.filter(r => r.type === 'project');
        const incomeRows = selectedRows.filter(r => r.type === 'income');
        const expenseRows = selectedRows.filter(r => r.type === 'expense');

        // 1. Import clients first
        for (const row of clientRows) {
          if (!row.name) continue;

          // Check if client exists by name
          const existing = await db.clients.where('name').equals(row.name).first();

          if (existing) {
            // Use existing client
            clientNameToId.set(row.name, existing.id);
          } else {
            // Create new client
            const clientId = crypto.randomUUID();
            await db.clients.add({
              id: clientId,
              name: row.name,
              email: row.email || undefined,
              phone: row.phone || undefined,
              notes: row.notes || undefined,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
            clientNameToId.set(row.name, clientId);
          }
        }

        // 2. Import projects second
        for (const row of projectRows) {
          if (!row.name) continue;

          // Resolve client reference
          const clientId = row.client ? clientNameToId.get(row.client) : undefined;

          // Check if project exists by name
          const existing = await db.projects.where('name').equals(row.name).first();

          if (existing) {
            // Use existing project
            projectNameToId.set(row.name, existing.id);
          } else {
            // Create new project
            const projectId = crypto.randomUUID();
            await db.projects.add({
              id: projectId,
              name: row.name,
              clientId,
              field: row.field || undefined,
              notes: row.notes || undefined,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
            projectNameToId.set(row.name, projectId);
          }
        }

        // 3. Import income transactions
        for (const row of incomeRows) {
          if (!row.amount || !row.currency || !row.date) continue;

          const clientId = row.client ? clientNameToId.get(row.client) : undefined;
          const projectId = row.project ? projectNameToId.get(row.project) : undefined;

          const amountMinor = Math.round(parseFloat(row.amount) * 100);
          const status = row.status === 'paid' ? 'paid' : 'unpaid';

          await db.transactions.add({
            id: crypto.randomUUID(),
            kind: 'income',
            status,
            title: row.name || 'Income',
            clientId,
            projectId,
            amountMinor,
            currency: row.currency as 'USD' | 'ILS' | 'EUR',
            occurredAt: row.date,
            dueDate: row.dueDate || undefined,
            paidAt: row.paidAt || (status === 'paid' ? row.date : undefined),
            notes: row.notes || undefined,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          stats.transactions++;
        }

        // 4. Import expense transactions
        for (const row of expenseRows) {
          if (!row.amount || !row.currency || !row.date) continue;

          const clientId = row.client ? clientNameToId.get(row.client) : undefined;
          const projectId = row.project ? projectNameToId.get(row.project) : undefined;

          const amountMinor = Math.round(parseFloat(row.amount) * 100);

          // Find or create category
          let categoryId: string | undefined;
          if (row.category) {
            const existingCategory = await db.categories.where('name').equals(row.category).first();
            if (existingCategory) {
              categoryId = existingCategory.id;
            } else {
              categoryId = crypto.randomUUID();
              await db.categories.add({
                id: categoryId,
                kind: 'expense',
                name: row.category,
              });
            }
          }

          await db.transactions.add({
            id: crypto.randomUUID(),
            kind: 'expense',
            status: 'paid',
            title: row.name || 'Expense',
            clientId,
            projectId,
            categoryId,
            amountMinor,
            currency: row.currency as 'USD' | 'ILS' | 'EUR',
            occurredAt: row.date,
            notes: row.notes || undefined,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          stats.transactions++;
        }
      } else if (importMode === 'legacy' && fileData) {
        // Legacy import - clear and import all data
        await clearDatabase();

        if (fileData.clients?.length) {
          await db.clients.bulkAdd(fileData.clients as Parameters<typeof db.clients.bulkAdd>[0]);
        }
        if (fileData.projects?.length) {
          await db.projects.bulkAdd(fileData.projects as Parameters<typeof db.projects.bulkAdd>[0]);
        }
        if (fileData.categories?.length) {
          await db.categories.bulkAdd(fileData.categories as Parameters<typeof db.categories.bulkAdd>[0]);
        }
        if (fileData.transactions?.length) {
          await db.transactions.bulkAdd(fileData.transactions as Parameters<typeof db.transactions.bulkAdd>[0]);
          stats.transactions = fileData.transactions.length;
        }
        if (fileData.fxRates?.length) {
          await db.fxRates.bulkAdd(fileData.fxRates as Parameters<typeof db.fxRates.bulkAdd>[0]);
        }
        if (fileData.settings?.length) {
          await db.settings.bulkAdd(fileData.settings as Parameters<typeof db.settings.bulkAdd>[0]);
        }
      } else if (importMode === 'create' && fileData && fileData.profile) {
        // Create new profile with new ID
        const newProfileId = crypto.randomUUID();
        const profile = {
          ...fileData.profile,
          id: newProfileId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          isDefault: existingProfiles.length === 0, // Make default if no other profiles
        };
        await db.businessProfiles.add(profile);
        stats.profiles = 1;

        // Import documents with new profile ID
        if (fileData.documents?.length) {
          const documents = (fileData.documents as unknown as Record<string, unknown>[]).map((doc) => ({
            ...doc,
            id: crypto.randomUUID(),
            businessProfileId: newProfileId,
          }));
          await db.documents.bulkAdd(documents as unknown as Parameters<typeof db.documents.bulkAdd>[0]);
          stats.documents = documents.length;
        }

        // Import document sequences with new profile ID
        if (fileData.documentSequences?.length) {
          const sequences = (fileData.documentSequences as unknown as Record<string, unknown>[]).map((seq) => ({
            ...seq,
            id: `${newProfileId}:${seq.documentType}`,
            businessProfileId: newProfileId,
          }));
          await db.documentSequences.bulkAdd(sequences as unknown as Parameters<typeof db.documentSequences.bulkAdd>[0]);
        }

        // Import clients (check for duplicates by email)
        if (fileData.clients?.length) {
          for (const client of fileData.clients as { id: string; email?: string }[]) {
            // Use filter instead of where since email is not indexed
            const existing = client.email
              ? await db.clients.filter(c => c.email === client.email).first()
              : null;
            if (!existing) {
              await db.clients.add({ ...client, id: crypto.randomUUID() } as Parameters<typeof db.clients.add>[0]);
            }
          }
        }

        // Import projects (check for duplicates by name)
        if (fileData.projects?.length) {
          for (const project of fileData.projects as { id: string; name: string }[]) {
            const existing = await db.projects.where('name').equals(project.name).first();
            if (!existing) {
              await db.projects.add({ ...project, id: crypto.randomUUID() } as Parameters<typeof db.projects.add>[0]);
            }
          }
        }

        // Import transactions with new IDs
        if (fileData.transactions?.length) {
          const transactions = (fileData.transactions as unknown as Record<string, unknown>[]).map((tx) => ({
            ...tx,
            id: crypto.randomUUID(),
          }));
          await db.transactions.bulkAdd(transactions as unknown as Parameters<typeof db.transactions.bulkAdd>[0]);
          stats.transactions = transactions.length;
        }

        // Import FX rates
        if (fileData.fxRates?.length) {
          for (const rate of fileData.fxRates as { id: string }[]) {
            try {
              await db.fxRates.add({ ...rate, id: crypto.randomUUID() } as Parameters<typeof db.fxRates.add>[0]);
            } catch {
              // Skip duplicates
            }
          }
        }
      } else if (importMode === 'merge' && selectedProfileId && fileData) {
        // Merge into existing profile
        // Update profile fields
        if (fileData.profile) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { id: _id, createdAt: _createdAt, ...profileUpdates } = fileData.profile;
          await db.businessProfiles.update(selectedProfileId, {
            ...profileUpdates,
            updatedAt: new Date().toISOString(),
          });
          stats.profiles = 1;
        }

        // Import documents with existing profile ID
        if (fileData.documents?.length) {
          const documents = (fileData.documents as unknown as Record<string, unknown>[]).map((doc) => ({
            ...doc,
            id: crypto.randomUUID(),
            businessProfileId: selectedProfileId,
          }));
          await db.documents.bulkAdd(documents as unknown as Parameters<typeof db.documents.bulkAdd>[0]);
          stats.documents = documents.length;
        }

        // Import transactions with new IDs
        if (fileData.transactions?.length) {
          const transactions = (fileData.transactions as unknown as Record<string, unknown>[]).map((tx) => ({
            ...tx,
            id: crypto.randomUUID(),
          }));
          await db.transactions.bulkAdd(transactions as unknown as Parameters<typeof db.transactions.bulkAdd>[0]);
          stats.transactions = transactions.length;
        }
      }

      // Invalidate all queries
      queryClient.invalidateQueries();

      setImportStats(stats);
      setStep('done');

      if (onSuccess) {
        onSuccess();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
      setStep('error');
      console.error('Import error:', err);
    }
  };

  const isV2Format = fileData?.version === 2 && fileData?.profile;
  const profileName = fileData?.profile?.name || fileData?.profile?.nameEn || 'Unknown';

  return createPortal(
    <>
      <div className="modal-overlay" onClick={onClose} />
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        ref={modalRef}
        tabIndex={-1}
        style={{ maxWidth: 520 }}
      >
        <div className="modal-header">
          <h2 id="modal-title" className="modal-title">
            {t('settings.data.import')}
          </h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>

        <div className="modal-body">
          {step === 'select' && (
            <>
              <div
                className="import-dropzone"
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
              >
                <UploadIcon />
                <p>Drop a .json or .csv file here or click to select</p>
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
                {error && <p className="text-danger text-sm">{error}</p>}
              </div>
              <div style={{ marginTop: '1rem', textAlign: 'center' }}>
                <button
                  className="btn btn-secondary"
                  onClick={handleDownloadTemplate}
                  style={{ fontSize: '0.875rem' }}
                >
                  {t('settings.data.downloadTemplate') || 'Download CSV Template'}
                </button>
              </div>
            </>
          )}

          {step === 'preview' && (fileData || csvPreview) && (
            <>
              <div className="import-file-info">
                <FileIcon />
                <div>
                  <div className="import-file-name">{fileName}</div>
                  <div className="import-file-meta text-muted text-sm">
                    {fileType === 'csv' && csvPreview ? (
                      <>
                        CSV Import: {csvPreview.clients} clients, {csvPreview.projects} projects, {csvPreview.income} income, {csvPreview.expenses} expenses
                      </>
                    ) : isV2Format ? (
                      <>Profile: {profileName}</>
                    ) : (
                      <>Legacy format (all data)</>
                    )}
                    {fileData?.exportedAt && (
                      <> &middot; Exported: {new Date(fileData.exportedAt).toLocaleDateString()}</>
                    )}
                  </div>
                </div>
              </div>

              {fileType === 'csv' && existingProfiles.length > 0 && (
                <div className="import-mode-select">
                  <h4>Select Business Profile</h4>
                  <div className="import-profile-select">
                    <select
                      className="select"
                      value={selectedProfileId || ''}
                      onChange={(e) => setSelectedProfileId(e.target.value)}
                    >
                      <option value="">Select a profile...</option>
                      {existingProfiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} {p.nameEn && `(${p.nameEn})`}
                        </option>
                      ))}
                    </select>
                    <div className="text-muted text-sm" style={{ marginTop: '0.5rem' }}>
                      Choose which business profile to associate imported data with
                    </div>
                  </div>
                </div>
              )}

              {isV2Format && fileData && (
                <div className="import-mode-select">
                  <h4>Import Options</h4>
                  <label className="import-mode-option">
                    <input
                      type="radio"
                      name="importMode"
                      checked={importMode === 'create'}
                      onChange={() => setImportMode('create')}
                    />
                    <div>
                      <div className="import-mode-label">Create new profile</div>
                      <div className="import-mode-desc text-muted text-sm">
                        Import as a new business profile with a new ID
                      </div>
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
                        <div className="import-mode-label">Merge into existing profile</div>
                        <div className="import-mode-desc text-muted text-sm">
                          Add documents and transactions to an existing profile
                        </div>
                      </div>
                    </label>
                  )}

                  {importMode === 'merge' && (
                    <div className="import-profile-select">
                      <select
                        className="select"
                        value={selectedProfileId || ''}
                        onChange={(e) => setSelectedProfileId(e.target.value)}
                      >
                        <option value="">Select a profile...</option>
                        {existingProfiles.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} {p.nameEn && `(${p.nameEn})`}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}

              {!isV2Format && fileType === 'json' && (
                <div className="modal-warning">
                  <WarningIcon />
                  <p>This is a legacy backup file. Importing will replace all existing data.</p>
                </div>
              )}

              {fileType === 'csv' && (
                <div className="modal-info" style={{ padding: '1rem', backgroundColor: '#e0f2fe', borderRadius: '0.5rem', marginTop: '1rem' }}>
                  <p style={{ margin: 0, color: '#075985', fontSize: '0.875rem' }}>
                    <strong>CSV Import:</strong> New data will be added without replacing existing records. Clients and projects are matched by name.
                  </p>
                </div>
              )}

              {error && <p className="text-danger text-sm">{error}</p>}
            </>
          )}

          {step === 'validate' && (
            <>
              <h3 style={{ marginBottom: '1rem' }}>Validate CSV Data</h3>
              <CSVValidationPreview
                results={csvValidationResults}
                onSelectionChange={setSelectedRowIndices}
              />
            </>
          )}

          {step === 'importing' && (
            <div className="import-progress">
              <div className="spinner" />
              <p>Importing data...</p>
            </div>
          )}

          {step === 'done' && (
            <div className="export-success">
              <CheckCircleIcon />
              <h3>Import Complete</h3>
              <p>
                {importStats && (
                  <>
                    Imported {importStats.profiles > 0 && `${importStats.profiles} profile, `}
                    {importStats.documents > 0 && `${importStats.documents} documents, `}
                    {importStats.transactions > 0 && `${importStats.transactions} transactions`}
                  </>
                )}
              </p>
              <button className="btn btn-primary" onClick={onClose}>
                Close
              </button>
            </div>
          )}

          {step === 'error' && (
            <div className="import-error">
              <ErrorIcon />
              <h3>Import Failed</h3>
              <p className="text-danger">{error}</p>
              <button className="btn btn-secondary" onClick={() => setStep('select')}>
                Try Again
              </button>
            </div>
          )}
        </div>

        {(step === 'select' || step === 'preview' || step === 'validate') && (
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={onClose}>
              {t('common.cancel')}
            </button>
            {step === 'preview' && fileType === 'json' && (
              <button
                className="btn btn-primary"
                onClick={handleImport}
                disabled={importMode === 'merge' && !selectedProfileId}
              >
                Import JSON
              </button>
            )}
            {step === 'preview' && fileType === 'csv' && (
              <button
                className="btn btn-primary"
                onClick={handleValidateCSV}
                disabled={existingProfiles.length > 0 && !selectedProfileId}
              >
                Next: Validate
              </button>
            )}
            {step === 'validate' && (
              <>
                <button className="btn btn-secondary" onClick={() => setStep('preview')}>
                  Back
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleImport}
                  disabled={selectedRowIndices.length === 0}
                >
                  Import {selectedRowIndices.length} Row{selectedRowIndices.length !== 1 ? 's' : ''}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </>,
    document.body
  );
}

function XIcon() {
  return (
    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="var(--color-muted)" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
      />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="var(--color-success)" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="var(--color-error)" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
    </svg>
  );
}
