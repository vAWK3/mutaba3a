import { todayLocalISO, daysOverdue, daysUntilDue } from '../../lib/dates';
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

  // Classified with the shared predicate so this badge can never disagree with
  // the Overdue filter or the counts on other screens.
  const today = todayLocalISO();
  const row = { kind, status, dueDate };

  // daysOverdue is undefined exactly when the row is not overdue, so it doubles
  // as the check and narrows the type in one call.
  const overdueDays = daysOverdue(row, today);
  if (overdueDays !== undefined) {
    return (
      <span className="status-badge overdue">
        {t('transactions.status.overdue', { days: overdueDays })}
      </span>
    );
  }

  const dueInDays = dueDate ? daysUntilDue(dueDate, today) : null;

  return (
    <span className="status-badge unpaid">
      {dueInDays === 0
        ? t('transactions.status.dueToday')
        : t('transactions.status.dueIn', { days: dueInDays ?? 0 })}
    </span>
  );
}

