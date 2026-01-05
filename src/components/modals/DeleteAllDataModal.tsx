import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { db, deleteAllData } from '../../db';
import { useT } from '../../lib/i18n';
import {
  toCsv,
  downloadTextFile,
  CLIENT_COLUMNS,
  PROJECT_COLUMNS,
  TRANSACTION_COLUMNS,
} from '../../utils/csv';
import './DeleteAllDataModal.css';

interface DeleteAllDataModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

type ExportStatus = 'idle' | 'exporting' | 'done' | 'error';
type DeleteStatus = 'idle' | 'deleting' | 'error';

export function DeleteAllDataModal({ onClose, onSuccess }: DeleteAllDataModalProps) {
  const t = useT();
  const queryClient = useQueryClient();
  const modalRef = useRef<HTMLDivElement>(null);

  const [exportStatus, setExportStatus] = useState<ExportStatus>('idle');
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [deleteStatus, setDeleteStatus] = useState<DeleteStatus>('idle');

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

  const handleExportBackup = async () => {
    setExportStatus('exporting');
    try {
      const clients = await db.clients.toArray();
      const projects = await db.projects.toArray();
      const transactions = await db.transactions.toArray();

      const timestamp = new Date().toISOString().split('T')[0];

      // Export all three CSV files
      downloadTextFile(
        `clients-${timestamp}.csv`,
        toCsv(clients as unknown as Record<string, unknown>[], [...CLIENT_COLUMNS])
      );
      downloadTextFile(
        `projects-${timestamp}.csv`,
        toCsv(projects as unknown as Record<string, unknown>[], [...PROJECT_COLUMNS])
      );
      downloadTextFile(
        `transactions-${timestamp}.csv`,
        toCsv(transactions as unknown as Record<string, unknown>[], [...TRANSACTION_COLUMNS])
      );

      setExportStatus('done');
    } catch (error) {
      setExportStatus('error');
      console.error('Export failed:', error);
    }
  };

  const handleDelete = async () => {
    setDeleteStatus('deleting');
    try {
      await deleteAllData();

      // Invalidate all queries
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      queryClient.invalidateQueries({ queryKey: ['overviewTotals'] });
      queryClient.invalidateQueries({ queryKey: ['attentionReceivables'] });
      queryClient.invalidateQueries({ queryKey: ['clientSummaries'] });
      queryClient.invalidateQueries({ queryKey: ['projectSummaries'] });

      onSuccess();
    } catch (error) {
      setDeleteStatus('error');
      console.error('Delete failed:', error);
    }
  };

  const canDelete = exportStatus === 'done' && backupConfirmed && deleteStatus !== 'deleting';

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
      >
        <div className="modal-header">
          <h2 id="modal-title" className="modal-title">
            {t('settings.data.deleteModal.title')}
          </h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>

        <div className="modal-body">
          {/* Warning message */}
          <div className="modal-warning">
            <WarningIcon />
            <p>{t('settings.data.deleteModal.warning')}</p>
          </div>

          {/* Step A: Export Backup */}
          <div className="modal-step">
            <h3 className="modal-step-title">{t('settings.data.deleteModal.stepA.title')}</h3>
            <p className="modal-step-desc">{t('settings.data.deleteModal.stepA.desc')}</p>
            <div className="modal-step-action">
              <button
                className="btn btn-primary"
                onClick={handleExportBackup}
                disabled={exportStatus === 'exporting' || exportStatus === 'done'}
              >
                {exportStatus === 'exporting'
                  ? t('settings.data.deleteModal.stepA.exporting')
                  : t('settings.data.deleteModal.stepA.btn')}
              </button>
              {exportStatus === 'done' && (
                <span className="status-success">
                  <CheckIcon /> {t('settings.data.deleteModal.stepA.done')}
                </span>
              )}
              {exportStatus === 'error' && (
                <span className="status-error">{t('settings.data.deleteModal.stepA.error')}</span>
              )}
            </div>
          </div>

          {/* Step B: Confirm Deletion */}
          <div className={`modal-step ${exportStatus !== 'done' ? 'modal-step-disabled' : ''}`}>
            <h3 className="modal-step-title">{t('settings.data.deleteModal.stepB.title')}</h3>
            <label className="modal-checkbox">
              <input
                type="checkbox"
                checked={backupConfirmed}
                onChange={(e) => setBackupConfirmed(e.target.checked)}
                disabled={exportStatus !== 'done'}
              />
              <span>{t('settings.data.deleteModal.stepB.checkbox')}</span>
            </label>
            <div className="modal-step-action">
              <button
                className="btn btn-danger"
                onClick={handleDelete}
                disabled={!canDelete}
              >
                {deleteStatus === 'deleting'
                  ? t('settings.data.deleteModal.stepB.deleting')
                  : t('settings.data.deleteModal.stepB.btn')}
              </button>
              {deleteStatus === 'error' && (
                <span className="status-error">{t('settings.data.deleteModal.stepB.error')}</span>
              )}
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
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

function CheckIcon() {
  return (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}
