import { getRepositories } from '../db';
import type { BackupData } from '../db/backup';

/**
 * Download a full backup as `mtb3a-backup-v{schema}-{date}.json` (MUT-402 D6; imports go by
 * content, so files still named `mutaba3a-…` restore as before). The
 * rows come from `getRepositories().base.dataset.serializeBackup()`; this half
 * is browser-only, so it lives outside the data layer (MUT-47).
 */
export function downloadBackup(data: BackupData): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `mtb3a-backup-v${data.version}-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Settings › Your data › Back up (MUT-88, ADR-072): download a full backup,
 * then record when. Nothing is recorded if the download could not be
 * produced. A browser can't confirm the person kept the file; producing it
 * is the best signal available (MUT-90 builds its reminder on this date).
 */
export async function backUpNow(): Promise<void> {
  const { dataset, settings } = getRepositories().base;
  downloadBackup(await dataset.serializeBackup());
  await settings.update({ lastBackupAt: new Date().toISOString() });
}
