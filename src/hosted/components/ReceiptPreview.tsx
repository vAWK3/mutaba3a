import { useRef, useState } from 'react';
import { useLanguage } from '../../lib/i18n/core';
import { BrandLoader } from '../../components/brand/BrandLoader';
import type { ExpenseReceipt } from '../api/client';
import { useReceiptDownload } from '../data/receiptQueries';

/**
 * A receipt's original, large (MUT-260 D2, D3, layout B): an image with Fit / Actual size, or a PDF in an iframe,
 * plus "Open full size" in a new tab. Both read one inline signed URL (A12: the PDF needs it to display, and Open full
 * size needs it to show rather than save; the image reuses it). A URL that has expired by the time it loads is
 * fetched again once (D5).
 */
export interface ReceiptPreviewProps {
  profileId: string;
  receipt: Pick<ExpenseReceipt, 'id' | 'filename' | 'mimeType'>;
}

export function ReceiptPreview({ profileId, receipt }: ReceiptPreviewProps) {
  const { t } = useLanguage();
  const download = useReceiptDownload(profileId, receipt.id, 'inline');
  const [actualSize, setActualSize] = useState(false);
  const retried = useRef(false);
  const isPdf = receipt.mimeType === 'application/pdf';
  const url = download.data?.url;

  const onExpired = () => {
    if (retried.current) return;
    retried.current = true;
    void download.refetch();
  };

  return (
    <figure className="hp-receipt-preview" aria-label={t('hosted.receipts.preview.label', { name: receipt.filename })}>
      <div className="hp-receipt-preview-toolbar">
        <bdi className="hp-receipt-preview-name">{receipt.filename}</bdi>
        {!isPdf && url && (
          <button type="button" className="hp-link-button" aria-pressed={actualSize} onClick={() => setActualSize((on) => !on)}>
            {t(actualSize ? 'hosted.receipts.preview.fit' : 'hosted.receipts.preview.actual')}
          </button>
        )}
        {url && (
          <a className="hp-link" href={url} target="_blank" rel="noopener noreferrer" data-testid="receipt-open-full">
            {t('hosted.receipts.preview.openFull')}
          </a>
        )}
      </div>
      <div className={actualSize ? 'hp-receipt-preview-frame hp-receipt-preview-actual' : 'hp-receipt-preview-frame'}>
        {download.isError ? (
          <p className="hp-muted" role="alert">
            {t('hosted.receipts.errors.previewFailed')}
          </p>
        ) : !url ? (
          <div className="loading loading--section">
            <BrandLoader size={40} />
          </div>
        ) : isPdf ? (
          <iframe src={url} title={t('hosted.receipts.preview.pdfTitle', { name: receipt.filename })} className="hp-receipt-pdf" />
        ) : (
          <img src={url} alt={t('hosted.receipts.preview.label', { name: receipt.filename })} onError={onExpired} />
        )}
      </div>
    </figure>
  );
}
