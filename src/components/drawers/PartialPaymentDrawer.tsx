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
import { cn, formatAmount, formatDate, formatPaymentDate, isolateAmount, todayISO } from '../../lib/utils';
import { isFuturePaymentDate, paymentLocalDay } from '../../lib/dates';
import { describePaymentAmount, minorToAmountInput, type PaymentAmountState } from '../../lib/paymentEntry';
import type { Currency, PaymentRecord } from '../../types';
import { useDrawerStore } from '../../lib/stores';
import { useSavedFlashStore } from '../../lib/savedFlashStore';
import './PartialPaymentDrawer.css';
import { BrandLoader } from '../brand/BrandLoader';

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
 *
 * `onRecorded` hears the record a save created, just before the drawer
 * closes, so the screen that opened it can offer Undo (MUT-82). An update or
 * a delete is not reported.
 *
 * Opened with the 'editPayment' intent (MUT-169: the /income ledger and the
 * income drawer), it never offers to record a payment. An entry with one
 * record opens on that record's edit, date first; one with several lists them
 * to pick from; one whose records failed to load says so, with Retry.
 */

type Translate = (key: string, params?: Record<string, string | number>) => string;

interface PartialPaymentDrawerProps {
  transactionId: string;
  onClose: () => void;
  onRecorded?: (record: PaymentRecord) => void;
}

const FORM_ID = 'partial-payment-form';
const NO_RECORDS: PaymentRecord[] = [];

export function PartialPaymentDrawer({ transactionId, onClose, onRecorded }: PartialPaymentDrawerProps) {
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);
  const historyHeadingId = useId();

  const { partialPaymentDrawer, editPaymentRecord } = useDrawerStore();
  const editingRecordId = partialPaymentDrawer.editingPaymentRecordId;
  const editIntent = partialPaymentDrawer.intent === 'editPayment';

  const { data: transaction, isLoading: txLoading } = useTransactionDisplay(transactionId);
  const {
    data: loadedRecords,
    isLoading: recordsLoading,
    isError: recordsError,
    isFetching: recordsFetching,
    refetch: refetchRecords,
  } = usePaymentRecords(transactionId);
  const paymentRecords = loadedRecords ?? NO_RECORDS;
  // Nothing to show: a failed background refetch keeps the records already loaded
  const recordsFailed = recordsError && !loadedRecords;
  const createMutation = useCreatePaymentRecord();
  const updateMutation = useUpdatePaymentRecord();
  const deleteMutation = useDeletePaymentRecord();
  const markSaved = useSavedFlashStore((s) => s.markSaved);

  const [deletingRecordId, setDeletingRecordId] = useState<string | null>(null);

  // Under the edit intent, an entry's only record is the one to edit
  const editingRecord = useMemo(() => {
    if (editingRecordId) return paymentRecords.find((r) => r.id === editingRecordId);
    return editIntent && paymentRecords.length === 1 ? paymentRecords[0] : undefined;
  }, [editingRecordId, editIntent, paymentRecords]);

  // An edit waits for its record. Mounting the form without it would fall
  // back to create mode, and the button would record a second payment.
  const waitingForRecord = (!!editingRecordId || editIntent) && recordsLoading;

  if (txLoading || !transaction || waitingForRecord) {
    return (
      <Drawer title={t('transactions.partialPayment.title')} onClose={onClose}>
        <div className="loading loading--section">
          <BrandLoader size={40} />
        </div>
      </Drawer>
    );
  }

  // A failed read looks like no records: under the edit intent that would say
  // a paid entry has no payments, so it says the read failed instead (MUT-169)
  if (editIntent && recordsFailed) {
    return (
      <Drawer
        title={t('transactions.partialPayment.editPayment')}
        onClose={onClose}
        footer={
          <div className="pay-drawer-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {t('common.close')}
            </button>
          </div>
        }
      >
        <div className="drawer-notice" role="alert">
          <div className="drawer-notice-body">{t('transactions.partialPayment.loadFailed')}</div>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => void refetchRecords()}
            disabled={recordsFetching}
            aria-busy={recordsFetching}
          >
            {recordsFetching ? t('common.loading') : t('drawer.income.paymentsRetry')}
          </button>
        </div>
      </Drawer>
    );
  }

  // Asked to edit an entry with no record, or several: list them, record nothing
  const pickerMode = editIntent && !editingRecord;

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

  // The opener still hears a payment recorded from the entry's view
  const returnToEntry = () => {
    useDrawerStore.getState().openPartialPaymentDrawer({ transactionId, onRecorded });
  };

  // Leaving a record's edit (saved or cancelled). Under the edit intent the
  // job was this edit: with one record it is done, with several the list
  // comes back for the next. Otherwise, back to the entry's view.
  const leaveEdit = () => {
    if (!editIntent) {
      returnToEntry();
    } else if (paymentRecords.length > 1) {
      useDrawerStore.getState().openPartialPaymentDrawer({ transactionId, onRecorded, intent: 'editPayment' });
    } else {
      onClose();
    }
  };

  const handleRecorded = (record: PaymentRecord) => {
    // Unconditional (MUT-81 eng review D3): ClientWorkSection and IncomePage
    // open this drawer with no onRecorded at all, so they have no other way
    // to learn a save happened. Home's own onRecorded (below) undoes this for
    // the one case it already has complete feedback for -- a full payment,
    // whose row is about to leave via captureRowExit (D10).
    if (transaction.profileId) {
      markSaved({
        kind: 'payment',
        ids: [record.id, transactionId],
        clientId: transaction.clientId,
        clientName: transaction.clientName,
        profileId: transaction.profileId,
      });
    }
    onRecorded?.(record);
    onClose();
  };

  const handleUpdated = () => {
    if (editingRecord && transaction.profileId) {
      markSaved({
        kind: 'payment',
        ids: [editingRecord.id, transactionId],
        clientId: transaction.clientId,
        clientName: transaction.clientName,
        profileId: transaction.profileId,
      });
    }
    leaveEdit();
  };

  const isPending = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

  const title = editingRecord || pickerMode
    ? t('transactions.partialPayment.editPayment')
    : settled
      ? t('transactions.partialPayment.title')
      : t('transactions.partialPayment.titleLeft', {
          amount: isolateAmount(formatAmount(remainingAmountMinor, transaction.currency, locale)),
        });

  const footer = (
    <div className="pay-drawer-actions">
      {settled || pickerMode ? (
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          {t('common.close')}
        </button>
      ) : (
        <>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={editingRecord ? leaveEdit : onClose}
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
      {pickerMode ? (
        <p className={paymentRecords.length === 0 ? 'card-empty' : 'form-hint'}>
          {paymentRecords.length === 0
            ? t('transactions.partialPayment.noPayments')
            : t('transactions.partialPayment.choosePayment')}
        </p>
      ) : settled ? (
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
          focusDate={editIntent}
          createMutation={createMutation}
          updateMutation={updateMutation}
          isPending={isPending}
          onRecorded={handleRecorded}
          onUpdated={handleUpdated}
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
                isEditing={editingRecord?.id === record.id}
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
        text: t('transactions.partialPayment.stillOwed', { amount: isolateAmount(formatAmount(state.leftMinor, currency, locale)) }),
      };
    case 'over':
      return {
        tone: 'error',
        text: t('transactions.partialPayment.overpayment', {
          amount: isolateAmount(formatAmount(Math.max(0, state.allowedMinor), currency, locale)),
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
  focusDate = false,
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
  /** Open on the date, not the amount: the drawer was opened to fix a payment's date (MUT-169) */
  focusDate?: boolean;
  createMutation: ReturnType<typeof useCreatePaymentRecord>;
  updateMutation: ReturnType<typeof useUpdatePaymentRecord>;
  isPending: boolean;
  onRecorded: (record: PaymentRecord) => void;
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
    minorToAmountInput(editingRecord ? editingRecord.amountMinor : allowedMinor, currency)
  );
  // todayISO() is the local calendar date (ADR-022). new Date().toISOString()
  // is the UTC one, which hands a user west of UTC tomorrow's date in the
  // evening and one east of UTC yesterday's after midnight -- silently wrong
  // on a field the user is now one confirm away from accepting.
  // An edited record opens on the day the lists show it: a Received fast-add
  // stores nowISO(), whose UTC day is yesterday after midnight in Israel (MUT-169).
  const [paidAt, setPaidAt] = useState(() => (editingRecord ? paymentLocalDay(editingRecord.paidAt) : todayISO()));
  const [notes, setNotes] = useState(() => editingRecord?.notes ?? '');
  const [dateOpen, setDateOpen] = useState(focusDate);
  const [notesOpen, setNotesOpen] = useState(() => !!editingRecord?.notes);
  // A field the user just opened takes focus; one open from the start doesn't
  const [focusTarget, setFocusTarget] = useState<'date' | 'notes' | null>(null);
  const [showAmountErrors, setShowAmountErrors] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Focused and selected, so typing replaces the prefill with a partial amount;
  // or the date, when that is what the drawer was opened to fix
  useEffect(() => {
    if (focusDate) {
      dateRef.current?.focus();
      return;
    }
    amountRef.current?.focus();
    amountRef.current?.select();
    // Mount only: focus is placed once, when the form opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (focusTarget === 'date') dateRef.current?.focus();
    if (focusTarget === 'notes') notesRef.current?.focus();
  }, [focusTarget]);

  const amountState = describePaymentAmount(amountText, currency, allowedMinor);
  // An edit that leaves the amount as it was never trips the amount checks: a
  // legacy entry recorded over its total (ADR-030) can still have its date fixed
  const amountUnchanged = !!editingRecord && amountText === minorToAmountInput(editingRecord.amountMinor, currency);
  const line = amountUnchanged && amountState.kind === 'over' ? null : amountLine(amountState, showAmountErrors, currency, locale, t);
  const today = todayISO();
  const dateLabel = paidAt === today ? t('time.today') : formatDate(`${paidAt}T00:00:00`, locale);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const amountMinor =
      amountState.kind === 'paidInFull' || amountState.kind === 'stillOwed' ? amountState.amountMinor : undefined;
    if (amountMinor === undefined && !amountUnchanged) {
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

    const trimmedNotes = notes.trim() || undefined;
    try {
      if (editingRecord) {
        // Only what changed: an untouched date keeps its stored instant (a
        // fast-add's UTC timestamp) instead of being rewritten as a day (MUT-169)
        const changes: { amountMinor?: number; paidAt?: string; notes?: string } = {};
        if (!amountUnchanged && amountMinor !== undefined) changes.amountMinor = amountMinor;
        if (paidAt !== paymentLocalDay(editingRecord.paidAt)) changes.paidAt = paidAt;
        if (trimmedNotes !== (editingRecord.notes || undefined)) changes.notes = trimmedNotes;
        if (Object.keys(changes).length > 0) {
          await updateMutation.mutateAsync({ id: editingRecord.id, transactionId, data: changes });
        }
        onUpdated();
      } else {
        const record = await createMutation.mutateAsync({ transactionId, amountMinor: amountMinor!, paidAt, notes: trimmedNotes });
        onRecorded(record);
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
          <span className="pay-drawer-record-date">{formatPaymentDate(record.paidAt, locale)}</span>
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
          aria-label={t('transactions.partialPayment.editPayment')}
        >
          &#9998;
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm pay-drawer-record-action pay-drawer-record-delete"
          onClick={onDelete}
          disabled={disabled}
          title={t('transactions.partialPayment.deletePayment')}
          aria-label={t('transactions.partialPayment.deletePayment')}
        >
          &#128465;
        </button>
      </div>
    </div>
  );
}
