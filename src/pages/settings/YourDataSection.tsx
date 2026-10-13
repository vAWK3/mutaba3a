import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useLanguage, getLocale, type LanguageContextValue } from '../../lib/i18n';
import { useToast } from '../../lib/toastStore';
import { runIntegrityCheck } from '../../db/integrityCheck';
import { getRepositories } from '../../db/provider';
import { exportAllProfilesReceiptsAsZip } from '../../lib/zipExport';
import { classifyDataFile, setPendingImport, type DataFileKind } from '../../lib/dataFiles';
import { formatDate } from '../../lib/utils';
import { useBackUp, useSettings } from '../../hooks/useQueries';
import { ExportDataModal } from '../../components/modals/ExportDataModal';
import { RestoreBackupModal } from '../../components/modals/RestoreBackupModal';

interface IntegritySummary {
  total: number;
  issues: number;
}

type PendingRestore = { backupJson: string; summary: Extract<DataFileKind, { kind: 'fullBackup' }> };

/**
 * The integrity row's description after a run. Kept as numbers and worded at
 * render, so switching language on this page rewords it.
 */
function describeIntegrity(t: LanguageContextValue['t'], { total, issues }: IntegritySummary): string {
  if (issues === 0) return t('integrity.checkClean', { total });
  return t(issues === 1 ? 'integrity.checkIssuesSingular' : 'integrity.checkIssuesPlural', { count: issues, total });
}

/** Open the OS file picker and hand the chosen file, if any, to `onPick`. */
function pickFile(accept: string, onPick: (file: File) => void) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.onchange = (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) onPick(file);
  };
  input.click();
}

/**
 * Settings › Your data (MUT-88, ADR-071): one home for every data action.
 * Back up (with when it last happened), Restore (one picker; the file decides
 * where it goes), Export a business, Export receipts and Check data.
 * Replaces the old Data block and Data Tools card, which offered two exports
 * and two restores.
 */
export function YourDataSection() {
  const { t, language } = useLanguage();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const { data: settings } = useSettings();
  const backUp = useBackUp();
  const [integritySummary, setIntegritySummary] = useState<IntegritySummary | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [showExportBusiness, setShowExportBusiness] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<PendingRestore | null>(null);

  const handleBackUp = async () => {
    try {
      await backUp.mutateAsync();
      showToast(t('settings.backupDone'), { type: 'success' });
    } catch {
      showToast(t('settings.backupFailed'), { type: 'error' });
    }
  };

  const handleRestore = () =>
    pickFile('.json,.csv', async (file) => {
      const text = await file.text();
      const kind = classifyDataFile(file.name, text);
      if (kind.kind === 'fullBackup') {
        setPendingRestore({ backupJson: text, summary: kind });
      } else if (kind.kind === 'businessExport' || kind.kind === 'csv') {
        setPendingImport(file);
        navigate({ to: '/settings/import' });
      } else {
        showToast(t('settings.yourData.unknownFile'), { type: 'error' });
      }
    });

  const handleRestored = ({ recordsRestored: count, backupVersion: version }: { recordsRestored: number; backupVersion: number }) => {
    const key = count === 1 ? 'settings.importBackupDoneSingular' : 'settings.importBackupDonePlural';
    showToast(t(key, { count, version }), { type: 'success' });
    window.location.reload();
  };

  // Receipts export (MUT-14): the receipts pages are gone; uploaded files
  // stay in the database and leave through this ZIP.
  const { data: receiptCount = 0 } = useQuery({
    queryKey: ['receipts', 'count'],
    queryFn: () => getRepositories().base.receipts.count(),
  });
  const [isExportingReceipts, setIsExportingReceipts] = useState(false);
  const handleExportReceipts = async () => {
    setIsExportingReceipts(true);
    try {
      const count = await exportAllProfilesReceiptsAsZip();
      showToast(t('settings.exportReceiptsDone', { count }), { type: 'success' });
    } catch {
      showToast(t('settings.exportReceiptsFailed'), { type: 'error' });
    } finally {
      setIsExportingReceipts(false);
    }
  };

  const handleIntegrityCheck = async () => {
    setIsChecking(true);
    try {
      const result = await runIntegrityCheck();
      // A scan that stopped part-way comes back with `error`, not a throw.
      if (result.error) throw new Error(result.error);
      const issues = result.orphanedRecords.length + result.brokenReferences.length;
      setIntegritySummary({ total: result.totalRecords, issues });
      if (issues === 0) {
        showToast(t('integrity.toastClean'), { type: 'success' });
      } else {
        const key = issues === 1 ? 'integrity.toastIssuesSingular' : 'integrity.toastIssuesPlural';
        showToast(t(key, { count: issues }), { type: 'error' });
      }
    } catch {
      setIntegritySummary(null);
      showToast(t('integrity.checkFailed'), { type: 'error' });
    }
    setIsChecking(false);
  };

  const lastBackup = settings?.lastBackupAt
    ? t('settings.yourData.lastBackup', { date: formatDate(settings.lastBackupAt, getLocale(language)) })
    : t('settings.yourData.never');

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <div>
          <h2 className="settings-section-title">{t('settings.yourData.title')}</h2>
          <p className="settings-section-description">{t('settings.yourData.description')}</p>
        </div>
      </div>

      <div className="settings-row">
        <div>
          <div className="settings-label">{t('settings.yourData.backUp')}</div>
          <div className="settings-description">{lastBackup}</div>
        </div>
        <button className="btn btn-secondary" onClick={handleBackUp} disabled={backUp.isPending}>
          {backUp.isPending ? t('settings.yourData.backingUp') : t('settings.yourData.backUpBtn')}
        </button>
      </div>

      <div className="settings-row">
        <div>
          <div className="settings-label">{t('settings.yourData.restore')}</div>
          <div className="settings-description">{t('settings.yourData.restoreDesc')}</div>
        </div>
        <button className="btn btn-secondary" onClick={handleRestore}>
          {t('settings.yourData.restoreBtn')}
        </button>
      </div>

      <div className="settings-row">
        <div>
          <div className="settings-label">{t('settings.yourData.exportBusiness')}</div>
          <div className="settings-description">{t('settings.yourData.exportBusinessDesc')}</div>
        </div>
        <button className="btn btn-secondary" onClick={() => setShowExportBusiness(true)}>
          {t('settings.yourData.exportBusinessBtn')}
        </button>
      </div>

      <div className="settings-row" data-testid="settings-export-receipts">
        <div>
          <div className="settings-label">{t('settings.exportReceipts')}</div>
          <div className="settings-description">
            {receiptCount === 0 ? t('settings.exportReceiptsNone') : t('settings.exportReceiptsDesc', { count: receiptCount })}
          </div>
        </div>
        <button
          className="btn btn-secondary"
          onClick={handleExportReceipts}
          disabled={receiptCount === 0 || isExportingReceipts}
        >
          {t('settings.exportReceiptsBtn')}
        </button>
      </div>

      <div className="settings-row">
        <div>
          <div className="settings-label">{t('settings.integrityCheck')}</div>
          <div className="settings-description">
            {integritySummary ? describeIntegrity(t, integritySummary) : t('settings.integrityCheckDesc')}
          </div>
        </div>
        <button className="btn btn-secondary" onClick={handleIntegrityCheck} disabled={isChecking}>
          {isChecking ? t('settings.integrityCheckRunning') : t('settings.integrityCheckRun')}
        </button>
      </div>

      {showExportBusiness && <ExportDataModal onClose={() => setShowExportBusiness(false)} />}
      {pendingRestore && (
        <RestoreBackupModal
          backupJson={pendingRestore.backupJson}
          summary={pendingRestore.summary}
          onClose={() => setPendingRestore(null)}
          onRestored={handleRestored}
        />
      )}
    </div>
  );
}
