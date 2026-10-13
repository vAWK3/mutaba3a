/**
 * ClientPaymentsSection
 *
 * "When did they pay, and for what?" (MUT-3, MUT-4 UI): the client's full
 * payment history, newest first, each row labelled with the entry it paid
 * for. Never filtered by the work list (D5); amounts are per row, never
 * totalled across currencies.
 *
 * A row opens whatever owns it (D4): a recorded payment opens the payment
 * drawer in edit mode (which also offers delete); money saved on the entry
 * itself -- income logged as Received -- opens that income entry.
 */

import { usePaymentsByClient } from '../../hooks/useQueries';
import { useSavedFlashRows } from '../../hooks/useSavedFlash';
import { RowActionsMenu, RowActionsHeader, AmountWithConversion, type RowAction } from '../ui';
import { useDrawerStore } from '../../lib/stores';
import { formatPaymentDate, cn } from '../../lib/utils';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import { MIGRATED_PAYMENT_NOTE } from '../../db/database';
import type { PaymentByClientRow } from '../../types';

export interface ClientPaymentsSectionProps {
  clientId: string;
}

export function ClientPaymentsSection({ clientId }: ClientPaymentsSectionProps) {
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);
  const { openIncomeDrawer, editPaymentRecord } = useDrawerStore();
  // Rows arrive shaped from the repository (joined title, currency, source)
  const { data: payments = [], isLoading, isFetching } = usePaymentsByClient(clientId);
  const isFlashed = useSavedFlashRows(
    `client-payments-${clientId}`,
    payments.map((p) => p.id),
    { isLoading, isFetching }
  );

  const openEntry = (payment: PaymentByClientRow) =>
    openIncomeDrawer({ mode: 'edit', transactionId: payment.transactionId });

  const openPayment = (payment: PaymentByClientRow) =>
    payment.source === 'record'
      ? editPaymentRecord({ transactionId: payment.transactionId, paymentRecordId: payment.id })
      : openEntry(payment);

  const rowActions = (payment: PaymentByClientRow): RowAction[] => [
    ...(payment.source === 'record'
      ? [{ label: t('transactions.partialPayment.editPayment'), onClick: () => openPayment(payment) }]
      : []),
    { label: t('clients.profile.payments.openEntry'), onClick: () => openEntry(payment) },
  ];

  // Only what the user wrote (MUT-92): where a payment was saved and the note
  // the migrations stored are provenance, not notes.
  const notesFor = (payment: PaymentByClientRow) =>
    payment.source === 'entry' || payment.notes === MIGRATED_PAYMENT_NOTE ? undefined : payment.notes;
  const showNotes = payments.some((payment) => !!notesFor(payment));

  return (
    <section className="client-section" aria-labelledby="client-payments-title">
      <div className="client-section-header">
        <h2 id="client-payments-title" className="client-section-title">
          {t('clients.profile.payments.title')}
        </h2>
      </div>

      {isLoading ? null : payments.length === 0 ? (
        <p className="card-empty">{t('transactions.partialPayment.noPayments')}</p>
      ) : (
        <div className="data-table client-payments-table">
          <table>
            <thead>
              <tr>
                <th>{t('transactions.columns.date')}</th>
                <th style={{ textAlign: 'end' }}>{t('transactions.columns.amount')}</th>
                <th>{t('clients.profile.payments.for')}</th>
                {showNotes && <th>{t('transactions.partialPayment.notes')}</th>}
                <RowActionsHeader />
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr
                  key={payment.id}
                  className={cn('clickable', isFlashed(payment.id) && 'row-flash')}
                  onClick={() => openPayment(payment)}
                >
                  <td className="client-work-date">{formatPaymentDate(payment.paidAt, locale)}</td>
                  <td className="amount-cell">
                    <AmountWithConversion amountMinor={payment.amountMinor} currency={payment.currency} type="income" />
                  </td>
                  <td className="client-payment-for">
                    {payment.transactionTitle ?? (
                      <span className="text-muted">{t('clients.profile.work.untitled')}</span>
                    )}
                  </td>
                  {showNotes && <td className="client-payment-notes">{notesFor(payment)}</td>}
                  <td>
                    <div className="row-actions-cell">
                      <RowActionsMenu actions={rowActions(payment)} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
