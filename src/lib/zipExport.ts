import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { getRepositories } from '../db';

function addReceiptToFolder(folder: JSZip, receipt: { fileName: string; data: string }, usedNames: Set<string>): void {
  const binaryData = atob(receipt.data);
  const bytes = new Uint8Array(binaryData.length);
  for (let i = 0; i < binaryData.length; i++) {
    bytes[i] = binaryData.charCodeAt(i);
  }
  let fileName = receipt.fileName;
  if (usedNames.has(fileName)) {
    const dot = fileName.lastIndexOf('.');
    const ext = dot !== -1 ? fileName.slice(dot) : '';
    const base = dot !== -1 ? fileName.slice(0, dot) : fileName;
    let counter = 1;
    while (usedNames.has(`${base}_${counter}${ext}`)) counter++;
    fileName = `${base}_${counter}${ext}`;
  }
  usedNames.add(fileName);
  folder.file(fileName, bytes, { binary: true });
}

/**
 * Every receipt in the database, as `<profile>/<YYYY-MM>/<file>` entries
 * (MUT-14: the receipts pages are gone, so this is how a user gets their
 * uploaded files out; the rows themselves stay in the `receipts` table).
 * Pure builder so it can be tested without a download.
 */
export async function buildAllReceiptsArchive(): Promise<{ zip: JSZip; count: number }> {
  const repos = getRepositories().base;
  const [receipts, profiles] = await Promise.all([repos.receipts.list({}), repos.businessProfiles.list(true)]);
  const profileNames = new Map(profiles.map((profile) => [profile.id, profile.name]));
  const zip = new JSZip();
  const usedNames = new Map<string, Set<string>>();

  for (const receipt of receipts) {
    const profileName = (profileNames.get(receipt.profileId) || receipt.profileId).replace(/[\\/:*?"<>|]+/g, '_');
    const path = `${profileName}/${receipt.monthKey}`;
    const folder = zip.folder(path);
    if (!folder) continue;
    let names = usedNames.get(path);
    if (!names) {
      names = new Set<string>();
      usedNames.set(path, names);
    }
    addReceiptToFolder(folder, receipt, names);
  }

  return { zip, count: receipts.length };
}

/** Download every receipt across all profiles as one ZIP. Returns the file count. */
export async function exportAllProfilesReceiptsAsZip(): Promise<number> {
  const { zip, count } = await buildAllReceiptsArchive();
  if (count === 0) {
    throw new Error('No receipts to export');
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  saveAs(blob, 'mutaba3a_receipts.zip');
  return count;
}

