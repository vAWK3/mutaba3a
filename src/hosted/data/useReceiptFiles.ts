import { useLanguage } from '../../lib/i18n/core';
import { useTp } from '../../lib/i18n/plural';
import { useToast } from '../components/Toast';
import { checkReceiptFile } from './receiptFileRules';
import { uploadErrorOf, useUploadReceipts } from './receiptQueries';

/**
 * Files picked or dropped into the receipts library (MUT-260 D9), wherever they come from: the gallery's Upload and
 * home's drop zone (MUT-657). The same rules before any request (`checkReceiptFile`), one upload at a time, and one
 * toast: the first file refused, else the first upload that failed (the pending cap told apart from the per-minute
 * budget), else how many landed in To review. `onLanded` hears how many did, once they are all in.
 */
export function useReceiptFiles(profileId: string, { onLanded }: { onLanded?: (count: number) => void } = {}) {
  const { t } = useLanguage();
  const tp = useTp();
  const showToast = useToast();
  const uploads = useUploadReceipts(profileId);

  const onFiles = async (files: File[]) => {
    const problems: string[] = [];
    const accepted = files.filter((file) => {
      const problem = checkReceiptFile(file);
      if (problem) problems.push(t(`hosted.receipts.errors.${problem}`, { name: file.name }));
      return !problem;
    });
    if (problems.length > 0) showToast(problems[0]);
    if (accepted.length === 0) return;
    const outcomes = await uploads.upload(accepted);
    const failed = outcomes.find((o) => o.error !== null);
    const landed = outcomes.filter((o) => o.error === null).length;
    if (failed) {
      const { key, seconds } = uploadErrorOf(failed.error);
      showToast(t(`hosted.receipts.errors.${key}`, { name: failed.file.name, seconds: seconds ?? 0 }));
    } else if (problems.length === 0 && landed > 0) {
      showToast(tp('hosted.receipts.uploaded', landed), { tone: 'info' });
    }
    if (landed > 0) onLanded?.(landed);
  };

  return { onFiles, uploading: uploads.uploading, pending: uploads.pending };
}
