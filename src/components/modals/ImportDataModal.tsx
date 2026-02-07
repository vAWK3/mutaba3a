import { useState, useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { db } from '../../db';
import { clearDatabase } from '../../db/seed';
import { useT } from '../../lib/i18n';
import { useBusinessProfiles } from '../../hooks/useQueries';
import type { BusinessProfile } from '../../types';
import './DeleteAllDataModal.css';

interface ImportDataModalProps {
  onClose: () => void;
  onSuccess?: () => void;
}

type ImportStep = 'select' | 'preview' | 'importing' | 'done' | 'error';
type ImportMode = 'create' | 'merge' | 'legacy';

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

export function ImportDataModal({ onClose, onSuccess }: ImportDataModalProps) {
  const t = useT();
  const queryClient = useQueryClient();
  const modalRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data: existingProfiles = [] } = useBusinessProfiles();

  const [step, setStep] = useState<ImportStep>('select');
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [fileName, setFileName] = useState<string>('');
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
      const data = JSON.parse(text) as FileData;

      setFileName(file.name);
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
    } catch (err) {
      setError('Failed to read file. Please select a valid JSON file.');
      console.error('File read error:', err);
    }
  }, [existingProfiles]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.json')) {
      handleFileSelect(file);
    } else {
      setError('Please drop a .json file');
    }
  }, [handleFileSelect]);

  const handleImport = async () => {
    if (!fileData) return;

    setStep('importing');
    setError('');

    try {
      const stats = { profiles: 0, documents: 0, transactions: 0 };

      if (importMode === 'legacy') {
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
      } else if (importMode === 'create' && fileData.profile) {
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
            const existing = client.email
              ? await db.clients.where('email').equals(client.email).first()
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
      } else if (importMode === 'merge' && selectedProfileId) {
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

  return (
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
            <div
              className="import-dropzone"
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
            >
              <UploadIcon />
              <p>Drop a .json file here or click to select</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileSelect(file);
                }}
              />
              {error && <p className="text-danger text-sm">{error}</p>}
            </div>
          )}

          {step === 'preview' && fileData && (
            <>
              <div className="import-file-info">
                <FileIcon />
                <div>
                  <div className="import-file-name">{fileName}</div>
                  <div className="import-file-meta text-muted text-sm">
                    {isV2Format ? (
                      <>Profile: {profileName}</>
                    ) : (
                      <>Legacy format (all data)</>
                    )}
                    {fileData.exportedAt && (
                      <> &middot; Exported: {new Date(fileData.exportedAt).toLocaleDateString()}</>
                    )}
                  </div>
                </div>
              </div>

              {isV2Format && (
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

              {!isV2Format && (
                <div className="modal-warning">
                  <WarningIcon />
                  <p>This is a legacy backup file. Importing will replace all existing data.</p>
                </div>
              )}

              {error && <p className="text-danger text-sm">{error}</p>}
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

        {(step === 'select' || step === 'preview') && (
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={onClose}>
              {t('common.cancel')}
            </button>
            {step === 'preview' && (
              <button
                className="btn btn-primary"
                onClick={handleImport}
                disabled={importMode === 'merge' && !selectedProfileId}
              >
                Import
              </button>
            )}
          </div>
        )}
      </div>
    </>
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
