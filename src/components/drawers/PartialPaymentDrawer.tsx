import { useState, useEffect, useRef, useMemo } from 'react';
import { Drawer } from './Drawer';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import {
  useTransactionDisplay,
  useMarkTransactionPaid,
  usePaymentRecords,
  useCreatePaymentRecord,
  useUpdatePaymentRecord,
  useDeletePaymentRecord,
} from '../../hooks/useQueries';
import { formatAmount, parseCurrencyInput, formatCurrencyInput, formatDate } from '../../lib/utils';
import type { Currency, PaymentRecord } from '../../types';
import { useDrawerStore } from '../../lib/stores';

interface PartialPaymentDrawerProps {
  transactionId: string;
  onClose: () => void;
}

export function PartialPaymentDrawer({ transactionId, onClose }: PartialPaymentDrawerProps) {
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);

  const { partialPaymentDrawer, editPaymentRecord } = useDrawerStore();
  const editingRecordId = partialPaymentDrawer.editingPaymentRecordId;

  const { data: transaction, isLoading: txLoading } = useTransactionDisplay(transactionId);
  const { data: paymentRecords = [], isLoading: recordsLoading } = usePaymentRecords(transactionId);
  const createMutation = useCreatePaymentRecord();
  const updateMutation = useUpdatePaymentRecord();
  const deleteMutation = useDeletePaymentRecord();
  const markPaidMutation = useMarkTransactionPaid();

  const [deletingRecordId, setDeletingRecordId] = useState<string | null>(null);

  const editingRecord = useMemo(
    () => editingRecordId ? paymentRecords.find((r) => r.id === editingRecordId) : undefined,
    [editingRecordId, paymentRecords]
  );

  if (txLoading || !transaction) {
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

  const handleMarkFullyPaid = async () => {
    try {
      await markPaidMutation.mutateAsync(transactionId);
      onClose();
    } catch {
      // Error handled in form
    }
  };

  const handleDeleteRecord = async (recordId: string) => {
    try {
      await deleteMutation.mutateAsync({ id: recordId, transactionId });
      setDeletingRecordId(null);
    } catch {
      // Error shown inline
    }
  };

  const handleCancelEdit = () => {
    useDrawerStore.getState().openPartialPaymentDrawer({ transactionId });
  };

  const isPending = createMutation.isPending || updateMutation.isPending || markPaidMutation.isPending || deleteMutation.isPending;

  return (
    <Drawer
      title={editingRecordId ? t('transactions.partialPayment.editPayment') : t('transactions.partialPayment.title')}
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
          {editingRecordId ? (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleCancelEdit}
                disabled={isPending}
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                form="partial-payment-form"
                className="btn btn-primary"
                disabled={isPending}
              >
                {isPending ? t('common.saving') : t('transactions.partialPayment.updatePayment')}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onClose}
                disabled={isPending}
              >
                {t('common.cancel')}
              </button>
              {remainingAmountMinor > 0 && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={handleMarkFullyPaid}
                  disabled={isPending}
                >
                  {t('transactions.partialPayment.markFullyPaid')}
                </button>
              )}
              <button
                type="submit"
                form="partial-payment-form"
                className="btn btn-primary"
                disabled={isPending}
              >
                {isPending ? t('common.saving') : t('transactions.partialPayment.record')}
              </button>
            </>
          )}
        </div>
      }
    >
      {/* Transaction summary */}
      <div className="form-section" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="summary-row">
          <span className="summary-label">{t('transactions.columns.amount')}</span>
          <span className="summary-value">
            {formatAmount(transaction.amountMinor, transaction.currency, locale)}
          </span>
        </div>
        <div className="summary-row">
          <span className="summary-label">{t('transactions.partialPayment.received')}</span>
          <span className="summary-value amount-positive">
            {formatAmount(receivedAmountMinor, transaction.currency, locale)}
          </span>
        </div>
        <div className="summary-row">
          <span className="summary-label">{t('transactions.partialPayment.remaining')}</span>
          <span className="summary-value amount-warning">
            {formatAmount(Math.max(0, remainingAmountMinor), transaction.currency, locale)}
          </span>
        </div>
      </div>

      {/* Payment History */}
      {!recordsLoading && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <h4 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-2)', color: 'var(--color-text-secondary)' }}>
            {t('transactions.partialPayment.history')}
          </h4>
          {paymentRecords.length === 0 ? (
            <div style={{ padding: 'var(--space-3)', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-sm)' }}>
              {t('transactions.partialPayment.noPayments')}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
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
          )}
        </div>
      )}

      {/* Payment form -- key forces remount with fresh state when switching modes */}
      <PaymentForm
        key={editingRecordId || 'create'}
        transactionId={transactionId}
        currency={transaction.currency}
        remainingAmountMinor={remainingAmountMinor}
        locale={locale}
        editingRecord={editingRecord}
        createMutation={createMutation}
        updateMutation={updateMutation}
        isPending={isPending}
        t={t}
      />
    </Drawer>
  );
}

// Extracted form component -- remounts via key when editingRecordId changes
function PaymentForm({
  transactionId,
  currency,
  remainingAmountMinor,
  locale,
  editingRecord,
  createMutation,
  updateMutation,
  isPending,
  t,
}: {
  transactionId: string;
  currency: Currency;
  remainingAmountMinor: number;
  locale: string;
  editingRecord?: PaymentRecord;
  createMutation: ReturnType<typeof useCreatePaymentRecord>;
  updateMutation: ReturnType<typeof useUpdatePaymentRecord>;
  isPending: boolean;
  t: (key: string) => string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [paymentInput, setPaymentInput] = useState(() =>
    editingRecord ? formatCurrencyInput(String(editingRecord.amountMinor / 100)) : ''
  );
  const [dateInput, setDateInput] = useState(() =>
    editingRecord ? editingRecord.paidAt.split('T')[0] : new Date().toISOString().split('T')[0]
  );
  const [notesInput, setNotesInput] = useState(() =>
    editingRecord?.notes || ''
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const paymentAmountMinor = parseCurrencyInput(paymentInput);

    if (paymentAmountMinor <= 0) {
      setError('Payment amount must be greater than 0');
      return;
    }

    try {
      if (editingRecord) {
        await updateMutation.mutateAsync({
          id: editingRecord.id,
          transactionId,
          data: {
            amountMinor: paymentAmountMinor,
            paidAt: dateInput,
            notes: notesInput || undefined,
          },
        });
        useDrawerStore.getState().openPartialPaymentDrawer({ transactionId });
      } else {
        await createMutation.mutateAsync({
          transactionId,
          amountMinor: paymentAmountMinor,
          paidAt: dateInput,
          notes: notesInput || undefined,
        });
        setPaymentInput('');
        setDateInput(new Date().toISOString().split('T')[0]);
        setNotesInput('');
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <form id="partial-payment-form" onSubmit={handleSubmit}>
      <h4 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-2)', color: 'var(--color-text-secondary)' }}>
        {editingRecord ? t('transactions.partialPayment.editPayment') : t('transactions.partialPayment.recordPayment')}
      </h4>

      <div className="form-group">
        <label className="form-label" htmlFor="payment-amount">
          {t('transactions.partialPayment.amount')}
        </label>
        <div className="input-with-prefix">
          <span className="input-prefix">{currency}</span>
          <input
            ref={inputRef}
            id="payment-amount"
            type="text"
            inputMode="decimal"
            className="input"
            value={paymentInput}
            onChange={(e) => setPaymentInput(formatCurrencyInput(e.target.value))}
            placeholder="0.00"
            disabled={isPending}
          />
        </div>
      </div>

      <div className="form-group" style={{ marginTop: 'var(--space-2)' }}>
        <label className="form-label" htmlFor="payment-date">
          {t('transactions.partialPayment.date')}
        </label>
        <input
          id="payment-date"
          type="date"
          className="input"
          value={dateInput}
          onChange={(e) => setDateInput(e.target.value)}
          disabled={isPending}
        />
      </div>

      <div className="form-group" style={{ marginTop: 'var(--space-2)' }}>
        <label className="form-label" htmlFor="payment-notes">
          {t('transactions.partialPayment.notes')}
        </label>
        <input
          id="payment-notes"
          type="text"
          className="input"
          value={notesInput}
          onChange={(e) => setNotesInput(e.target.value)}
          placeholder={t('transactions.partialPayment.notes')}
          disabled={isPending}
        />
      </div>

      {error && <div className="form-error" style={{ marginTop: 'var(--space-2)' }}>{error}</div>}

      {!editingRecord && remainingAmountMinor > 0 && (
        <div className="quick-amount-buttons" style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
          <QuickAmountButton
            label="25%"
            amount={Math.round(remainingAmountMinor * 0.25)}
            currency={currency}
            locale={locale}
            onClick={() => setPaymentInput(formatCurrencyInput(String(Math.round(remainingAmountMinor * 0.25) / 100)))}
          />
          <QuickAmountButton
            label="50%"
            amount={Math.round(remainingAmountMinor * 0.5)}
            currency={currency}
            locale={locale}
            onClick={() => setPaymentInput(formatCurrencyInput(String(Math.round(remainingAmountMinor * 0.5) / 100)))}
          />
          <QuickAmountButton
            label="100%"
            amount={remainingAmountMinor}
            currency={currency}
            locale={locale}
            onClick={() => setPaymentInput(formatCurrencyInput(String(remainingAmountMinor / 100)))}
          />
        </div>
      )}
    </form>
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
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 'var(--space-2)',
        borderRadius: 'var(--radius-sm)',
        backgroundColor: 'var(--color-danger-bg, #fef2f2)',
        fontSize: 'var(--text-sm)',
      }}>
        <span>{t('transactions.partialPayment.deleteConfirm')}</span>
        <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
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
            className="btn btn-sm"
            style={{ color: 'var(--color-danger, #ef4444)' }}
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
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 'var(--space-2)',
      borderRadius: 'var(--radius-sm)',
      backgroundColor: isEditing ? 'var(--color-primary-bg, #eff6ff)' : 'var(--color-bg-secondary, #f9fafb)',
      fontSize: 'var(--text-sm)',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span style={{ color: 'var(--color-text-secondary)' }}>
            {formatDate(record.paidAt, locale)}
          </span>
          <span style={{ fontWeight: 500 }}>
            {formatAmount(record.amountMinor, currency, locale)}
          </span>
        </div>
        {record.notes && (
          <span style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--text-xs, 0.75rem)' }}>
            {record.notes}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onEdit}
          disabled={disabled}
          title={t('transactions.partialPayment.editPayment')}
          style={{ padding: '2px 6px', fontSize: 'var(--text-xs, 0.75rem)' }}
        >
          &#9998;
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onDelete}
          disabled={disabled}
          title={t('transactions.partialPayment.deletePayment')}
          style={{ padding: '2px 6px', fontSize: 'var(--text-xs, 0.75rem)', color: 'var(--color-danger, #ef4444)' }}
        >
          &#128465;
        </button>
      </div>
    </div>
  );
}

interface QuickAmountButtonProps {
  label: string;
  amount: number;
  currency: Currency;
  locale: string;
  onClick: () => void;
}

function QuickAmountButton({ label, amount, currency, locale, onClick }: QuickAmountButtonProps) {
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={onClick}
      style={{ flex: 1 }}
    >
      {label} ({formatAmount(amount, currency, locale)})
    </button>
  );
}
