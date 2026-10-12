import { useToast } from '../lib/toastStore';
import { useT } from '../lib/i18n';
import { useDeletePaymentRecord } from './useQueries';
import type { PaymentRecord } from '../types';

/** One Undo at a time: a newer payment's Undo replaces the one showing. */
export const PAYMENT_UNDO_GROUP = 'payment-undo';

/**
 * Undo for a payment just recorded (MUT-82, brief H1).
 *
 * `offerUndo` shows a toast saying what was recorded, with Undo. Undo deletes
 * that payment record through the repository, which recalculates the entry
 * from the records left (ADR-038, ADR-039), so its status, remaining amount
 * and paidAt return to what they were, and every list refreshes through the
 * usual invalidation. The toast lives in the app-wide container and needs
 * only the record, so it keeps working after the screen that offered it has
 * gone. `onUndone` runs once the record is deleted.
 */
export function usePaymentUndo() {
  const t = useT();
  const { showToast } = useToast();
  const deleteRecord = useDeletePaymentRecord();

  const offerUndo = (record: PaymentRecord, message: string, onUndone?: () => void) => {
    const undo = async () => {
      try {
        await deleteRecord.mutateAsync({ id: record.id, transactionId: record.transactionId });
        onUndone?.();
      } catch {
        showToast(t('overview.undoFailed'), { type: 'error' });
      }
    };

    showToast(message, {
      group: PAYMENT_UNDO_GROUP,
      action: { label: t('common.undo'), onClick: () => void undo() },
    });
  };

  return { offerUndo };
}
