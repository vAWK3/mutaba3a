import { getDaysUntil } from '../../lib/utils';
import { useT } from '../../lib/i18n';
import type { TxKind, TxStatus } from '../../types';

interface TransactionStatusCellProps {
  kind: TxKind;
  status: TxStatus;
  dueDate?: string;
}

/**
 * Displays the status of a transaction (Paid, Unpaid with days until due, or Overdue).
 * Only shows status for income transactions.
 */
export function TransactionStatusCell({ kind, status, dueDate }: TransactionStatusCellProps) {
  const t = useT();

  // Only income transactions show status
  if (kind !== 'income') {
    return null;
  }

  if (status === 'paid') {
    return <span className="status-badge paid">{t('transactions.status.paid')}</span>;
  }

  const daysUntilDue = dueDate ? getDaysUntil(dueDate) : null;
  const isOverdue = daysUntilDue !== null && daysUntilDue < 0;

  if (isOverdue) {
    return (
      <span className="status-badge overdue">
        {t('transactions.status.overdue', { days: Math.abs(daysUntilDue!) })}
      </span>
    );
  }

  return (
    <span className="status-badge unpaid">
      {daysUntilDue === 0
        ? t('transactions.status.dueToday')
        : t('transactions.status.dueIn', { days: daysUntilDue ?? 0 })}
    </span>
  );
}

