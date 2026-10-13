import { useState, useEffect, useRef, useId } from 'react';
import { createPortal } from 'react-dom';
import { restoreFromBackup } from '../../db/backup';
import { useLanguage, getLocale } from '../../lib/i18n';
import { useTp } from '../../lib/i18n/plural';
import { formatDate } from '../../lib/utils';
import type { DataFileKind } from '../../lib/dataFiles';
import './DeleteAllDataModal.css';

type FullBackupSummary = Extract<DataFileKind, { kind: 'fullBackup' }>;
type RestoreResult = Awaited<ReturnType<typeof restoreFromBackup>>;

interface RestoreBackupModalProps {
  /** The backup file's text, exactly as picked. */
  backupJson: string;
  summary: FullBackupSummary;
  onClose: () => void;
  /** Called once the restore committed; the caller reloads the app. */
  onRestored: (result: RestoreResult) => void;
}

/**
 * Settings › Your data › Restore with a full backup (MUT-88, ADR-072). A
 * restore replaces everything on the device, so it asks first and names the
 * backup by date and size. A failed restore leaves the data untouched and
 * says why, in the current language.
 */
export function RestoreBackupModal({ backupJson, summary, onClose, onRestored }: RestoreBackupModalProps) {
  const { t, language } = useLanguage();
  const tp = useTp();
  const titleId = useId();
  const modalRef = useRef<HTMLDivElement>(null);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    modalRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const date = summary.timestamp ? formatDate(summary.timestamp, getLocale(language)) : t('settings.restore.unknownDate');
  const records = tp('settings.restore.records', summary.records);

  const handleReplace = async () => {
    setRestoring(true);
    setError('');
    try {
      onRestored(await restoreFromBackup(backupJson));
    } catch (err) {
      setError(t('settings.data.importFailed', { error: err instanceof Error ? err.message : String(err) }));
      setRestoring(false);
    }
  };

  return createPortal(
    <>
      <div className="modal-overlay" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={modalRef} tabIndex={-1}>
        <div className="modal-header">
          <h2 id={titleId} className="modal-title">{t('settings.restore.title')}</h2>
        </div>
        <div className="modal-body">
          <p>{t('settings.restore.summary', { date, records })}</p>
          {error && (
            <p className="status-error" role="alert">{error}</p>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={restoring}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-danger" onClick={handleReplace} disabled={restoring}>
            {restoring ? t('settings.restore.replacing') : t('settings.restore.replace')}
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}
