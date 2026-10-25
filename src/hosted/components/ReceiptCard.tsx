import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useLanguage } from '../../lib/i18n/core';
import type { ReceiptListItem } from '../api/client';
import { useReceiptDownload } from '../data/receiptQueries';
import { DecimalAmount } from '../format/DecimalAmount';
import { formatDay } from '../format/dates';

/**
 * One receipt in the Receipts gallery (MUT-260 D5, layout B): a thumbnail, its status, when it came in, and for a
 * filed receipt its expense's vendor and amount. An image card asks for its signed original only once it scrolls
 * into view, then lets the browser load it lazily; a PDF card shows a PDF tile and fetches nothing.
 */
export interface ReceiptCardProps {
  profileId: string;
  item: ReceiptListItem;
  to: string;
}

/** True once the element has been in view (IntersectionObserver); at once where there is none to ask. */
function useSeen<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (seen || !ref.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [seen]);
  return [ref, seen];
}

function ImageThumb({ profileId, item }: { profileId: string; item: ReceiptListItem }) {
  const [ref, seen] = useSeen<HTMLSpanElement>();
  const download = useReceiptDownload(profileId, item.id, 'attachment', seen);
  const retried = useRef(false);
  return (
    <span ref={ref} className="hp-receipt-thumb">
      {download.data && (
        <img
          src={download.data.url}
          alt=""
          loading="lazy"
          onError={() => {
            // An expired URL (D5): one more, then the tile stays blank.
            if (retried.current) return;
            retried.current = true;
            void download.refetch();
          }}
        />
      )}
    </span>
  );
}

export function ReceiptCard({ profileId, item, to }: ReceiptCardProps) {
  const { t, language } = useLanguage();
  const isPdf = item.mimeType === 'application/pdf';
  const status = item.filingStatus === 'FILED' ? 'filed' : 'to_review';
  return (
    <li className="hp-receipt-card" data-receipt-id={item.id} data-status={status}>
      <Link to={to} className="hp-receipt-card-link" aria-label={t('hosted.receipts.open', { name: item.filename })}>
        {isPdf ? (
          <span className="hp-receipt-thumb hp-receipt-thumb-pdf" aria-hidden="true">
            {t('hosted.receipts.pdf')}
          </span>
        ) : (
          <ImageThumb profileId={profileId} item={item} />
        )}
        <span className="hp-receipt-card-meta">
          <span className={`hp-receipt-chip hp-receipt-chip-${status}`}>{t(`hosted.receipts.status.${status}`)}</span>
          <span className="hp-receipt-card-day">{formatDay(item.receivedOn, language)}</span>
        </span>
        {item.expense && (
          <span className="hp-receipt-card-expense">
            {item.expense.vendor || item.expense.title ? <bdi>{item.expense.vendor ?? item.expense.title}</bdi> : null}
            <DecimalAmount value={item.expense.amount} currency={item.expense.currency} />
          </span>
        )}
      </Link>
    </li>
  );
}
