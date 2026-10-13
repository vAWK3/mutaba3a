import type { BackupData } from '../db/backup';

/**
 * Download a full backup as `mutaba3a-backup-v{schema}-{date}.json`. The
 * rows come from `getRepositories().base.dataset.serializeBackup()`; this half
 * is browser-only, so it lives outside the data layer (MUT-47).
 */
export function downloadBackup(data: BackupData): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `mutaba3a-backup-v${data.version}-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
