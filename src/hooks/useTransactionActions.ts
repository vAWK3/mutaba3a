import { useDrawerStore } from '../lib/stores';
import { useMarkTransactionPaid } from './useQueries';

/**
 * Consolidates transaction row action handlers.
 * Used by pages that display transaction tables.
 */
export function useTransactionActions() {
  const { openTransactionDrawer } = useDrawerStore();
  const markPaidMutation = useMarkTransactionPaid();

  const handleRowClick = (transactionId: string) => {
    openTransactionDrawer({ mode: 'edit', transactionId });
  };

  const handleMarkPaid = async (e: React.MouseEvent, transactionId: string) => {
    e.stopPropagation();
    await markPaidMutation.mutateAsync(transactionId);
  };

  const handleCreate = (prefill?: { clientId?: string; projectId?: string }) => {
    openTransactionDrawer({ mode: 'create', ...prefill });
  };

  return {
    handleRowClick,
    handleMarkPaid,
    handleCreate,
    markPaidMutation,
  };
}
