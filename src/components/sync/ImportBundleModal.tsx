/**
 * Import Bundle Modal
 *
 * Modal for importing a sync bundle with passphrase decryption.
 */

import { useState, useRef, useCallback } from 'react';
import { useSyncStore } from '../../sync/stores/syncStore';
import {
  readBundleFile,
  previewBundle,
  importBundle,
  isMsyncFile,
  type ImportPreview,
  type ImportResult,
} from '../../sync/transport/bundle-encoder';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import './ExportBundleModal.css';

type Step = 'select' | 'decrypt' | 'preview' | 'success';

export function ImportBundleModal() {
  const isOpen = useSyncStore((s) => s.isImportModalOpen);
  const closeModal = useSyncStore((s) => s.closeImportModal);
  const refreshCounts = useSyncStore((s) => s.refreshCounts);

  const [step, setStep] = useState<Step>('select');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileData, setFileData] = useState<ArrayBuffer | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetState = useCallback(() => {
    setStep('select');
    setSelectedFile(null);
    setFileData(null);
    setPassphrase('');
    setShowPassphrase(false);
    setIsLoading(false);
    setError(null);
    setPreview(null);
    setResult(null);
    setIsDragActive(false);
  }, []);

  const handleClose = () => {
    resetState();
    closeModal();
  };

  const handleFileSelect = async (file: File) => {
    setError(null);

    if (!isMsyncFile(file.name)) {
      setError('Please select a .msync file');
      return;
    }

    try {
      const data = await readBundleFile(file);
      setSelectedFile(file);
      setFileData(data);
      setStep('decrypt');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read file');
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragActive(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragActive(false);
  }, []);

  const handleDecrypt = async () => {
    if (!fileData || !passphrase) return;

    setIsLoading(true);
    setError(null);

    try {
      const previewData = await previewBundle(fileData, passphrase);
      setPreview(previewData);
      setStep('preview');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to decrypt bundle';
      if (message.includes('decrypt') || message.includes('passphrase')) {
        setError('Incorrect passphrase. Please try again.');
      } else {
        setError(message);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleImport = async () => {
    if (!fileData || !passphrase) return;

    setIsLoading(true);
    setError(null);

    try {
      const importResult = await importBundle(fileData, passphrase);
      setResult(importResult);
      setStep('success');
      refreshCounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setFileData(null);
    setPassphrase('');
    setError(null);
    setStep('select');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (isoString: string): string => {
    return new Date(isoString).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="import-modal" onClick={(e) => e.stopPropagation()}>
        <div className="import-modal__header">
          <h2 className="import-modal__title">Import Sync Bundle</h2>
          <button className="import-modal__close" onClick={handleClose}>
            ✕
          </button>
        </div>

        {step === 'success' && result ? (
          <div className="import-modal__body">
            <div className="import-success">
              <span className="import-success__icon">✓</span>
              <h3 className="import-success__title">Import Complete</h3>
              <p className="import-success__message">
                Successfully imported {result.applied} changes.
                {result.skipped > 0 && (
                  <>
                    <br />
                    {result.skipped} changes were already synced.
                  </>
                )}
                {result.conflicts > 0 && (
                  <>
                    <br />
                    {result.conflicts} conflicts need review.
                  </>
                )}
              </p>
            </div>
          </div>
        ) : (
          <div className="import-modal__body">
            {step === 'select' && (
              <>
                <p className="import-modal__description">
                  Select a .msync file to import changes from another device.
                </p>

                {error && <div className="import-modal__error">{error}</div>}

                <div
                  className={`import-modal__dropzone ${isDragActive ? 'import-modal__dropzone--active' : ''}`}
                  onClick={() => fileInputRef.current?.click()}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                >
                  <p className="import-modal__dropzone-text">
                    Drop .msync file here or click to browse
                  </p>
                  <p className="import-modal__dropzone-hint">
                    Only .msync files are supported
                  </p>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".msync"
                  onChange={handleFileInputChange}
                  style={{ display: 'none' }}
                />
              </>
            )}

            {step === 'decrypt' && selectedFile && (
              <>
                <div className="import-modal__file-info">
                  <span className="import-modal__file-icon">📦</span>
                  <div className="import-modal__file-details">
                    <div className="import-modal__file-name">{selectedFile.name}</div>
                    <div className="import-modal__file-size">{formatFileSize(selectedFile.size)}</div>
                  </div>
                  <button
                    className="import-modal__file-remove"
                    onClick={handleRemoveFile}
                    title="Remove file"
                  >
                    ✕
                  </button>
                </div>

                {error && <div className="import-modal__error">{error}</div>}

                <div className="import-modal__field">
                  <label className="import-modal__label">Passphrase</label>
                  <div className="import-modal__input-row">
                    <Input
                      type={showPassphrase ? 'text' : 'password'}
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      placeholder="Enter the passphrase used to create this bundle"
                      onKeyDown={(e) => e.key === 'Enter' && passphrase && handleDecrypt()}
                    />
                    <button
                      type="button"
                      className="import-modal__toggle-visibility"
                      onClick={() => setShowPassphrase(!showPassphrase)}
                    >
                      {showPassphrase ? '🙈' : '👁'}
                    </button>
                  </div>
                </div>
              </>
            )}

            {step === 'preview' && preview && (
              <>
                <div className="import-modal__file-info">
                  <span className="import-modal__file-icon">📦</span>
                  <div className="import-modal__file-details">
                    <div className="import-modal__file-name">{selectedFile?.name}</div>
                    <div className="import-modal__file-size">
                      {selectedFile && formatFileSize(selectedFile.size)}
                    </div>
                  </div>
                </div>

                {error && <div className="import-modal__error">{error}</div>}

                {preview.alreadyImported && (
                  <div className="import-modal__warning">
                    This bundle has already been imported. No new changes to apply.
                  </div>
                )}

                <div className="import-modal__preview">
                  <div className="import-modal__preview-title">Bundle Details</div>
                  <div className="import-modal__preview-item">
                    <span className="import-modal__preview-label">From device</span>
                    <span className="import-modal__preview-value">
                      {preview.manifest.createdByName}
                    </span>
                  </div>
                  <div className="import-modal__preview-item">
                    <span className="import-modal__preview-label">Created</span>
                    <span className="import-modal__preview-value">
                      {formatDate(preview.manifest.createdAt)}
                    </span>
                  </div>
                  <div className="import-modal__preview-item">
                    <span className="import-modal__preview-label">Total changes</span>
                    <span className="import-modal__preview-value">{preview.manifest.opCount}</span>
                  </div>
                  <div className="import-modal__preview-item">
                    <span className="import-modal__preview-label">New changes</span>
                    <span className="import-modal__preview-value">{preview.newOpsCount}</span>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        <div className="import-modal__footer">
          {step === 'success' ? (
            <Button onClick={handleClose}>Done</Button>
          ) : step === 'preview' ? (
            <>
              <Button variant="ghost" onClick={() => setStep('decrypt')}>
                Back
              </Button>
              <Button
                onClick={handleImport}
                disabled={isLoading || (preview?.alreadyImported ?? false)}
              >
                {isLoading ? 'Importing...' : 'Import Changes'}
              </Button>
            </>
          ) : step === 'decrypt' ? (
            <>
              <Button variant="ghost" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleDecrypt} disabled={!passphrase || isLoading}>
                {isLoading ? 'Decrypting...' : 'Continue'}
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
