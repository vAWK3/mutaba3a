import { useState, useEffect, useId, useRef, useMemo, type FormEvent } from 'react';
import { Drawer } from './Drawer';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import {
  useTransactionDisplay,
  usePaymentRecords,
  useCreatePaymentRecord,
  useUpdatePaymentRecord,
  useDeletePaymentRecord,
} from '../../hooks/useQueries';
import { cn, formatAmount, formatDate, todayISO } from '../../lib/utils';
import { isFuturePaymentDate } from '../../lib/dates';
import { describePaymentAmount, minorToAmountInput, type PaymentAmountState } from '../../lib/paymentEntry';
import type { Currency, PaymentRecord } from '../../types';
import { useDrawerStore } from '../../lib/stores';
import './PartialPaymentDrawer.css';

/**
 * PartialPaymentDrawer -- "Record payment"
 *
 * Leads with what's left (MUT-86, decision P1): the title names the balance,
 * one large amount field is prefilled with it, and a live line under the field
 * says what the typed amount leaves owed. The date reads "Today ›" and notes
 * sit behind "+ Add note", each opening into its field in place. One primary
 * button records, so opening the drawer and pressing Record Payment settles the
 * entry in full, dated today ("Paid? Two taps."). A save closes the drawer.
 *
 * Payment records own the entry's payment state (ADR-039); overpayment and
 * future dates are refused by the repository (ADR-030, ADR-038) and checked
 * here first only to say so in the user's language.
 */

type Translate = (key: string, params?: Record<string, string | number>) => string;

interface PartialPaymentDrawerProps {
  transactionId: string;
  onClose: () => void;
}

const FORM_ID = 'partial-payment-form';

// Bidi isolates: keep an amount whole inside a sentence of either direction
const FIRST_STRONG_ISOLATE = '\u2068';
const POP_ISOLATE = '\u2069';

function isolate(text: string): string {
  return `${FIRST_STRONG_ISOLATE}${text}${POP_ISOLATE}`;
}

export function PartialPaymentDrawer({ transactionId, onClose }: PartialPaymentDrawerProps) {
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);
  const historyHeadingId = useId();

  const { partialPaymentDrawer, editPaymentRecord } = useDrawerStore();
  const editingRecordId = partialPaymentDrawer.editingPaymentRecordId;

  const { data: transaction, isLoading: txLoading } = useTransactionDisplay(transactionId);
  const { data: paymentRecords = [], isLoading: recordsLoading } = usePaymentRecords(transactionId);
  const createMutation = useCreatePaymentRecord();
  const updateMutation = useUpdatePaymentRecord();
  const deleteMutation = useDeletePaymentRecord();

  const [deletingRecordId, setDeletingRecordId] = useState<string | null>(null);

  const editingRecord = useMemo(
    () => editingRecordId ? paymentRecords.find((r) => r.id === editingRecordId) : undefined,
    [editingRecordId, paymentRecords]
  );

  // An edit waits for its record. Mounting the form without it would fall
  // back to create mode, and the button would record a second payment.
  const waitingForRecord = !!editingRecordId && recordsLoading;

  if (txLoading || !transaction || waitingForRecord) {
    return (
      <Drawer title={t('transactions.partialPayment.title')} onClose={onClose}>
        <div className="loading">
          <div className="spinner" />
        </div>
      </Drawer>
    );
  }

  const receivedAmountMinor = transaction.receivedAmountMinor ?? 0;
  const remainingAmountMinor = transaction.amountMinor - receivedAmountMinor;
  // Nothing left to record (ADR-030 legacy rows can even be over): no form
  const settled = !editingRecord && remainingAmountMinor <= 0;
  // An edited record's own amount is part of what it may be changed to
  const allowedMinor = editingRecord ? remainingAmountMinor + editingRecord.amountMinor : remainingAmountMinor;

  const handleDeleteRecord = async (recordId: string) => {
    try {
      await deleteMutation.mutateAsync({ id: recordId, transactionId });
      setDeletingRecordId(null);
    } catch {
      // Error shown inline
    }
  };

  const returnToEntry = () => {
    useDrawerStore.getState().openPartialPaymentDrawer({ transactionId });
  };

  const isPending = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

  const title = editingRecord
    ? t('transactions.partialPayment.editPayment')
    : settled
      ? t('transactions.partialPayment.title')
      : t('transactions.partialPayment.titleLeft', {
          amount: isolate(formatAmount(remainingAmountMinor, transaction.currency, locale)),
        });

  const footer = (
    <div className="pay-drawer-actions">
      {settled ? (
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          {t('common.close')}
        </button>
      ) : (
        <>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={editingRecord ? returnToEntry : onClose}
            disabled={isPending}
          >
            {t('common.cancel')}
          </button>
          <button type="submit" form={FORM_ID} className="btn btn-primary" disabled={isPending}>
            {isPending
              ? t('common.saving')
              : editingRecord
                ? t('transactions.partialPayment.updatePayment')
                : t('transactions.partialPayment.record')}
          </button>
        </>
      )}
    </div>
  );

  return (
    <Drawer title={title} onClose={onClose} footer={footer}>
      {settled ? (
        <p className="pay-drawer-status pay-drawer-status--done">
          <CheckIcon />
          {t('transactions.partialPayment.paidInFull')}
        </p>
      ) : (
        // key: a fresh form, freshly prefilled, for each record edited and
        // whenever what's left changes under it (a payment deleted below)
        <PaymentForm
          key={editingRecord?.id ?? `create-${remainingAmountMinor}`}
          transactionId={transactionId}
          currency={transaction.currency}
          allowedMinor={allowedMinor}
          locale={locale}
          editingRecord={editingRecord}
          createMutation={createMutation}
          updateMutation={updateMutation}
          isPending={isPending}
          onRecorded={onClose}
          onUpdated={returnToEntry}
          t={t}
        />
      )}

      {/* Payment history: only when there is some */}
      {!recordsLoading && paymentRecords.length > 0 && (
        <section className="pay-drawer-history" aria-labelledby={historyHeadingId}>
          <h3 className="pay-drawer-history-title" id={historyHeadingId}>
            {t('transactions.partialPayment.history')}
          </h3>
          <div className="pay-drawer-history-list">
            {paymentRecords.map((record) => (
              <PaymentRecordRow
                key={record.id}
                record={record}
                currency={transaction.currency}
                locale={locale}
                isEditing={editingRecordId === record.id}
                isDeleting={deletingRecordId === record.id}
                disabled={isPending}
                onEdit={() => editPaymentRecord({ transactionId, paymentRecordId: record.id })}
                onDelete={() => setDeletingRecordId(record.id)}
                onConfirmDelete={() => handleDeleteRecord(record.id)}
                onCancelDelete={() => setDeletingRecordId(null)}
                t={t}
              />
            ))}
          </div>
        </section>
      )}
    </Drawer>
  );
}

type AmountTone = 'done' | 'owed' | 'error';

/**
 * The line under the amount. The answer ("Paid in full", "₪1,775 still
 * owed") and an overpayment show live; text that can't be recorded as typed
 * says why only once Record is pressed, so a half-typed "1,2" on its way to
 * "1,200" never nags.
 */
function amountLine(
  state: PaymentAmountState,
  showErrors: boolean,
  currency: Currency,
  locale: string,
  t: Translate
): { tone: AmountTone; text: string } | null {
  switch (state.kind) {
    case 'paidInFull':
      return { tone: 'done', text: t('transactions.partialPayment.paidInFull') };
    case 'stillOwed':
      return {
        tone: 'owed',
        text: t('transactions.partialPayment.stillOwed', { amount: isolate(formatAmount(state.leftMinor, currency, locale)) }),
      };
    case 'over':
      return {
        tone: 'error',
        text: t('transactions.partialPayment.overpayment', {
          amount: isolate(formatAmount(Math.max(0, state.allowedMinor), currency, locale)),
        }),
      };
    case 'invalid':
      return showErrors ? { tone: 'error', text: t('validation.amountInvalid') } : null;
    case 'currencyMismatch':
      return showErrors
        ? { tone: 'error', text: t('validation.amountCurrencyMismatch', { typed: state.typed, currency }) }
        : null;
    case 'empty':
    case 'notPositive':
      return showErrors ? { tone: 'error', text: t('transactions.partialPayment.amountMustBePositive') } : null;
  }
}

// Extracted form component -- remounts via key when the edited record changes
function PaymentForm({
  transactionId,
  currency,
  allowedMinor,
  locale,
  editingRecord,
  createMutation,
  updateMutation,
  isPending,
  onRecorded,
  onUpdated,
  t,
}: {
  transactionId: string;
  currency: Currency;
  /** The most this payment may be: what's left, plus the edited record's own amount */
  allowedMinor: number;
  locale: string;
  editingRecord?: PaymentRecord;
  createMutation: ReturnType<typeof useCreatePaymentRecord>;
  updateMutation: ReturnType<typeof useUpdatePaymentRecord>;
  isPending: boolean;
  onRecorded: () => void;
  onUpdated: () => void;
  t: Translate;
}) {
  const amountId = useId();
  const amountLineId = useId();
  const dateId = useId();
  const notesId = useId();
  const amountRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLInputElement>(null);

  // Settling in full is the common case, so create mode opens with the whole
  // remaining balance already in the field -- one confirm, still editable down
  // to a partial amount (MUT-6 AC #3).
  const [amountText, setAmountText] = useState(() =>
    minorToAmountInput(editingRecord ? editingRecord.amountMinor : allowedMinor)
  );
  // todayISO() is the local calendar date (ADR-022). new Date().toISOString()
  // is the UTC one, which hands a user west of UTC tomorrow's date in the
  // evening and one east of UTC yesterday's after midnight -- silently wrong
  // on a field the user is now one confirm away from accepting.
  const [paidAt, setPaidAt] = useState(() => (editingRecord ? editingRecord.paidAt.split('T')[0] : todayISO()));
  const [notes, setNotes] = useState(() => editingRecord?.notes ?? '');
  const [dateOpen, setDateOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(() => !!editingRecord?.notes);
  // A field the user just opened takes focus; one open from the start doesn't
  const [focusTarget, setFocusTarget] = useState<'date' | 'notes' | null>(null);
  const [showAmountErrors, setShowAmountErrors] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Focused and selected, so typing replaces the prefill with a partial amount
  useEffect(() => {
    amountRef.current?.focus();
    amountRef.current?.select();
  }, []);

  useEffect(() => {
    if (focusTarget === 'date') dateRef.current?.focus();
    if (focusTarget === 'notes') notesRef.current?.focus();
  }, [focusTarget]);

  const amountState = describePaymentAmount(amountText, currency, allowedMinor);
  const line = amountLine(amountState, showAmountErrors, currency, locale, t);
  const today = todayISO();
  const dateLabel = paidAt === today ? t('time.today') : formatDate(`${paidAt}T00:00:00`, locale);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (amountState.kind !== 'paidInFull' && amountState.kind !== 'stillOwed') {
      setShowAmountErrors(true);
      amountRef.current?.focus();
      return;
    }
    if (!paidAt) {
      setError(t('validation.dateRequired'));
      return;
    }
    // A payment can't have arrived before it was received (ADR-038)
    if (isFuturePaymentDate(paidAt)) {
      setError(t('transactions.partialPayment.futureDate'));
      return;
    }

    const payment = { amountMinor: amountState.amountMinor, paidAt, notes: notes.trim() || undefined };
    try {
      if (editingRecord) {
        await updateMutation.mutateAsync({ id: editingRecord.id, transactionId, data: payment });
        onUpdated();
      } else {
        await createMutation.mutateAsync({ transactionId, ...payment });
        onRecorded();
      }
    } catch (err) {
      // The repository is the source of truth (ADR-030): a refusal it still
      // makes (records changed in another window) is shown, not swallowed
      setError((err as Error).message);
    }
  };

  return (
    <form id={FORM_ID} onSubmit={handleSubmit} noValidate>
      <div className="pay-drawer-amount">
        <label className="sr-only" htmlFor={amountId}>
          {t('transactions.partialPayment.amount')}
        </label>
        <div className="input-with-prefix pay-drawer-amount-field" dir="ltr">
          <span className="input-prefix">{currency}</span>
          <input
            ref={amountRef}
            id={amountId}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            className={cn('input', line?.tone === 'error' && 'input-error')}
            value={amountText}
            onChange={(e) => {
              setAmountText(e.target.value);
              setShowAmountErrors(false);
            }}
            placeholder={t('drawer.transaction.amountPlaceholder')}
            aria-invalid={line?.tone === 'error'}
            aria-describedby={amountLineId}
            disabled={isPending}
          />
        </div>
        <p
          id={amountLineId}
          className={cn('pay-drawer-status', line && `pay-drawer-status--${line.tone}`)}
          data-testid="payment-amount-status"
          aria-live="polite"
        >
          {line?.tone === 'done' && <CheckIcon />}
          {line?.text}
        </p>
      </div>

      {dateOpen ? (
        <div className="form-group">
          <label className="form-label" htmlFor={dateId}>
            {t('transactions.partialPayment.date')}
          </label>
          <input
            ref={dateRef}
            id={dateId}
            type="date"
            className="input"
            value={paidAt}
            max={today}
            onChange={(e) => setPaidAt(e.target.value)}
            disabled={isPending}
          />
        </div>
      ) : (
        <button
          type="button"
          className="pay-drawer-row"
          onClick={() => {
            setDateOpen(true);
            setFocusTarget('date');
          }}
          disabled={isPending}
        >
          <span className="pay-drawer-row-label">{t('transactions.partialPayment.date')}</span>
          <span className="pay-drawer-row-value">
            <bdi>{dateLabel}</bdi>
            <ChevronIcon />
          </span>
        </button>
      )}

      {notesOpen ? (
        <div className="form-group">
          <label className="form-label" htmlFor={notesId}>
            {t('transactions.partialPayment.notes')}
          </label>
          <input
            ref={notesRef}
            id={notesId}
            type="text"
            className="input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={isPending}
          />
        </div>
      ) : (
        <button
          type="button"
          className="pay-drawer-note"
          onClick={() => {
            setNotesOpen(true);
            setFocusTarget('notes');
          }}
          disabled={isPending}
        >
          <PlusIcon />
          {t('transactions.partialPayment.addNote')}
        </button>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function CheckIcon() {
  return (
    <svg className="pay-drawer-status-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg className="pay-drawer-row-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" d="M12 5v14M5 12h14" />
    </svg>
  );
}

// Payment record row component
interface PaymentRecordRowProps {
  record: PaymentRecord;
  currency: Currency;
  locale: string;
  isEditing: boolean;
  isDeleting: boolean;
  disabled: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  t: (key: string) => string;
}

function PaymentRecordRow({
  record,
  currency,
  locale,
  isEditing,
  isDeleting,
  disabled,
  onEdit,
  onDelete,
  onConfirmDelete,
  onCancelDelete,
  t,
}: PaymentRecordRowProps) {
  if (isDeleting) {
    return (
      <div className="pay-drawer-record pay-drawer-record--deleting">
        <span>{t('transactions.partialPayment.deleteConfirm')}</span>
        <div className="pay-drawer-record-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onCancelDelete}
            disabled={disabled}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-sm pay-drawer-record-delete"
            onClick={onConfirmDelete}
            disabled={disabled}
          >
            {t('transactions.partialPayment.deletePayment')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('pay-drawer-record', isEditing && 'pay-drawer-record--editing')}>
      <div className="pay-drawer-record-main">
        <div className="pay-drawer-record-line">
          <span className="pay-drawer-record-date">{formatDate(record.paidAt, locale)}</span>
          <span className="pay-drawer-record-amount">{formatAmount(record.amountMinor, currency, locale)}</span>
        </div>
        {record.notes && <span className="pay-drawer-record-notes">{record.notes}</span>}
      </div>
      <div className="pay-drawer-record-actions">
        <button
          type="button"
          className="btn btn-ghost btn-sm pay-drawer-record-action"
          onClick={onEdit}
          disabled={disabled}
          title={t('transactions.partialPayment.editPayment')}
        >
          &#9998;
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm pay-drawer-record-action pay-drawer-record-delete"
          onClick={onDelete}
          disabled={disabled}
          title={t('transactions.partialPayment.deletePayment')}
        >
          &#128465;
        </button>
      </div>
    </div>
  );
}
