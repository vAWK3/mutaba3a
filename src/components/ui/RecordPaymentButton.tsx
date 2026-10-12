/**
 * RecordPaymentButton
 *
 * The primary row affordance for recording a payment against a receivable.
 * Recording a payment is the product's most frequent action; it used to be
 * buried in the row kebab at four call sites, each with its own idea of when it
 * should appear (MUT-6).
 *
 * This component owns that gate so the four surfaces cannot drift again. It is
 * props-in by design -- no store import -- matching the rest of components/ui;
 * callers pass onRecordPayment and open the drawer with the hook they already
 * hold.
 *
 * Usage:
 *   <RecordPaymentButton
 *     transaction={tx}
 *     onRecordPayment={() => openPartialPaymentDrawer({ transactionId: tx.id })}
 *   />
 *
 * `compact` shows the label alone where the amount already sits beside the
 * button (Home's Needs attention, MUT-82); the accessible name keeps it.
 */

import { Button } from './Button';
import './RecordPaymentButton.css';
import { formatAmount } from '../../lib/utils';
import { useT, useLanguage, getLocale } from '../../lib/i18n';
import type { TransactionDisplay } from '../../types';

export interface RecordPaymentButtonProps {
  /** The row's transaction; must carry paymentStatus and remainingAmountMinor. */
  transaction: TransactionDisplay;
  /** Open the payment drawer for this transaction. */
  onRecordPayment: () => void;
  /** Show the label without the amount; the accessible name still has it. */
  compact?: boolean;
  className?: string;
}

export function RecordPaymentButton({
  transaction,
  onRecordPayment,
  compact = false,
  className,
}: RecordPaymentButtonProps) {
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocale(language);

  const remainingAmountMinor = transaction.remainingAmountMinor ?? 0;

  // There is nothing to record against an expense, a settled receivable, or a
  // row whose balance is already covered. A locked (invoiced) transaction is
  // deliberately not excluded -- paying an invoice is the normal flow (ADR-030).
  if (
    transaction.kind !== 'income' ||
    transaction.paymentStatus === 'paid' ||
    remainingAmountMinor <= 0
  ) {
    return null;
  }

  const remainingLabel = formatAmount(remainingAmountMinor, transaction.currency, locale);

  return (
    <Button
      variant="secondary"
      size="sm"
      className={className}
      // Rows are clickable on several of these surfaces; the payment action is
      // not a row click.
      onClick={(e) => {
        e.stopPropagation();
        onRecordPayment();
      }}
      aria-label={`${t('transactions.partialPayment.recordPayment')} — ${t('transactions.partialPayment.remaining')}: ${remainingLabel}`}
    >
      {t('transactions.partialPayment.recordPayment')}
      {!compact && <span className="record-payment-remaining">{remainingLabel}</span>}
    </Button>
  );
}
