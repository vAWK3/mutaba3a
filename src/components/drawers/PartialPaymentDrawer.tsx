import { useState, useEffect, useRef } from 'react';
import { Drawer } from './Drawer';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import { useTransactionDisplay, useRecordPartialPayment, useMarkTransactionPaid } from '../../hooks/useQueries';
import { formatAmount, parseCurrencyInput, formatCurrencyInput } from '../../lib/utils';
import type { Currency } from '../../types';

interface PartialPaymentDrawerProps {
  transactionId: string;
  onClose: () => void;
}

export function PartialPaymentDrawer({ transactionId, onClose }: PartialPaymentDrawerProps) {
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: transaction, isLoading } = useTransactionDisplay(transactionId);
  const recordPartialPaymentMutation = useRecordPartialPayment();
  const markPaidMutation = useMarkTransactionPaid();

  const [paymentInput, setPaymentInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Focus input on mount
  useEffect(() => {
    if (inputRef.current && !isLoading) {
      inputRef.current.focus();
    }
  }, [isLoading]);

  if (isLoading || !transaction) {
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const paymentAmountMinor = parseCurrencyInput(paymentInput);

    if (paymentAmountMinor <= 0) {
      setError('Payment amount must be greater than 0');
      return;
    }

    try {
      await recordPartialPaymentMutation.mutateAsync({
        id: transactionId,
        paymentAmountMinor,
      });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleMarkFullyPaid = async () => {
    setError(null);
    try {
      await markPaidMutation.mutateAsync(transactionId);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const isPending = recordPartialPaymentMutation.isPending || markPaidMutation.isPending;

  return (
    <Drawer
      title={t('transactions.partialPayment.title')}
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={isPending}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handleMarkFullyPaid}
            disabled={isPending}
          >
            {t('transactions.partialPayment.markFullyPaid')}
          </button>
          <button
            type="submit"
            form="partial-payment-form"
            className="btn btn-primary"
            disabled={isPending || !paymentInput}
          >
            {isPending ? t('common.saving') : t('transactions.partialPayment.record')}
          </button>
        </div>
      }
    >
      <form id="partial-payment-form" onSubmit={handleSubmit}>
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
              {formatAmount(remainingAmountMinor, transaction.currency, locale)}
            </span>
          </div>
        </div>

        {/* Payment amount input */}
        <div className="form-group">
          <label className="form-label" htmlFor="payment-amount">
            {t('transactions.partialPayment.amount')}
          </label>
          <div className="input-with-prefix">
            <span className="input-prefix">{transaction.currency}</span>
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
          {error && <div className="form-error">{error}</div>}
        </div>

        {/* Quick amount buttons */}
        <div className="quick-amount-buttons" style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
          <QuickAmountButton
            label="25%"
            amount={Math.round(remainingAmountMinor * 0.25)}
            currency={transaction.currency}
            locale={locale}
            onClick={() => setPaymentInput(formatCurrencyInput(String(Math.round(remainingAmountMinor * 0.25) / 100)))}
          />
          <QuickAmountButton
            label="50%"
            amount={Math.round(remainingAmountMinor * 0.5)}
            currency={transaction.currency}
            locale={locale}
            onClick={() => setPaymentInput(formatCurrencyInput(String(Math.round(remainingAmountMinor * 0.5) / 100)))}
          />
          <QuickAmountButton
            label="100%"
            amount={remainingAmountMinor}
            currency={transaction.currency}
            locale={locale}
            onClick={() => setPaymentInput(formatCurrencyInput(String(remainingAmountMinor / 100)))}
          />
        </div>
      </form>
    </Drawer>
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
