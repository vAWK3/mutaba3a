import { cn } from '../../lib/utils';
import { useT } from '../../lib/i18n';
import type { TxKind, TxStatus } from '../../types';

interface TransactionTypeBadgeProps {
  kind: TxKind;
  status: TxStatus;
  className?: string;
}

/**
 * Displays a transaction type badge (Income, Expense, or Receivable).
 * Receivable is shown when kind='income' and status='unpaid'.
 */
export function TransactionTypeBadge({ kind, status, className }: TransactionTypeBadgeProps) {
  const t = useT();
  const isReceivable = kind === 'income' && status === 'unpaid';

  return (
    <span
      className={cn(
        'type-badge',
        kind === 'expense' && 'expense',
        kind === 'income' && status === 'paid' && 'income',
        isReceivable && 'receivable',
        className
      )}
    >
      {isReceivable
        ? t('transactions.type.receivable')
        : kind === 'income'
          ? t('transactions.type.income')
          : t('transactions.type.expense')}
    </span>
  );
}
