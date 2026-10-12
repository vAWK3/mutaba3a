/**
 * Needs attention (ADR-036 §1): every receivable that is overdue or due within
 * the next 7 days, oldest due date first.
 *
 * One definition for the repository (`getAttentionReceivables`) and for Home,
 * which selects the list from the receivables Owed now already reads, so a
 * payment changes both in the same render (MUT-82, ADR-055). Bucketing goes
 * through the shared ADR-010/022 helpers.
 */

import { isDueSoon, isOverdueReceivable, type ReceivableLike } from './dates';

type AttentionCandidate = ReceivableLike & { id: string; clientName?: string };

export function selectAttentionReceivables<T extends AttentionCandidate>(transactions: readonly T[], today: string): T[] {
  return transactions
    .filter((tx) => isOverdueReceivable(tx, today) || isDueSoon(tx, today))
    .sort(
      (a, b) =>
        // Equal dates by client name, then id, so the list never reshuffles
        // between renders
        (a.dueDate || '').localeCompare(b.dueDate || '') ||
        (a.clientName ?? '').localeCompare(b.clientName ?? '') ||
        a.id.localeCompare(b.id)
    );
}
