import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { receiptRepo } from '../db/expenseRepository';

/**
 * Export all receipts for a profile and month as a ZIP file
 */
export async function exportReceiptsAsZip(
  profileId: string,
  profileName: string,
  monthKey: string
): Promise<void> {
  const receipts = await receiptRepo.getByProfileAndMonth(profileId, monthKey);

  if (receipts.length === 0) {
    throw new Error('No receipts to export');
  }

  const zip = new JSZip();
  const folder = zip.folder(`${profileName}_receipts_${monthKey}`);

  if (!folder) {
    throw new Error('Failed to create ZIP folder');
  }

  for (const receipt of receipts) {
    // Decode base64 and add to ZIP
    const binaryData = atob(receipt.data);
    const bytes = new Uint8Array(binaryData.length);
    for (let i = 0; i < binaryData.length; i++) {
      bytes[i] = binaryData.charCodeAt(i);
    }

    // Generate unique filename if there are duplicates
    let fileName = receipt.fileName;
    const existingFiles = Object.keys(folder.files);
    if (existingFiles.includes(fileName)) {
      const ext = fileName.lastIndexOf('.') !== -1
        ? fileName.slice(fileName.lastIndexOf('.'))
        : '';
      const base = fileName.lastIndexOf('.') !== -1
        ? fileName.slice(0, fileName.lastIndexOf('.'))
        : fileName;
      let counter = 1;
      while (existingFiles.includes(`${base}_${counter}${ext}`)) {
        counter++;
      }
      fileName = `${base}_${counter}${ext}`;
    }

    folder.file(fileName, bytes, { binary: true });
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  const zipFileName = `${profileName}_receipts_${monthKey}.zip`.replace(/\s+/g, '_');
  saveAs(blob, zipFileName);
}

/**
 * Export all receipts for a profile (all time) as a ZIP file
 */
export async function exportAllReceiptsAsZip(
  profileId: string,
  profileName: string
): Promise<void> {
  const receipts = await receiptRepo.list({ profileId });

  if (receipts.length === 0) {
    throw new Error('No receipts to export');
  }

  const zip = new JSZip();

  // Group receipts by month
  const receiptsByMonth = new Map<string, typeof receipts>();
  for (const receipt of receipts) {
    const existing = receiptsByMonth.get(receipt.monthKey) || [];
    existing.push(receipt);
    receiptsByMonth.set(receipt.monthKey, existing);
  }

  // Create folders for each month
  for (const [monthKey, monthReceipts] of receiptsByMonth) {
    const folder = zip.folder(monthKey);
    if (!folder) continue;

    const fileNames = new Set<string>();

    for (const receipt of monthReceipts) {
      // Decode base64 and add to ZIP
      const binaryData = atob(receipt.data);
      const bytes = new Uint8Array(binaryData.length);
      for (let i = 0; i < binaryData.length; i++) {
        bytes[i] = binaryData.charCodeAt(i);
      }

      // Generate unique filename
      let fileName = receipt.fileName;
      if (fileNames.has(fileName)) {
        const ext = fileName.lastIndexOf('.') !== -1
          ? fileName.slice(fileName.lastIndexOf('.'))
          : '';
        const base = fileName.lastIndexOf('.') !== -1
          ? fileName.slice(0, fileName.lastIndexOf('.'))
          : fileName;
        let counter = 1;
        while (fileNames.has(`${base}_${counter}${ext}`)) {
          counter++;
        }
        fileName = `${base}_${counter}${ext}`;
      }
      fileNames.add(fileName);

      folder.file(fileName, bytes, { binary: true });
    }
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  const zipFileName = `${profileName}_all_receipts.zip`.replace(/\s+/g, '_');
  saveAs(blob, zipFileName);
}
