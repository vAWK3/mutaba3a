import { describe, it, expect } from 'vitest';
import { selectAttentionReceivables } from '../attention';
import type { TransactionDisplay } from '../../types';

// MUT-82 (D5): Home selects Needs attention from the receivables Owed now
// already reads, so both change in one render. The rule is the one
// getAttentionReceivables applied (ADR-036 §1), now defined once.
const TODAY = '2026-10-12';

function entry(overrides: Partial<TransactionDisplay>): TransactionDisplay {
  return {
    id: 'tx',
    kind: 'income',
    status: 'unpaid',
    amountMinor: 10000,
    currency: 'USD',
    occurredAt: '2026-09-01',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

const ids = (rows: TransactionDisplay[]) => rows.map((row) => row.id);

describe('selectAttentionReceivables', () => {
  it('keeps receivables that are overdue or due within 7 days, today and day 7 included', () => {
    const rows = [
      entry({ id: 'overdue', dueDate: '2026-10-01' }),
      entry({ id: 'today', dueDate: '2026-10-12' }),
      entry({ id: 'day-7', dueDate: '2026-10-19' }),
      entry({ id: 'day-8', dueDate: '2026-10-20' }),
      entry({ id: 'undated' }),
    ];

    expect(ids(selectAttentionReceivables(rows, TODAY))).toEqual(['overdue', 'today', 'day-7']);
  });

  it('drops paid income and expenses, whatever their dates', () => {
    const rows = [
      entry({ id: 'paid', status: 'paid', dueDate: '2026-10-01' }),
      entry({ id: 'expense', kind: 'expense', dueDate: '2026-10-01' }),
      entry({ id: 'owed', dueDate: '2026-10-01' }),
    ];

    expect(ids(selectAttentionReceivables(rows, TODAY))).toEqual(['owed']);
  });

  it('orders by due date, then client name, then id, so the list never reshuffles', () => {
    const rows = [
      entry({ id: 'b', clientName: 'Beta', dueDate: '2026-10-10' }),
      entry({ id: 'later', clientName: 'Acme', dueDate: '2026-10-11' }),
      entry({ id: 'z', clientName: 'Acme', dueDate: '2026-10-10' }),
      entry({ id: 'a', clientName: 'Acme', dueDate: '2026-10-10' }),
      entry({ id: 'oldest', dueDate: '2026-10-02' }),
    ];

    expect(ids(selectAttentionReceivables(rows, TODAY))).toEqual(['oldest', 'a', 'z', 'b', 'later']);
  });

  it('returns a new array and leaves its input alone', () => {
    const rows = [entry({ id: 'late', dueDate: '2026-10-11' }), entry({ id: 'early', dueDate: '2026-10-01' })];
    const before = [...rows];

    const selected = selectAttentionReceivables(rows, TODAY);

    expect(selected).not.toBe(rows);
    expect(rows).toEqual(before);
  });
});
