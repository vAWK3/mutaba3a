import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useLanguage } from '../../lib/i18n/core';
import type { ReceiptListItem } from '../api/client';
import { useReceiptDownload } from '../data/receiptQueries';
import { DecimalAmount } from '../format/DecimalAmount';
import { formatDay } from '../format/dates';
import { MoreActionsMenu, type MoreAction } from './MoreActionsMenu';

/**
 * One receipt in the Receipts gallery (MUT-260 D5, layout B): a thumbnail, its status, when it came in, and for a
 * filed receipt its expense's vendor and amount. An image card asks for its signed original only once it scrolls
 * into view, then lets the browser load it lazily; a PDF card shows a PDF tile and fetches nothing.
 */
export interface ReceiptCardProps {
  profileId: string;
  item: ReceiptListItem;
  to: string;
  /** MUT-503 (DR5): the card's ⋯ menu; absent or empty, no ⋯. */
  actions?: readonly MoreAction[];
  /** MUT-503 (DR4): moved away; the card fades out before the list drops it. */
  leaving?: boolean;
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
          onLoad={() => {
            retried.current = false;
          }}
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

export function ReceiptCard({ profileId, item, to, actions, leaving = false }: ReceiptCardProps) {
  const { t, language } = useLanguage();
  const isPdf = item.mimeType === 'application/pdf';
  const status = item.filingStatus === 'FILED' ? 'filed' : 'to_review';
  return (
    <li className={`hp-receipt-card ${leaving ? 'hp-receipt-card-leaving' : ''}`} data-receipt-id={item.id} data-status={status} aria-hidden={leaving || undefined}>
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
        {/* MUT-441: the server is reading it (the review page fills in when it's done). */}
        {item.reading === 'pending' && (
          <span className="hp-receipt-card-meta">
            <span className="hp-receipt-card-day">{t('hosted.receipts.reading')}</span>
          </span>
        )}
        {item.expense && (
          <span className="hp-receipt-card-expense">
            {item.expense.vendor || item.expense.title ? <bdi>{item.expense.vendor ?? item.expense.title}</bdi> : null}
            <DecimalAmount value={item.expense.amount} currency={item.expense.currency} />
          </span>
        )}
      </Link>
      {actions && actions.length > 0 && (
        <MoreActionsMenu label={t('hosted.receipts.moreActions', { name: item.filename })} actions={actions} buttonClassName="hp-receipt-more" panelClassName="hp-receipt-menu">
          <span className="hp-receipt-more-chip hp-glass" aria-hidden="true">
            ⋯
          </span>
        </MoreActionsMenu>
      )}
    </li>
  );
}
