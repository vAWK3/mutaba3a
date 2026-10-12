import { describe, it, expect } from 'vitest';
import { toIncomeRow, incomeColumns } from '../incomeRows';
import type { TransactionDisplay } from '../../../types';

const STAMP = '2026-10-01T00:00:00.000Z';

function entry(overrides: Partial<TransactionDisplay> = {}): TransactionDisplay {
  return {
    id: 'tx-1',
    kind: 'income',
    status: 'unpaid',
    occurredAt: '2026-10-01',
    amountMinor: 30000,
    currency: 'USD',
    clientId: 'c-1',
    clientName: 'Acme Studio',
    projectId: 'p-1',
    projectName: 'Rebrand',
    paymentStatus: 'unpaid',
    remainingAmountMinor: 30000,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

describe('toIncomeRow (MUT-62)', () => {
  it('carries what the row shows, with the entry itself for the row actions', () => {
    const tx = entry({ title: 'Logo redesign' });
    const row = toIncomeRow(tx);

    expect(row).toMatchObject({
      id: 'tx-1',
      date: '2026-10-01',
      title: 'Logo redesign',
      clientName: 'Acme Studio',
      projectName: 'Rebrand',
      amountMinor: 30000,
      currency: 'USD',
      status: 'unpaid',
      paymentStatus: 'unpaid',
    });
    expect(row.tx).toBe(tx);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['whitespace only', '   \t '],
  ])('has no title when the entry title is %s, so the cell shows a dash', (_label, title) => {
    expect(toIncomeRow(entry({ title })).title).toBeUndefined();
  });

  it('trims the spaces around a title', () => {
    expect(toIncomeRow(entry({ title: '  Site audit  ' })).title).toBe('Site audit');
  });

  it('keeps an Arabic title as written', () => {
    expect(toIncomeRow(entry({ title: 'هوية بصرية لمقهى' })).title).toBe('هوية بصرية لمقهى');
  });

  it('shows overdue days only when the entry is past due', () => {
    expect(toIncomeRow(entry({ daysOverdue: 13 })).overdueDays).toBe(13);
    expect(toIncomeRow(entry({ daysOverdue: 0 })).overdueDays).toBeUndefined();
    expect(toIncomeRow(entry({ daysOverdue: undefined })).overdueDays).toBeUndefined();
  });

  it('shows what was received only on a part-paid entry', () => {
    const partial = entry({ paymentStatus: 'partial', receivedAmountMinor: 10000 });
    const paid = entry({ status: 'paid', paymentStatus: 'paid', receivedAmountMinor: 30000 });

    expect(toIncomeRow(partial).partialReceivedMinor).toBe(10000);
    expect(toIncomeRow(paid).partialReceivedMinor).toBeUndefined();
    expect(toIncomeRow(entry({ paymentStatus: 'partial', receivedAmountMinor: 0 })).partialReceivedMinor).toBeUndefined();
  });

  it('offers Mark paid only on an unpaid entry that is not fully received', () => {
    expect(toIncomeRow(entry()).canMarkPaid).toBe(true);
    expect(toIncomeRow(entry({ status: 'paid', paymentStatus: 'paid' })).canMarkPaid).toBe(false);
    expect(toIncomeRow(entry({ status: 'unpaid', paymentStatus: 'paid' })).canMarkPaid).toBe(false);
  });
});

describe('incomeColumns (MUT-62)', () => {
  it('puts What right after the date, on a wide table', () => {
    expect(incomeColumns(false).map((c) => c.key)).toEqual([
      'date',
      'work',
      'client',
      'project',
      'status',
      'amount',
      'actions',
    ]);
  });

  it('drops only the project on a compact table; What stays', () => {
    expect(incomeColumns(true).map((c) => c.key)).toEqual(['date', 'work', 'client', 'status', 'amount', 'actions']);
  });

  it('labels What with the client profile Work list header', () => {
    expect(incomeColumns(false).find((c) => c.key === 'work')?.headerKey).toBe('clients.profile.work.what');
  });

  it('returns the same definitions on every call, so they are stable across renders', () => {
    expect(incomeColumns(false)).toBe(incomeColumns(false));
    expect(incomeColumns(true)).toBe(incomeColumns(true));
  });
});
