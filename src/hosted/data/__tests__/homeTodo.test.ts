import { describe, expect, it } from 'vitest';
import type { OrganizationSummary } from '../../api/client';
import { overdueClientCount, overdueClients } from '../homeTodo';

/** MUT-657 (E-4): clients overdue, computed in the portal from the org summary by Owed's own rule. */

const A = 'c1111111-1111-4111-8111-111111111111';
const B = 'c2222222-2222-4222-8222-222222222222';
const C = 'c3333333-3333-4333-8333-333333333333';
const D = 'c4444444-4444-4444-8444-444444444444';

function row(customerId: string, status: string, daysOverdue: number | null) {
  return { customerId, status, daysOverdue, outstanding: '1.00', overdue: '1.00', dueToday: '0.00', notYetDue: '0.00', unallocated: '0.00', oldestOverdueDueDate: null, lastPaymentOn: null, proposals: [] };
}

function summary(...blocks: { currency: string; rows: ReturnType<typeof row>[] }[]): OrganizationSummary {
  return {
    asOf: '2026-11-22',
    currencies: blocks.map(({ currency, rows }) => ({ currency, customers: rows, outstanding: '0.00', overdue: '0.00', dueToday: '0.00', notYetDue: '0.00', unallocated: '0.00', proposed: '0.00', counts: { customers: rows.length, overdueCustomers: 0, unallocatedPayments: 0, openProposals: 0 } })),
  } as unknown as OrganizationSummary;
}

describe('overdueClientCount', () => {
  it('counts a client overdue in two currencies once', () => {
    expect(overdueClientCount(summary({ currency: 'ILS', rows: [row(A, 'OVERDUE', 3)] }, { currency: 'USD', rows: [row(A, 'OVERDUE', 9), row(B, 'OVERDUE', 1)] }))).toBe(2);
  });

  it('ignores clients that are only owed, settled or up to date', () => {
    expect(overdueClientCount(summary({ currency: 'ILS', rows: [row(A, 'OUTSTANDING', null), row(B, 'SETTLED', null), row(C, 'UP_TO_DATE', null)] }))).toBe(0);
    expect(overdueClientCount(summary())).toBe(0);
  });
});

describe('overdueClients', () => {
  it('lists distinct clients, most days late first, at most the limit, each with its longest lateness', () => {
    const s = summary({ currency: 'ILS', rows: [row(A, 'OVERDUE', 3), row(B, 'OVERDUE', 12), row(C, 'DUE', 40)] }, { currency: 'USD', rows: [row(A, 'OVERDUE', 20), row(D, 'OVERDUE', 5)] });
    expect(overdueClients(s, 3)).toEqual([
      { customerId: A, daysOverdue: 20 },
      { customerId: B, daysOverdue: 12 },
      { customerId: D, daysOverdue: 5 },
    ]);
  });

  it('puts a lateness the server did not give last', () => {
    const s = summary({ currency: 'ILS', rows: [row(A, 'OVERDUE', null), row(B, 'OVERDUE', 2)] });
    expect(overdueClients(s, 3)).toEqual([
      { customerId: B, daysOverdue: 2 },
      { customerId: A, daysOverdue: null },
    ]);
  });
});
