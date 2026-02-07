import { useState, useRef, useCallback } from 'react';
import { Drawer } from './Drawer';
import { useBulkCreateReceipts, useCheckReceiptDuplicate } from '../../hooks/useExpenseQueries';
import { detectMonthFromFile, formatMonthKey, getRecentMonthKeys } from '../../lib/monthDetection';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import { cn } from '../../lib/utils';
import type { BulkUploadFile, BulkUploadStatus } from '../../types';
import './BulkUploadDrawer.css';

export interface BulkUploadDrawerProps {
  profileId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_FILES = 100;

export function BulkUploadDrawer({
  profileId,
  isOpen,
  onClose,
  onSuccess,
}: BulkUploadDrawerProps) {
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<BulkUploadFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [autoDetectMonth, setAutoDetectMonth] = useState(true);
  const [batchOverrideMonth, setBatchOverrideMonth] = useState<string>('');
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });

  const bulkCreateMutation = useBulkCreateReceipts();
  const checkDuplicateMutation = useCheckReceiptDuplicate();

  const monthOptions = getRecentMonthKeys(12);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = Array.from(e.target.files || []);
      if (selectedFiles.length === 0) return;

      // Limit number of files
      const filesToAdd = selectedFiles.slice(0, MAX_FILES - files.length);

      const newFiles: BulkUploadFile[] = filesToAdd.map((file) => {
        // Validate file
        let status: BulkUploadStatus = 'pending';
        let error: string | undefined;

        if (file.size > MAX_FILE_SIZE) {
          status = 'error';
          error = t('expenses.receipts.fileTooLarge', { maxSize: '5MB' });
        } else if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
          status = 'error';
          error = t('expenses.receipts.invalidFileType');
        }

        return {
          file,
          detectedMonthKey: detectMonthFromFile(file),
          status,
          error,
        };
      });

      setFiles((prev) => [...prev, ...newFiles]);

      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [files.length, t]
  );

  const handleRemoveFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleOverrideMonth = (index: number, monthKey: string) => {
    setFiles((prev) =>
      prev.map((f, i) =>
        i === index ? { ...f, overrideMonthKey: monthKey || undefined } : f
      )
    );
  };

  const handleBatchOverrideChange = (monthKey: string) => {
    setBatchOverrideMonth(monthKey);
    if (monthKey) {
      setFiles((prev) =>
        prev.map((f) => ({ ...f, overrideMonthKey: monthKey }))
      );
    } else {
      setFiles((prev) =>
        prev.map((f) => ({ ...f, overrideMonthKey: undefined }))
      );
    }
  };

  const getEffectiveMonth = (file: BulkUploadFile): string => {
    if (!autoDetectMonth && batchOverrideMonth) {
      return batchOverrideMonth;
    }
    return file.overrideMonthKey || file.detectedMonthKey;
  };

  const readFileAsBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleUpload = async () => {
    const pendingFiles = files.filter((f) => f.status === 'pending');
    if (pendingFiles.length === 0) return;

    setIsUploading(true);
    setUploadProgress({ current: 0, total: pendingFiles.length });

    const updatedFiles = [...files];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.status !== 'pending') continue;

      const monthKey = getEffectiveMonth(file);

      // Update status to uploading
      updatedFiles[i] = { ...file, status: 'uploading' };
      setFiles([...updatedFiles]);

      try {
        // Check for duplicate
        const isDuplicate = await checkDuplicateMutation.mutateAsync({
          profileId,
          fileName: file.file.name,
          sizeBytes: file.file.size,
          monthKey,
        });

        if (isDuplicate) {
          updatedFiles[i] = {
            ...file,
            status: 'duplicate',
            error: t('bulkUpload.duplicate'),
          };
        } else {
          // Read file and create receipt
          const base64Data = await readFileAsBase64(file.file);

          const receipts = await bulkCreateMutation.mutateAsync([
            {
              profileId,
              monthKey,
              fileName: file.file.name,
              mimeType: file.file.type,
              sizeBytes: file.file.size,
              data: base64Data,
            },
          ]);

          updatedFiles[i] = {
            ...file,
            status: 'success',
            receiptId: receipts[0]?.id,
          };
        }
      } catch {
        updatedFiles[i] = {
          ...file,
          status: 'error',
          error: t('expenses.receipts.uploadFailed'),
        };
      }

      setFiles([...updatedFiles]);
      setUploadProgress((prev) => ({ ...prev, current: prev.current + 1 }));
    }

    setIsUploading(false);

    // Check if all successful
    const allSuccess = updatedFiles.every(
      (f) => f.status === 'success' || f.status === 'duplicate'
    );
    if (allSuccess) {
      onSuccess?.();
    }
  };

  const handleRetryFailed = () => {
    setFiles((prev) =>
      prev.map((f) =>
        f.status === 'error' ? { ...f, status: 'pending' as BulkUploadStatus, error: undefined } : f
      )
    );
  };

  const handleClose = () => {
    setFiles([]);
    setIsUploading(false);
    setBatchOverrideMonth('');
    onClose();
  };

  const pendingCount = files.filter((f) => f.status === 'pending').length;
  const successCount = files.filter((f) => f.status === 'success').length;
  const errorCount = files.filter((f) => f.status === 'error').length;
  const duplicateCount = files.filter((f) => f.status === 'duplicate').length;

  if (!isOpen) return null;

  return (
    <Drawer
      title={t('bulkUpload.title')}
      onClose={handleClose}
      footer={
        <>
          <div className="drawer-footer-left">
            {errorCount > 0 && !isUploading && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleRetryFailed}
              >
                {t('bulkUpload.retryFailed')} ({errorCount})
              </button>
            )}
          </div>
          <div className="drawer-footer-right">
            <button type="button" className="btn btn-secondary" onClick={handleClose}>
              {t('common.close')}
            </button>
            {pendingCount > 0 && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleUpload}
                disabled={isUploading}
              >
                {isUploading
                  ? `${t('bulkUpload.uploading')} (${uploadProgress.current}/${uploadProgress.total})`
                  : `${t('bulkUpload.upload')} (${pendingCount})`}
              </button>
            )}
          </div>
        </>
      }
    >
      <div className="bulk-upload-content">
        {/* Dropzone */}
        <div
          className="bulk-upload-dropzone"
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf"
            multiple
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          <div className="bulk-upload-dropzone-icon">
            <UploadIcon />
          </div>
          <div className="bulk-upload-dropzone-text">
            <span className="bulk-upload-dropzone-title">
              {t('bulkUpload.dropzoneTitle')}
            </span>
            <span className="bulk-upload-dropzone-hint">
              {t('bulkUpload.dropzoneHint', { maxFiles: MAX_FILES, maxSize: '5MB' })}
            </span>
          </div>
        </div>

        {/* Options */}
        {files.length > 0 && (
          <div className="bulk-upload-options">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={autoDetectMonth}
                onChange={(e) => {
                  setAutoDetectMonth(e.target.checked);
                  if (e.target.checked) {
                    setBatchOverrideMonth('');
                  }
                }}
              />
              <span>{t('bulkUpload.autoDetectMonth')}</span>
            </label>

            {!autoDetectMonth && (
              <div className="bulk-upload-batch-override">
                <label className="form-label">{t('bulkUpload.batchMonth')}</label>
                <select
                  className="select"
                  value={batchOverrideMonth}
                  onChange={(e) => handleBatchOverrideChange(e.target.value)}
                >
                  <option value="">{t('bulkUpload.selectMonth')}</option>
                  {monthOptions.map((key) => (
                    <option key={key} value={key}>
                      {formatMonthKey(key, locale)}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        {/* Stats */}
        {files.length > 0 && (
          <div className="bulk-upload-stats">
            <span className="bulk-upload-stat">
              {t('bulkUpload.total')}: {files.length}
            </span>
            {successCount > 0 && (
              <span className="bulk-upload-stat text-success">
                {t('bulkUpload.success')}: {successCount}
              </span>
            )}
            {duplicateCount > 0 && (
              <span className="bulk-upload-stat text-warning">
                {t('bulkUpload.duplicates')}: {duplicateCount}
              </span>
            )}
            {errorCount > 0 && (
              <span className="bulk-upload-stat text-danger">
                {t('bulkUpload.errors')}: {errorCount}
              </span>
            )}
          </div>
        )}

        {/* Progress bar */}
        {isUploading && (
          <div className="bulk-upload-progress">
            <div
              className="bulk-upload-progress-bar"
              style={{
                width: `${(uploadProgress.current / uploadProgress.total) * 100}%`,
              }}
            />
          </div>
        )}

        {/* File list */}
        {files.length > 0 && (
          <div className="bulk-upload-files">
            {files.map((file, index) => (
              <div
                key={`${file.file.name}-${index}`}
                className={cn('bulk-upload-file', `status-${file.status}`)}
              >
                <div className="bulk-upload-file-info">
                  <span className="bulk-upload-file-name" title={file.file.name}>
                    {file.file.name}
                  </span>
                  <span className="bulk-upload-file-size">
                    {(file.file.size / 1024).toFixed(1)} KB
                  </span>
                </div>

                <div className="bulk-upload-file-month">
                  {autoDetectMonth ? (
                    <select
                      className="select select-sm"
                      value={file.overrideMonthKey || file.detectedMonthKey}
                      onChange={(e) => handleOverrideMonth(index, e.target.value)}
                      disabled={file.status !== 'pending'}
                    >
                      {monthOptions.map((key) => (
                        <option key={key} value={key}>
                          {formatMonthKey(key, locale)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-muted text-sm">
                      {formatMonthKey(getEffectiveMonth(file), locale)}
                    </span>
                  )}
                </div>

                <div className="bulk-upload-file-status">
                  {file.status === 'pending' && (
                    <span className="status-badge status-pending">
                      {t('bulkUpload.statusPending')}
                    </span>
                  )}
                  {file.status === 'uploading' && (
                    <span className="status-badge status-uploading">
                      <span className="spinner-sm" />
                    </span>
                  )}
                  {file.status === 'success' && (
                    <span className="status-badge status-success">
                      <CheckIcon />
                    </span>
                  )}
                  {file.status === 'duplicate' && (
                    <span
                      className="status-badge status-duplicate"
                      title={file.error}
                    >
                      <DuplicateIcon />
                    </span>
                  )}
                  {file.status === 'error' && (
                    <span className="status-badge status-error" title={file.error}>
                      <ErrorIcon />
                    </span>
                  )}
                </div>

                {file.status === 'pending' && (
                  <button
                    type="button"
                    className="bulk-upload-file-remove"
                    onClick={() => handleRemoveFile(index)}
                  >
                    <CloseIcon />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Drawer>
  );
}

function UploadIcon() {
  return (
    <svg width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
    </svg>
  );
}

function DuplicateIcon() {
  return (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
