import { useEffect, useState } from 'react';
import { useLanguage } from '../../../lib/i18n/core';
import { BrandLoader } from '../../../components/brand/BrandLoader';
import type { ExpenseReceipt } from '../../api/client';
import { Drawer } from '../../components/Drawer';
import { DecimalAmount } from '../../format/DecimalAmount';
import { isClientGone, useClientExpense, useClientReceiptUrl } from '../../data/clientBooksQueries';
import { moneyDay } from './clientBooksRules';

/**
 * MUT-562 (C3): a client expense's receipts, beside the table: the portal's side drawer (a sheet on a phone). An image
 * or a PDF previews from an inline URL (MUT-575 S4); "Download receipt" asks for the attachment URL when pressed. Read
 * only: nothing here adds, moves or deletes a receipt.
 */
export function ClientReceiptPane({ profileId, expenseId, onClose, onGone }: { profileId: string; expenseId: string; onClose: () => void; onGone: () => void }) {
  const { t, language } = useLanguage();
  const expense = useClientExpense(profileId, expenseId);
  const gone = isClientGone(expense.error);
  useEffect(() => {
    if (gone) onGone();
  }, [gone, onGone]);
  const receipts = expense.data?.receipts.filter((receipt) => receipt.status === 'READY') ?? [];

  return (
    <Drawer title={t('hosted.clientBooks.receipt.title')} onClose={onClose} closeLabel={t('hosted.clientBooks.receipt.close')}>
      {expense.isPending ? (
        <div className="loading loading--section">
          <BrandLoader size={40} />
        </div>
      ) : expense.isError ? (
        <p className="hp-muted" role="alert">
          {t('hosted.clientBooks.receipt.failed')}
        </p>
      ) : (
        <>
          <p className="hp-receipt-pane-line">
            <bdi dir="auto">{expense.data.title ?? expense.data.vendor ?? t('hosted.clientBooks.table.untitled')}</bdi> · <DecimalAmount value={`-${expense.data.amount}`} currency={expense.data.currency} /> ·{' '}
            {moneyDay(expense.data.occurredOn, language)}
          </p>
          {receipts.length === 0 ? (
            <p className="hp-muted">{t('hosted.clientBooks.receipt.none')}</p>
          ) : (
            <ul className="hp-receipt-pane-list">
              {receipts.map((receipt) => (
                <li key={receipt.id}>
                  <ReceiptPreview profileId={profileId} expenseId={expenseId} receipt={receipt} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Drawer>
  );
}

function ReceiptPreview({ profileId, expenseId, receipt }: { profileId: string; expenseId: string; receipt: ExpenseReceipt }) {
  const { t } = useLanguage();
  const inline = useClientReceiptUrl(profileId, expenseId, receipt.id, 'inline');
  const [wantsDownload, setWantsDownload] = useState(false);
  const download = useClientReceiptUrl(profileId, expenseId, receipt.id, 'attachment', wantsDownload);
  const isPdf = receipt.mimeType === 'application/pdf';

  // The attachment URL arrives after the press: follow it once, so the browser saves the file
  useEffect(() => {
    if (wantsDownload && download.data?.url) {
      window.location.assign(download.data.url);
      setWantsDownload(false);
    }
  }, [wantsDownload, download.data?.url]);

  return (
    <figure className="hp-receipt-preview" aria-label={t('hosted.receipts.preview.label', { name: receipt.filename })}>
      <div className="hp-receipt-preview-toolbar">
        <bdi className="hp-receipt-preview-name">{receipt.filename}</bdi>
        <button type="button" className="hp-link-button press" onClick={() => setWantsDownload(true)} disabled={wantsDownload}>
          {t('hosted.clientBooks.receipt.download')}
        </button>
      </div>
      <div className="hp-receipt-preview-frame">
        {inline.isError ? (
          <p className="hp-muted" role="alert">
            {t('hosted.clientBooks.receipt.failed')}
          </p>
        ) : !inline.data ? (
          <div className="loading loading--section">
            <BrandLoader size={40} />
          </div>
        ) : isPdf ? (
          <iframe src={inline.data.url} title={t('hosted.receipts.preview.pdfTitle', { name: receipt.filename })} className="hp-receipt-pdf" />
        ) : (
          <img src={inline.data.url} alt={t('hosted.receipts.preview.label', { name: receipt.filename })} />
        )}
      </div>
    </figure>
  );
}
