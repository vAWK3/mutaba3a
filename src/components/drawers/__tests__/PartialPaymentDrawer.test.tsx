/**
 * @vitest-environment jsdom
 *
 * MUT-6 AC #3 and #4: the drawer opens with the amount prefilled to the full
 * remaining balance so settling in full is one confirm, the user can overwrite
 * it with a smaller amount, and a backdated date is what gets stored.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PartialPaymentDrawer } from '../PartialPaymentDrawer';
import type { TransactionDisplay } from '../../../types';

const mockCreate = vi.fn().mockResolvedValue(undefined);
const mockUpdate = vi.fn().mockResolvedValue(undefined);
const mockDelete = vi.fn().mockResolvedValue(undefined);
const mockMarkPaid = vi.fn().mockResolvedValue(undefined);
const mockOpenPartialPaymentDrawer = vi.fn();
const mockEditPaymentRecord = vi.fn();

let mockTransaction: TransactionDisplay;
let mockPaymentRecords: unknown[] = [];
let mockEditingPaymentRecordId: string | undefined;

vi.mock('../../../lib/i18n', () => ({
  useT: () => (key: string, params?: Record<string, unknown>) => {
    const translations: Record<string, string> = {
      'transactions.partialPayment.title': 'Record Payment',
      'transactions.partialPayment.recordPayment': 'Record Payment',
      'transactions.partialPayment.record': 'Record Payment',
      'transactions.partialPayment.amount': 'Payment amount',
      'transactions.partialPayment.date': 'Payment date',
      'transactions.partialPayment.notes': 'Notes',
      'transactions.partialPayment.remaining': 'Remaining',
      'transactions.partialPayment.received': 'Received so far',
      'transactions.partialPayment.history': 'Payment History',
      'transactions.partialPayment.noPayments': 'No payments recorded yet',
      'transactions.partialPayment.editPayment': 'Edit Payment',
      'transactions.partialPayment.updatePayment': 'Update Payment',
      'transactions.partialPayment.markFullyPaid': 'Mark Fully Paid',
      'transactions.partialPayment.amountMustBePositive':
        'Payment amount must be greater than 0',
      'transactions.partialPayment.overpayment': `Payment amount exceeds the remaining balance of ${params?.amount}`,
      'transactions.columns.amount': 'Amount',
      'common.cancel': 'Cancel',
      'common.saving': 'Saving...',
    };
    return translations[key] ?? key;
  },
  useLanguage: () => ({ language: 'en' }),
  getLocale: () => 'en-US',
}));

vi.mock('../../../lib/stores', () => ({
  useDrawerStore: Object.assign(
    () => ({
      partialPaymentDrawer: { editingPaymentRecordId: mockEditingPaymentRecordId },
      editPaymentRecord: mockEditPaymentRecord,
    }),
    {
      getState: () => ({ openPartialPaymentDrawer: mockOpenPartialPaymentDrawer }),
    }
  ),
}));

vi.mock('../../../hooks/useQueries', () => ({
  useTransactionDisplay: () => ({ data: mockTransaction, isLoading: false }),
  usePaymentRecords: () => ({ data: mockPaymentRecords, isLoading: false }),
  useCreatePaymentRecord: () => ({ mutateAsync: mockCreate, isPending: false }),
  useUpdatePaymentRecord: () => ({ mutateAsync: mockUpdate, isPending: false }),
  useDeletePaymentRecord: () => ({ mutateAsync: mockDelete, isPending: false }),
  useMarkTransactionPaid: () => ({ mutateAsync: mockMarkPaid, isPending: false }),
}));

function amountInput() {
  return screen.getByLabelText('Payment amount') as HTMLInputElement;
}

describe('PartialPaymentDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPaymentRecords = [];
    mockEditingPaymentRecordId = undefined;
    mockTransaction = {
      id: 'tx-1',
      kind: 'income',
      status: 'unpaid',
      amountMinor: 100000, // $1,000.00
      currency: 'USD',
      occurredAt: '2026-03-01',
      receivedAmountMinor: 25000, // $250.00 already received
      paymentStatus: 'partial',
      remainingAmountMinor: 75000,
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    } as TransactionDisplay;
  });

  it('prefills the amount with the full remaining balance', () => {
    render(<PartialPaymentDrawer transactionId="tx-1" onClose={vi.fn()} />);

    expect(amountInput().value).toBe('750');
  });

  it('records the prefilled amount in one confirm', async () => {
    const user = userEvent.setup();
    render(<PartialPaymentDrawer transactionId="tx-1" onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Record Payment' }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ transactionId: 'tx-1', amountMinor: 75000 })
      );
    });
  });

  it('lets the user overwrite the prefill with a smaller amount', async () => {
    const user = userEvent.setup();
    render(<PartialPaymentDrawer transactionId="tx-1" onClose={vi.fn()} />);

    await user.clear(amountInput());
    await user.type(amountInput(), '100');
    await user.click(screen.getByRole('button', { name: 'Record Payment' }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ amountMinor: 10000 })
      );
    });
  });

  it('stores the backdated date the user chose, not today', async () => {
    const user = userEvent.setup();
    render(<PartialPaymentDrawer transactionId="tx-1" onClose={vi.fn()} />);

    const dateField = screen.getByLabelText('Payment date') as HTMLInputElement;
    expect(dateField.value).toBe(new Date().toISOString().split('T')[0]);

    await user.clear(dateField);
    await user.type(dateField, '2026-01-15');
    await user.click(screen.getByRole('button', { name: 'Record Payment' }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ paidAt: '2026-01-15' })
      );
    });
  });

  it('rejects an overpayment inline without calling the mutation', async () => {
    const user = userEvent.setup();
    render(<PartialPaymentDrawer transactionId="tx-1" onClose={vi.fn()} />);

    await user.clear(amountInput());
    await user.type(amountInput(), '800'); // $800 > $750 remaining
    await user.click(screen.getByRole('button', { name: 'Record Payment' }));

    expect(await screen.findByText(/exceeds the remaining balance/i)).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('rejects a zero amount with a translated message', async () => {
    const user = userEvent.setup();
    render(<PartialPaymentDrawer transactionId="tx-1" onClose={vi.fn()} />);

    await user.clear(amountInput());
    await user.type(amountInput(), '0');
    await user.click(screen.getByRole('button', { name: 'Record Payment' }));

    expect(await screen.findByText('Payment amount must be greater than 0')).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('surfaces a repository rejection inline', async () => {
    mockCreate.mockRejectedValueOnce(
      new Error('Payment amount exceeds the remaining balance of 750 USD')
    );
    const user = userEvent.setup();
    render(<PartialPaymentDrawer transactionId="tx-1" onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Record Payment' }));

    expect(
      await screen.findByText('Payment amount exceeds the remaining balance of 750 USD')
    ).toBeInTheDocument();
  });

  it('leaves the amount empty when there is nothing left to pay', () => {
    mockTransaction = {
      ...mockTransaction,
      status: 'paid',
      receivedAmountMinor: 100000,
      paymentStatus: 'paid',
      remainingAmountMinor: 0,
    } as TransactionDisplay;

    render(<PartialPaymentDrawer transactionId="tx-1" onClose={vi.fn()} />);

    expect(amountInput().value).toBe('');
  });

  it('prefills the edited record amount, not the remaining balance, in edit mode', () => {
    mockEditingPaymentRecordId = 'pr-1';
    mockPaymentRecords = [
      {
        id: 'pr-1',
        transactionId: 'tx-1',
        amountMinor: 25000,
        paidAt: '2026-02-10',
        createdAt: '2026-02-10T00:00:00Z',
        updatedAt: '2026-02-10T00:00:00Z',
      },
    ];

    render(<PartialPaymentDrawer transactionId="tx-1" onClose={vi.fn()} />);

    expect(amountInput().value).toBe('250');
    expect((screen.getByLabelText('Payment date') as HTMLInputElement).value).toBe('2026-02-10');
  });
});
