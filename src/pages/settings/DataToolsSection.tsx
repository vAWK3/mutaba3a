import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT, type LanguageContextValue } from '../../lib/i18n';
import { useToast } from '../../lib/toastStore';
import { runIntegrityCheck } from '../../db/integrityCheck';
import { exportBackup, restoreFromBackup } from '../../db/backup';
import { getRepositories } from '../../db/provider';
import { exportAllProfilesReceiptsAsZip } from '../../lib/zipExport';

interface IntegritySummary {
  total: number;
  issues: number;
}

/**
 * The integrity row's description after a run. Kept as numbers and worded at
 * render, so switching language on this page rewords it.
 */
function describeIntegrity(t: LanguageContextValue['t'], { total, issues }: IntegritySummary): string {
  if (issues === 0) return t('integrity.checkClean', { total });
  return t(issues === 1 ? 'integrity.checkIssuesSingular' : 'integrity.checkIssuesPlural', { count: issues, total });
}

/**
 * Settings › Data Tools: integrity check, JSON backup export/import and the
 * receipts ZIP export.
 */
export function DataToolsSection() {
  const t = useT();
  const { showToast } = useToast();
  const [integritySummary, setIntegritySummary] = useState<IntegritySummary | null>(null);
  const [isChecking, setIsChecking] = useState(false);

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

  const handleExportBackup = async () => {
    try {
      await exportBackup();
      showToast(t('settings.backupDone'), { type: 'success' });
    } catch {
      showToast(t('settings.backupFailed'), { type: 'error' });
    }
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

  const handleImportBackup = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const json = await file.text();
        const { recordsRestored: count, backupVersion: version } = await restoreFromBackup(json);
        const key = count === 1 ? 'settings.importBackupDoneSingular' : 'settings.importBackupDonePlural';
        showToast(t(key, { count, version }), { type: 'success' });
        window.location.reload();
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        showToast(t('settings.data.importFailed', { error }), { type: 'error' });
      }
    };
    input.click();
  };

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">{t('settings.dataTools')}</h2>

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

      <div className="settings-row">
        <div>
          <div className="settings-label">{t('settings.backup')}</div>
          <div className="settings-description">{t('settings.backupDesc')}</div>
        </div>
        <button className="btn btn-secondary" onClick={handleExportBackup}>
          {t('settings.backupExport')}
        </button>
      </div>

      <div className="settings-row">
        <div>
          <div className="settings-label">{t('settings.importBackup')}</div>
          <div className="settings-description">{t('settings.importBackupDesc')}</div>
        </div>
        <button className="btn btn-ghost" onClick={handleImportBackup}>
          {t('settings.importBackupBtn')}
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
    </div>
  );
}
