import { useRef } from 'react';
import { getLocale, useLanguage } from '../../lib/i18n/core';
import { Button } from '../../components/ui/Button';
import { useToast } from './Toast';
import { RECEIPT_MIME_TYPES, checkReceiptFile } from '../data/receiptFileRules';

/** The server's own cap (MAX_RECEIPTS_PER_EXPENSE): an expense holds at most this many READY receipts. */
export const MAX_RECEIPTS_PER_EXPENSE = 10;

export interface ReceiptPickButtonProps {
  /** How many more files fit; a pick beyond it keeps the first ones and names the rest. */
  room: number;
  onPick: (files: File[]) => void;
  disabled?: boolean;
  /** "Uploading…" in place of "Add receipt" while the live uploader works. */
  busy?: boolean;
}

/**
 * Add receipt (MUT-491 R4): the file picker the expense drawer uses before and after the expense exists. Every file
 * meets the server's rules first (MUT-260 A5); the first problem is shown, never one toast per file (the toast is a
 * single slot), and the files that pass go on. Names in a sentence are isolated (FSI…PDI), so a Latin filename keeps
 * its order inside Arabic (as CloseAccountDrawer).
 */
export function ReceiptPickButton({ room, onPick, disabled = false, busy = false }: ReceiptPickButtonProps) {
  const { t, language } = useLanguage();
  const showToast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (picked: File[]) => {
    const problem = picked.map((file) => checkReceiptFile(file)).find((p) => p !== null);
    const good = picked.filter((file) => checkReceiptFile(file) === null);
    const kept = good.slice(0, Math.max(room, 0));
    const left = good.slice(kept.length);
    if (left.length > 0) {
      const names = new Intl.ListFormat(getLocale(language), { type: 'conjunction' }).format(left.map((f) => `⁨${f.name}⁩`));
      showToast(t('hosted.expenses.drawer.receipts.queuedAtCap', { names }));
    } else if (problem) {
      showToast(t(`hosted.expenses.drawer.receipts.${problem}`));
    }
    if (kept.length > 0) onPick(kept);
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={RECEIPT_MIME_TYPES.join(',')}
        style={{ display: 'none' }}
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (picked.length > 0) handleFiles(picked);
        }}
      />
      <Button type="button" variant="secondary" size="sm" disabled={disabled || busy || room <= 0} onClick={() => inputRef.current?.click()}>
        {t(busy ? 'hosted.expenses.drawer.receipts.uploading' : 'hosted.expenses.drawer.receipts.add')}
      </Button>
    </>
  );
}

export interface QueuedReceiptsProps {
  files: File[];
  onChange: (files: File[]) => void;
}

/**
 * The new-expense drawer's receipts (MUT-491): files wait here until Save creates the expense, then the edit drawer
 * uploads them (R3). Nothing is sent from here, so closing the drawer leaves nothing behind.
 */
export function QueuedReceipts({ files, onChange }: QueuedReceiptsProps) {
  const { t } = useLanguage();
  const room = MAX_RECEIPTS_PER_EXPENSE - files.length;
  return (
    <div className="form-group">
      <label className="form-label">{t('hosted.expenses.drawer.receipts.title')}</label>
      {files.length > 0 && (
        <>
          <ul className="hp-receipt-list">
            {files.map((file, index) => (
              <li key={`${index}-${file.name}`} className="hp-receipt-row">
                <bdi>{file.name}</bdi>
                <Button type="button" variant="ghost" size="sm" onClick={() => onChange(files.filter((_, i) => i !== index))}>
                  {t('hosted.expenses.drawer.receipts.remove')}
                </Button>
              </li>
            ))}
          </ul>
          <p className="hp-muted">{t('hosted.expenses.drawer.receipts.willUpload')}</p>
        </>
      )}
      <ReceiptPickButton room={room} onPick={(picked) => onChange([...files, ...picked])} />
    </div>
  );
}
