/**
 * HomeAttentionRow
 *
 * One Needs attention row on Home (MUT-8, MUT-82): who owes it and for what,
 * what is left with how late it is, and Record Payment. The client cell is a
 * real link to the client (a button that opens the entry when there is no
 * client), so the row's own action is reachable by keyboard; a click anywhere
 * else on the row does the same (ADR-036 §1). Record Payment sits in its own
 * cell, so nothing interactive is nested in anything interactive.
 *
 * `onArrive` and `onLeave` hand the row's element to the list when it mounts
 * and while it is still in the document as it unmounts, which is when a
 * leaving row can be copied for its slide-out (`captureRowExit`).
 */

import { useLayoutEffect, useRef, type MouseEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { RecordPaymentButton } from '../ui';
import { formatAmount, cn } from '../../lib/utils';
import { useT } from '../../lib/i18n';
import type { WorkRow } from '../clients/clientProfileRows';

/** The row's Record Payment button, which focus moves to and from (MUT-82). */
export const ATTENTION_PAY_CLASS = 'home-attention-pay';

export interface HomeAttentionRowProps {
  row: WorkRow;
  locale: string;
  /** This row is the one a save just landed on (MUT-81): a soft tint plus a
   *  leading rail, fading over ~1.5s. Never true for a row a full payment is
   *  about to remove -- that row gets captureRowExit's slide-out instead. */
  flashed?: boolean;
  onOpen: (row: WorkRow) => void;
  onRecordPayment: (row: WorkRow) => void;
  onArrive: (id: string, element: HTMLTableRowElement) => void;
  onLeave: (id: string, element: HTMLTableRowElement) => void;
}

export function HomeAttentionRow({ row, locale, flashed, onOpen, onRecordPayment, onArrive, onLeave }: HomeAttentionRowProps) {
  const t = useT();
  const rowRef = useRef<HTMLTableRowElement>(null);
  const handlers = useRef({ onArrive, onLeave });
  useLayoutEffect(() => {
    handlers.current = { onArrive, onLeave };
  });

  const id = row.id;
  useLayoutEffect(() => {
    const element = rowRef.current;
    if (!element) return;
    handlers.current.onArrive(id, element);
    // The latest handler: it knows which rows a payment has just settled
    return () => handlers.current.onLeave(id, element);
  }, [id]);

  const clientId = row.tx.clientId;
  const stop = (event: MouseEvent) => event.stopPropagation();
  const label = (
    <>
      <span className="home-row-primary">{row.tx.clientName ?? t('overview.noClient')}</span>{' '}
      <span className="home-row-secondary">{row.title ?? t('clients.profile.work.untitled')}</span>
    </>
  );

  return (
    <tr ref={rowRef} className={cn('clickable', flashed && 'row-flash')} onClick={() => onOpen(row)}>
      <td className="home-row-main">
        {clientId ? (
          <Link to="/clients/$clientId" params={{ clientId }} className="home-attention-open" onClick={stop}>
            {label}
          </Link>
        ) : (
          <button
            type="button"
            className="home-attention-open"
            onClick={(event) => {
              stop(event);
              onOpen(row);
            }}
          >
            {label}
          </button>
        )}
      </td>
      <td className="amount-cell">
        <bdi dir="ltr">{formatAmount(row.tx.remainingAmountMinor ?? row.amountMinor, row.currency, locale)}</bdi>
        {row.overdueDays !== undefined ? (
          <span className="home-row-status text-danger">
            {t('transactions.status.overdue', { days: row.overdueDays })}
          </span>
        ) : (
          row.dueInDays !== undefined && (
            <span className="home-row-status">
              {row.dueInDays === 0
                ? t('transactions.status.dueToday')
                : t('transactions.status.dueIn', { days: row.dueInDays })}
            </span>
          )
        )}
      </td>
      <td className="home-attention-action">
        <RecordPaymentButton
          compact
          className={ATTENTION_PAY_CLASS}
          transaction={row.tx}
          onRecordPayment={() => onRecordPayment(row)}
        />
      </td>
    </tr>
  );
}
