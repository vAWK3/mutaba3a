import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useLanguage } from '../../lib/i18n/core';
import { Button } from '../../components/ui/Button';
import { useAddReceipt, useDeleteReceipt } from '../data/receiptQueries';
import { useToast } from './Toast';
import { downloadNavigator } from '../data/download';
import { api, type ExpenseReceipt } from '../api/client';
import { MAX_RECEIPTS_PER_EXPENSE, ReceiptPickButton } from './ReceiptPickButton';

/**
 * Receipt attachment on an existing expense (MUT-44 §3/§4): start → PUT the
 * bytes to the signed URL → complete, mirroring the M6 attachment flow. Only
 * rendered once an expense exists — the server's receipt routes need an
 * expenseId; a new expense's picks wait in QueuedReceipts (MUT-491) and arrive
 * here as `incoming` once Save has created it.
 *
 * Files upload one at a time. Each shows as "Uploading…" until it lands among
 * the READY receipts; a failed one stays in the list with Upload again and
 * Remove (MUT-491 R3), never a toast the person has to catch.
 */

interface LocalUpload {
  key: string;
  file: File;
  status: 'waiting' | 'uploading' | 'failed';
  /** The READY receipts when it failed: a lost answer may have landed it after all (shown READY, not failed). */
  readyAtFailure?: string[];
}

export interface ReceiptUploaderProps {
  profileId: string;
  expenseId: string;
  receipts: ExpenseReceipt[];
  /** MUT-361: a read-only profile (lapse gate) keeps Download, a read; Add and Delete are gone. */
  readOnly?: boolean;
  /** MUT-491: files picked before the expense existed, uploaded as soon as this mounts. */
  incoming?: File[];
  /** Called once, when every `incoming` file has landed or failed, with the names of those that failed. */
  onIncomingSettled?: (failed: string[]) => void;
}

export function ReceiptUploader({ profileId, expenseId, receipts, readOnly = false, incoming, onIncomingSettled }: ReceiptUploaderProps) {
  const { t } = useLanguage();
  const showToast = useToast();
  const [preparing, setPreparing] = useState<string | null>(null);

  const addReceipt = useAddReceipt(profileId, expenseId);
  const deleteReceipt = useDeleteReceipt(profileId, expenseId);

  const uploads = useUploadQueue(addReceipt.mutateAsync, receipts, incoming, onIncomingSettled);

  const ready = receipts.filter((r) => r.status === 'READY');
  const room = MAX_RECEIPTS_PER_EXPENSE - ready.length - uploads.active;
  const atCap = ready.length >= MAX_RECEIPTS_PER_EXPENSE;

  // MUT-361: nothing to read and nothing allowed to add.
  if (readOnly && ready.length === 0) return null;

  const handleDownload = async (receipt: ExpenseReceipt) => {
    setPreparing(receipt.id);
    try {
      const { url, filename } = await api.receiptDownload(profileId, expenseId, receipt.id);
      await downloadNavigator.open(url, filename);
    } catch {
      showToast(t('hosted.expenses.drawer.receipts.downloadFailed'));
    } finally {
      setPreparing(null);
    }
  };

  const handleDelete = async (receipt: ExpenseReceipt) => {
    try {
      await deleteReceipt.mutateAsync(receipt.id);
    } catch {
      showToast(t('hosted.expenses.drawer.receipts.deleteFailed'));
    }
  };

  const shown = uploads.rows.filter((row) => !landedAfterAll(row, ready));

  return (
    <div className="form-group">
      <label className="form-label">{t('hosted.expenses.drawer.receipts.title')}</label>
      {(ready.length > 0 || shown.length > 0) && (
        <ul className="hp-receipt-list">
          {ready.map((receipt) => (
            <li key={receipt.id} className="hp-receipt-row">
              <bdi>{receipt.filename}</bdi>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={preparing === receipt.id}
                onClick={() => void handleDownload(receipt)}
              >
                {t(preparing === receipt.id ? 'hosted.expenses.drawer.receipts.preparing' : 'hosted.expenses.drawer.receipts.download')}
              </Button>
              {!readOnly && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={deleteReceipt.isPending}
                  onClick={() => void handleDelete(receipt)}
                >
                  {t('common.delete')}
                </Button>
              )}
            </li>
          ))}
          {shown.map((row) => (
            <li key={row.key} className="hp-receipt-row">
              <bdi>{row.file.name}</bdi>
              {row.status === 'failed' ? (
                <>
                  <span className="hp-receipt-failed" role="status">
                    {t('hosted.expenses.drawer.receipts.uploadFailed')}
                  </span>
                  <Button type="button" variant="secondary" size="sm" disabled={room <= 0} onClick={() => uploads.retry(row.key)}>
                    {t('hosted.expenses.drawer.receipts.retry')}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => uploads.remove(row.key)}>
                    {t('hosted.expenses.drawer.receipts.remove')}
                  </Button>
                </>
              ) : (
                <span className="hp-muted">{t('hosted.expenses.drawer.receipts.uploading')}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && <ReceiptPickButton room={room} busy={uploads.active > 0} onPick={uploads.add} />}
      {!readOnly && atCap && <p className="hp-muted">{t('hosted.expenses.drawer.receipts.atCap')}</p>}
    </div>
  );
}

/** A failed row whose file is now READY under a receipt that wasn't there when it failed: its complete landed after all. */
function landedAfterAll(row: LocalUpload, ready: ExpenseReceipt[]): boolean {
  if (row.status !== 'failed' || !row.readyAtFailure) return false;
  const before = new Set(row.readyAtFailure);
  return ready.some((r) => r.filename === row.file.name && !before.has(r.id));
}

/**
 * The uploads this drawer started: one at a time, in pick order. A row goes away when its receipt lands (the
 * expense's cache already lists it, useAddReceipt), and stays as failed otherwise. `incoming` is uploaded once on
 * mount and reported once when it has all settled.
 */
function useUploadQueue(
  upload: (file: File) => Promise<ExpenseReceipt>,
  receipts: ExpenseReceipt[],
  incoming: File[] | undefined,
  onIncomingSettled: ((failed: string[]) => void) | undefined,
) {
  const [rows, setRows] = useState<LocalUpload[]>(() => (incoming ?? []).map((file) => ({ key: crypto.randomUUID(), file, status: 'waiting' })));
  const rowsRef = useRef(rows);
  const incomingKeys = useRef(new Set(rows.map((row) => row.key)));
  const draining = useRef(false);
  const readyIds = useRef<string[]>([]);
  useEffect(() => {
    readyIds.current = receipts.filter((r) => r.status === 'READY').map((r) => r.id);
  });

  const apply = (next: (current: LocalUpload[]) => LocalUpload[]) => {
    rowsRef.current = next(rowsRef.current);
    setRows(rowsRef.current);
  };
  const patch = (key: string, change: Partial<LocalUpload>) => apply((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)));

  const reportIfSettled = () => {
    if (incomingKeys.current.size === 0) return;
    const batch = rowsRef.current.filter((row) => incomingKeys.current.has(row.key));
    if (batch.some((row) => row.status !== 'failed')) return;
    incomingKeys.current = new Set();
    onIncomingSettled?.(batch.map((row) => row.file.name));
  };

  const drain = async () => {
    if (draining.current) return;
    draining.current = true;
    for (let next = rowsRef.current.find((row) => row.status === 'waiting'); next; next = rowsRef.current.find((row) => row.status === 'waiting')) {
      const { key } = next;
      patch(key, { status: 'uploading' });
      try {
        await upload(next.file);
        apply((current) => current.filter((row) => row.key !== key));
      } catch {
        patch(key, { status: 'failed', readyAtFailure: readyIds.current });
      }
    }
    draining.current = false;
    reportIfSettled();
  };

  const startIncoming = useEffectEvent(() => {
    if (rowsRef.current.length > 0) void drain();
  });
  useEffect(() => {
    startIncoming();
  }, []);

  return {
    rows,
    active: rows.filter((row) => row.status !== 'failed').length,
    add: (files: File[]) => {
      apply((current) => [...current, ...files.map((file) => ({ key: crypto.randomUUID(), file, status: 'waiting' as const }))]);
      void drain();
    },
    retry: (key: string) => {
      patch(key, { status: 'waiting', readyAtFailure: undefined });
      void drain();
    },
    remove: (key: string) => apply((current) => current.filter((row) => row.key !== key)),
  };
}
