import { describe, it, expect } from 'vitest';
import { toWorkRow } from '../clientProfileRows';
import type { TransactionDisplay } from '../../../types';

const today = '2026-10-11';

const income = (overrides: Partial<TransactionDisplay> = {}): TransactionDisplay => ({
  id: 'tx-1',
  kind: 'income',
  status: 'unpaid',
  title: 'Homepage',
  amountMinor: 50000,
  currency: 'USD',
  occurredAt: '2026-10-01',
  paymentStatus: 'unpaid',
  remainingAmountMinor: 50000,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...overrides,
});

describe('toWorkRow', () => {
  it('copies what the row shows straight from the entry', () => {
    const tx = income({ projectId: 'p-1', projectName: 'Website', currency: 'ILS' });

    expect(toWorkRow(tx, today)).toMatchObject({
      id: 'tx-1',
      tx,
      date: '2026-10-01',
      title: 'Homepage',
      projectId: 'p-1',
      projectName: 'Website',
      amountMinor: 50000,
      currency: 'ILS',
      paymentStatus: 'unpaid',
      isReceivable: true,
    });
  });

  it('carries the remaining balance only when the entry is partially paid', () => {
    const partial = toWorkRow(
      income({ paymentStatus: 'partial', receivedAmountMinor: 20000, remainingAmountMinor: 30000 }),
      today
    );
    const unpaid = toWorkRow(income(), today);

    expect(partial.remainingMinor).toBe(30000);
    expect(unpaid.remainingMinor).toBeUndefined();
  });

  it('marks a receivable past its due date as overdue, with no due-in count', () => {
    const row = toWorkRow(income({ dueDate: '2026-10-08' }), today);

    expect(row.overdueDays).toBe(3);
    expect(row.dueInDays).toBeUndefined();
  });

  it('counts days until a future due date, and 0 for due today (not overdue)', () => {
    expect(toWorkRow(income({ dueDate: '2026-10-15' }), today)).toMatchObject({
      dueInDays: 4,
      overdueDays: undefined,
    });
    expect(toWorkRow(income({ dueDate: today }), today)).toMatchObject({
      dueInDays: 0,
      overdueDays: undefined,
    });
  });

  it('gives a paid entry no due or overdue information', () => {
    const row = toWorkRow(
      income({ status: 'paid', paymentStatus: 'paid', dueDate: '2026-09-01', remainingAmountMinor: 0 }),
      today
    );

    expect(row).toMatchObject({ isReceivable: false, overdueDays: undefined, dueInDays: undefined });
  });

  it('leaves a missing title undefined for the cell to label', () => {
    expect(toWorkRow(income({ title: undefined }), today).title).toBeUndefined();
  });

  it('derives the payment status when the entry does not carry one', () => {
    expect(toWorkRow(income({ paymentStatus: undefined }), today).paymentStatus).toBe('unpaid');
    expect(
      toWorkRow(income({ status: 'paid', paymentStatus: undefined }), today).paymentStatus
    ).toBe('paid');
  });
});
