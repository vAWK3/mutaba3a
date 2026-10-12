/**
 * HomeNeedsAttention
 *
 * "Who is late?" on Home (MUT-8): every receivable that is overdue or due
 * within 7 days, oldest due date first. Bucketing goes through the shared
 * ADR-010/022 helpers (selectAttentionReceivables, toWorkRow); amounts stay in
 * their own currency. A row opens its client, or the entry itself when it has
 * no client.
 *
 * Record a payment in place (MUT-82, brief H1, ADR-055): each row's Record
 * Payment opens the payment drawer, prefilled with what is left and today.
 * - The list is selected from the same receivables query Owed now reads, so a
 *   save changes the row and Owed now in the same render.
 * - A row the payment settled slides out (captureRowExit); a partial payment
 *   keeps the row with its new amount.
 * - A toast offers Undo, which deletes the payment record (usePaymentUndo).
 * - Focus never falls to the page. A payment that settles a row moves focus
 *   to the next row's Record Payment as the drawer closes (the drawer would
 *   otherwise return it to a button that is about to go); a row Undo brings
 *   back takes it again.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useReceivables } from '../../hooks/useIncomeQueries';
import { usePaymentUndo } from '../../hooks/usePaymentUndo';
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion';
import { useSavedFlashRows } from '../../hooks/useSavedFlash';
import { useSavedFlashStore } from '../../lib/savedFlashStore';
import { useDrawerStore } from '../../lib/stores';
import { toWorkRow, type WorkRow } from '../clients/clientProfileRows';
import { CheckCircleIcon } from '../icons';
import { formatAmount } from '../../lib/utils';
import { todayLocalISO } from '../../lib/dates';
import { selectAttentionReceivables } from '../../lib/attention';
import { captureRowExit } from '../../lib/motion/rowExit';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import { HomeAttentionRow, ATTENTION_PAY_CLASS } from './HomeAttentionRow';
import type { BusinessProfile, PaymentRecord, ProfileScope } from '../../types';
import './HomeNeedsAttention.css';

export interface HomeNeedsAttentionProps {
  /** Home's scope: the same filters as Owed now, so both read one query (ADR-055) */
  profileId?: ProfileScope;
  /** Under All businesses, the businesses to tag rows with (MUT-89) */
  businesses?: ReadonlyMap<string, BusinessProfile>;
}

// Bidi isolate: keep a name or an amount whole inside a sentence of either direction
const isolate = (text: string) => `⁨${text}⁩`;

const focusIsLost = () => !document.activeElement || document.activeElement === document.body;

/** Where focus goes when a row it was in leaves: the next row's Record Payment, else the previous one's. */
function neighbourAction(row: HTMLTableRowElement): HTMLElement | null {
  const neighbour = row.nextElementSibling ?? row.previousElementSibling;
  return neighbour?.querySelector<HTMLElement>(`.${ATTENTION_PAY_CLASS}`) ?? null;
}

export function HomeNeedsAttention({ profileId, businesses }: HomeNeedsAttentionProps) {
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);
  const navigate = useNavigate();
  const { openIncomeDrawer, openPartialPaymentDrawer } = useDrawerStore();
  const reducedMotion = usePrefersReducedMotion();
  const { offerUndo } = usePaymentUndo();
  // The receivables Owed now reads (same filters, same query): one refetch
  // changes both in one render (ADR-055)
  const { data: receivables = [], isLoading, isFetching, dataUpdatedAt } = useReceivables({ profileId });

  const today = todayLocalISO();
  const rows = useMemo(
    () => selectAttentionReceivables(receivables, today).map((tx) => toWorkRow(tx, today)),
    [receivables, today]
  );
  // A partial payment keeps its row: MUT-81's tint is the only after-save
  // feedback it gets (a full payment's row leaves instead, see onRecorded
  // below -- that path never reaches this list).
  const isFlashed = useSavedFlashRows(
    'home-needs-attention',
    rows.map((row) => row.id),
    { isLoading, isFetching }
  );

  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The rows on screen, so a payment can find its row's neighbours
  const rowElements = useRef(new Map<string, HTMLTableRowElement>());
  // Rows a payment from here settled, with when: their departure slides out
  const settledAt = useRef(new Map<string, number>());
  // The row Undo is bringing back, with when: it takes focus if focus was lost
  const returning = useRef<{ id: string; at: number } | null>(null);

  // Marks the data has answered are spent: a row a payment did not take off
  // the list (an entry with an uncovered received amount, TD-063) must not
  // slide out later for another reason
  useEffect(() => {
    settledAt.current.forEach((at, id) => {
      if (dataUpdatedAt > at) settledAt.current.delete(id);
    });
    if (returning.current && dataUpdatedAt > returning.current.at) returning.current = null;
  }, [dataUpdatedAt]);

  const open = (row: WorkRow) =>
    row.tx.clientId
      ? navigate({ to: '/clients/$clientId', params: { clientId: row.tx.clientId } })
      : openIncomeDrawer({ mode: 'edit', transactionId: row.id });

  const recordedMessage = (row: WorkRow, record: PaymentRecord) => {
    const amount = isolate(formatAmount(record.amountMinor, row.currency, locale));
    return row.tx.clientName
      ? t('overview.paymentRecorded', { amount, client: isolate(row.tx.clientName) })
      : t('overview.paymentRecordedNoClient', { amount });
  };

  const recordPayment = (row: WorkRow) =>
    openPartialPaymentDrawer({
      transactionId: row.id,
      onRecorded: (record) => {
        const leftMinor = row.tx.remainingAmountMinor ?? row.amountMinor;
        if (record.amountMinor >= leftMinor) {
          // The drawer already called markSaved unconditionally (MUT-81 eng
          // review D3). This row is about to leave via captureRowExit, which
          // is already complete feedback (ADR-055 SS5-6) -- without this, the
          // flash mechanism would otherwise report "not visible" the moment
          // this list stops rendering the id and announce a confusing
          // "Saved to X . Show" under a slide-out that already said it all
          // (eng review D10).
          useSavedFlashStore.getState().clear();
          settledAt.current.set(row.id, Date.now());
          // Taken now, before the drawer closes: it gives focus back to its
          // trigger only while focus is still inside it
          const element = rowElements.current.get(row.id);
          const next = (element && neighbourAction(element)) ?? headingRef.current;
          next?.focus({ preventScroll: true });
        }
        offerUndo(record, recordedMessage(row, record), () => {
          returning.current = { id: row.id, at: Date.now() };
        });
      },
    });

  const onArrive = useCallback((id: string, element: HTMLTableRowElement) => {
    rowElements.current.set(id, element);
    if (returning.current?.id !== id) return;
    returning.current = null;
    if (focusIsLost()) element.querySelector<HTMLElement>(`.${ATTENTION_PAY_CLASS}`)?.focus({ preventScroll: true });
  }, []);

  const onLeave = useCallback(
    (id: string, element: HTMLTableRowElement) => {
      if (rowElements.current.get(id) === element) rowElements.current.delete(id);
      const at = settledAt.current.get(id);
      const section = sectionRef.current;
      if (at === undefined || !section) return;
      settledAt.current.delete(id);

      // Captured now, while the row is still in the document
      const exit = captureRowExit(element, section);
      const hadFocus = element.contains(document.activeElement);
      const nextFocus = neighbourAction(element);
      queueMicrotask(() => {
        // StrictMode's rehearsal: the row is still here
        if (element.isConnected) {
          settledAt.current.set(id, at);
          return;
        }
        exit?.play({ reducedMotion });
        // The row itself held focus (it was focused again before it left)
        if (hadFocus && focusIsLost()) {
          (nextFocus?.isConnected ? nextFocus : headingRef.current)?.focus({ preventScroll: true });
        }
      });
    },
    [reducedMotion]
  );

  return (
    <section ref={sectionRef} className="card home-section home-attention" aria-labelledby="home-attention-title">
      <div className="card-header">
        <h2 ref={headingRef} id="home-attention-title" className="card-title" tabIndex={-1}>
          {t('overview.needsAttention')}
        </h2>
        {rows.length > 0 && <span className="home-section-count">{rows.length}</span>}
      </div>

      {isLoading ? null : rows.length === 0 ? (
        <div className="card-empty home-section-empty">
          <CheckCircleIcon size={20} />
          <p>{t('overview.noAttention')}</p>
        </div>
      ) : (
        <div className="data-table home-table">
          <table>
            <tbody>
              {rows.map((row) => (
                <HomeAttentionRow
                  key={row.id}
                  row={row}
                  locale={locale}
                  businesses={businesses}
                  flashed={isFlashed(row.id)}
                  onOpen={open}
                  onRecordPayment={recordPayment}
                  onArrive={onArrive}
                  onLeave={onLeave}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
