import { useRef, useState } from 'react';
import { useLanguage } from '../../lib/i18n/core';
import { Button } from '../../components/ui/Button';
import { useAddReceipt, useDeleteReceipt } from '../data/expenseQueries';
import { useToast } from './Toast';
import { downloadNavigator } from '../data/download';
import { api, type ExpenseReceipt } from '../api/client';

/**
 * Receipt attachment on an existing expense (MUT-44 §3/§4): start → PUT the
 * bytes to the signed URL → complete, mirroring the M6 attachment flow. Only
 * rendered once an expense exists — the server's receipt routes need an
 * expenseId, so a brand-new, unsaved expense has nothing to attach to yet.
 */
const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_READY_RECEIPTS = 10;

export interface ReceiptUploaderProps {
  profileId: string;
  expenseId: string;
  receipts: ExpenseReceipt[];
}

export function ReceiptUploader({ profileId, expenseId, receipts }: ReceiptUploaderProps) {
  const { t } = useLanguage();
  const showToast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preparing, setPreparing] = useState<string | null>(null);

  const addReceipt = useAddReceipt(profileId, expenseId);
  const deleteReceipt = useDeleteReceipt(profileId, expenseId);

  const readyCount = receipts.filter((r) => r.status === 'READY').length;
  const atCap = readyCount >= MAX_READY_RECEIPTS;

  const handleFile = async (file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      showToast(t('hosted.expenses.drawer.receipts.invalidType'));
      return;
    }
    if (file.size > MAX_BYTES) {
      showToast(t('hosted.expenses.drawer.receipts.tooLarge'));
      return;
    }
    try {
      await addReceipt.mutateAsync(file);
    } catch {
      showToast(t('hosted.expenses.drawer.receipts.uploadFailed'));
    }
  };

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

  return (
    <div className="form-group">
      <label className="form-label">{t('hosted.expenses.drawer.receipts.title')}</label>
      {receipts.length > 0 && (
        <ul className="hp-receipt-list">
          {receipts
            .filter((r) => r.status === 'READY')
            .map((receipt) => (
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
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={deleteReceipt.isPending}
                  onClick={() => void handleDelete(receipt)}
                >
                  {t('common.delete')}
                </Button>
              </li>
            ))}
        </ul>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(',')}
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void handleFile(file);
        }}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={atCap || addReceipt.isPending}
        onClick={() => inputRef.current?.click()}
      >
        {t(addReceipt.isPending ? 'hosted.expenses.drawer.receipts.uploading' : 'hosted.expenses.drawer.receipts.add')}
      </Button>
      {atCap && <p className="hp-muted">{t('hosted.expenses.drawer.receipts.atCap')}</p>}
    </div>
  );
}
