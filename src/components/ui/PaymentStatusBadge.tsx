import { cn } from '../../lib/utils';
import { useT } from '../../lib/i18n';
import type { PaymentStatus } from '../../types';

interface PaymentStatusBadgeProps {
  paymentStatus: PaymentStatus;
  amountMinor: number;
  receivedAmountMinor?: number;
  className?: string;
}

/**
 * Displays the payment status of an income transaction.
 * Shows: Paid, Partial (X%), or Unpaid
 */
export function PaymentStatusBadge({
  paymentStatus,
  amountMinor,
  receivedAmountMinor = 0,
  className,
}: PaymentStatusBadgeProps) {
  const t = useT();

  const getLabel = () => {
    switch (paymentStatus) {
      case 'paid':
        return t('transactions.status.paid');
      case 'partial': {
        const percent = Math.round((receivedAmountMinor / amountMinor) * 100);
        return t('transactions.status.partial', { percent });
      }
      case 'unpaid':
        return t('transactions.status.unpaid');
    }
  };

  return (
    <span
      className={cn(
        'status-badge',
        paymentStatus === 'paid' && 'paid',
        paymentStatus === 'partial' && 'partial',
        paymentStatus === 'unpaid' && 'unpaid',
        className
      )}
    >
      {getLabel()}
    </span>
  );
}
