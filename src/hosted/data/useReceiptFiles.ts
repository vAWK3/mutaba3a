import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useLanguage } from '../../lib/i18n/core';
import { useTp } from '../../lib/i18n/plural';
import { useToast } from '../components/Toast';
import { checkReceiptFile } from './receiptFileRules';
import { limitFromUsage, planLimitOf, type PlanLimit } from './planUsage';
import { uploadErrorOf, useUploadReceipts } from './receiptQueries';
import { useStarterUsage } from './useStarterUsage';

/**
 * Files picked or dropped into the receipts library (MUT-260 D9), wherever they come from: the gallery's Upload and
 * home's drop zone (MUT-657). The same rules before any request (`checkReceiptFile`), one upload at a time, and one
 * toast: the first file refused, else the first upload that failed (the pending cap told apart from the per-minute
 * budget), else how many landed in To review. `onLanded` hears how many did, once they are all in.
 * MUT-731 (wireframe 2): on Starter at 12 of 12 nothing is sent ("refused before the upload"); a refusal the server
 * answers (PLAN_LIMIT) shows the same notice instead of a toast. `byHand` opens a new expense, so it isn't lost.
 */
export function useReceiptFiles(profileId: string, { onLanded }: { onLanded?: (count: number) => void } = {}) {
  const { t } = useLanguage();
  const tp = useTp();
  const showToast = useToast();
  const uploads = useUploadReceipts(profileId);
  const starter = useStarterUsage();
  const navigate = useNavigate();
  const [planLimit, setPlanLimit] = useState<PlanLimit | null>(null);
  const byHand = () => {
    setPlanLimit(null);
    void navigate({ to: `/p/${profileId}/expenses`, search: { newExpense: '1' } } as never);
  };

  const onFiles = async (files: File[]) => {
    if (starter.usage && starter.billing && starter.usage.scans.level === 'at_cap') {
      setPlanLimit(limitFromUsage(starter.usage, 'scans', starter.billing));
      return;
    }
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
    const limit = failed ? planLimitOf(failed.error) : null;
    if (limit) {
      setPlanLimit(limit);
    } else if (failed) {
      const { key, seconds } = uploadErrorOf(failed.error);
      showToast(t(`hosted.receipts.errors.${key}`, { name: failed.file.name, seconds: seconds ?? 0 }));
    } else if (problems.length === 0 && landed > 0) {
      showToast(tp('hosted.receipts.uploaded', landed), { tone: 'info' });
    }
    if (landed > 0) onLanded?.(landed);
  };

  return { onFiles, uploading: uploads.uploading, pending: uploads.pending, planLimit, byHand, dismissLimit: () => setPlanLimit(null) };
}
