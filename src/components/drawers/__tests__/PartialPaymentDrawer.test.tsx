/**
 * @vitest-environment jsdom
 *
 * MUT-86 (decision P1): the Record payment drawer leads with what's left. Its
 * title names the balance, one large amount field is prefilled with it, a live
 * line under it says what the amount leaves owed, the date reads "Today ›",
 * notes sit behind "+ Add note", and one primary button records -- so opening
 * the drawer and pressing Record Payment settles the entry ("Paid? Two taps.").
 *
 * Kept from MUT-6 / MUT-18: the prefill is overwritable, a backdated date is
 * what gets stored, overpayment and future dates are refused inline (ADR-030,
 * ADR-038), and the date defaults to the local calendar today (ADR-022).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PartialPaymentDrawer } from '../PartialPaymentDrawer';
import { todayISO } from '../../../lib/utils';
import type { PaymentRecord, TransactionDisplay } from '../../../types';

const mockCreate = vi.fn().mockResolvedValue(undefined);
const mockUpdate = vi.fn().mockResolvedValue(undefined);
const mockDelete = vi.fn().mockResolvedValue(undefined);
const mockOpenPartialPaymentDrawer = vi.fn();
const mockEditPaymentRecord = vi.fn();

let mockTransaction: TransactionDisplay;
let mockPaymentRecords: unknown[] = [];
let mockRecordsLoading = false;
let mockEditingPaymentRecordId: string | undefined;

const TRANSLATIONS: Record<string, string> = {
  'transactions.partialPayment.title': 'Record Payment',
  'transactions.partialPayment.titleLeft': 'Record Payment · {amount} left',
  'transactions.partialPayment.recordPayment': 'Record Payment',
  'transactions.partialPayment.record': 'Record Payment',
  'transactions.partialPayment.amount': 'Payment amount',
  'transactions.partialPayment.date': 'Payment date',
  'transactions.partialPayment.notes': 'Notes',
  'transactions.partialPayment.addNote': 'Add note',
  'transactions.partialPayment.paidInFull': 'Paid in full',
  'transactions.partialPayment.stillOwed': '{amount} still owed',
  'transactions.partialPayment.remaining': 'Remaining',
  'transactions.partialPayment.received': 'Received so far',
  'transactions.partialPayment.history': 'Payment History',
  'transactions.partialPayment.noPayments': 'No payments recorded yet',
  'transactions.partialPayment.editPayment': 'Edit Payment',
  'transactions.partialPayment.updatePayment': 'Update Payment',
  'transactions.partialPayment.deletePayment': 'Delete Payment',
  'transactions.partialPayment.amountMustBePositive': 'Payment amount must be greater than 0',
  'transactions.partialPayment.overpayment': 'Payment amount exceeds the remaining balance of {amount}',
  'transactions.partialPayment.futureDate': 'Payment date cannot be in the future',
  'validation.amountInvalid': 'Enter an amount like 1200 or 1,200.50',
  'validation.amountCurrencyMismatch': 'The amount is in {typed}, but this entry is in {currency}',
  'validation.dateRequired': 'Date is required',
  'time.today': 'Today',
  'transactions.columns.amount': 'Amount',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.saving': 'Saving...',
};

vi.mock('../../../lib/i18n', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) => {
    const template = TRANSLATIONS[key] ?? key;
    return Object.entries(params ?? {}).reduce(
      (text, [name, value]) => text.replace(`{${name}}`, String(value)),
      template,
    );
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
  usePaymentRecords: () => ({ data: mockRecordsLoading ? undefined : mockPaymentRecords, isLoading: mockRecordsLoading }),
  useCreatePaymentRecord: () => ({ mutateAsync: mockCreate, isPending: false }),
  useUpdatePaymentRecord: () => ({ mutateAsync: mockUpdate, isPending: false }),
  useDeletePaymentRecord: () => ({ mutateAsync: mockDelete, isPending: false }),
}));

/** Text as read, without the bidi isolates that keep amounts whole in Arabic */
function plain(text: string | null | undefined): string {
  return (text ?? '').replace(/[\u2068\u2069]/g, '');
}

function amountInput() {
  return screen.getByLabelText('Payment amount') as HTMLInputElement;
}

function amountStatus() {
  return plain(screen.getByTestId('payment-amount-status').textContent);
}

function title() {
  return plain(screen.getByRole('heading', { level: 2 }).textContent);
}

function recordButton() {
  return screen.getByRole('button', { name: 'Record Payment' });
}

async function openDateField(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Payment date/ }));
  return screen.getByLabelText('Payment date') as HTMLInputElement;
}

function renderDrawer(onClose = vi.fn(), onRecorded?: (record: PaymentRecord) => void) {
  const result = render(<PartialPaymentDrawer transactionId="tx-1" onClose={onClose} onRecorded={onRecorded} />);
  return { ...result, onClose };
}

describe('PartialPaymentDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPaymentRecords = [];
    mockRecordsLoading = false;
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

  describe('leads with what is left', () => {
    it('names the remaining balance in the title', () => {
      renderDrawer();

      expect(title()).toBe('Record Payment · $750 left');
    });

    it('prefills the amount with the full remaining balance and says it pays in full', () => {
      renderDrawer();

      expect(amountInput().value).toBe('750');
      expect(amountStatus()).toBe('Paid in full');
    });

    // The field always writes cents as two digits. The title uses the app's
    // shared formatAmount, which drops a trailing zero ("$887.5", TD-062).
    it('writes a balance with cents to two decimals in the field', () => {
      mockTransaction = { ...mockTransaction, receivedAmountMinor: 11250, remainingAmountMinor: 88750 };
      renderDrawer();

      expect(title()).toBe('Record Payment · $887.5 left');
      expect(amountInput().value).toBe('887.50');
      expect(amountStatus()).toBe('Paid in full');
    });

    it('focuses the amount on open so typing replaces the prefill', () => {
      renderDrawer();

      expect(amountInput()).toHaveFocus();
      expect(amountInput().selectionStart).toBe(0);
      expect(amountInput().selectionEnd).toBe(3);
    });
  });

  describe('one primary action', () => {
    it('offers exactly Cancel and Record Payment', () => {
      const { container } = renderDrawer();

      const footer = container.querySelector('.drawer-footer') as HTMLElement;
      const names = within(footer).getAllByRole('button').map((button) => button.textContent);
      expect(names).toEqual(['Cancel', 'Record Payment']);
      expect(screen.queryByRole('button', { name: 'Mark Fully Paid' })).not.toBeInTheDocument();
    });

    it('has no quick-amount chips, no summary box and no empty history', () => {
      renderDrawer();

      expect(screen.queryByText(/25%|50%|100%/)).not.toBeInTheDocument();
      expect(screen.queryByText('Received so far')).not.toBeInTheDocument();
      expect(screen.queryByText('Remaining')).not.toBeInTheDocument();
      expect(screen.queryByText('Payment History')).not.toBeInTheDocument();
      expect(screen.queryByText('No payments recorded yet')).not.toBeInTheDocument();
    });
  });

  describe('two taps', () => {
    it('records the full remaining amount for today and closes', async () => {
      const user = userEvent.setup();
      const { onClose } = renderDrawer();

      await user.click(recordButton());

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockCreate).toHaveBeenCalledWith({
        transactionId: 'tx-1',
        amountMinor: 75000,
        paidAt: todayISO(),
        notes: undefined,
      });
    });

    // MUT-82 (D4): Home's Undo needs the record that was just created, and
    // hears about it before the drawer closes.
    it('reports the created record to whoever opened it, then closes', async () => {
      const record: PaymentRecord = {
        id: 'pr-new',
        transactionId: 'tx-1',
        amountMinor: 75000,
        paidAt: todayISO(),
        createdAt: '2026-03-02T00:00:00Z',
        updatedAt: '2026-03-02T00:00:00Z',
      };
      mockCreate.mockResolvedValueOnce(record);
      const onRecorded = vi.fn();
      const user = userEvent.setup();
      const { onClose } = renderDrawer(vi.fn(), onRecorded);

      await user.click(recordButton());

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(onRecorded).toHaveBeenCalledTimes(1);
      expect(onRecorded).toHaveBeenCalledWith(record);
      expect(onRecorded.mock.invocationCallOrder[0]).toBeLessThan(onClose.mock.invocationCallOrder[0]);
    });

    it('reports nothing when the repository refuses the payment', async () => {
      mockCreate.mockRejectedValueOnce(new Error('Payment amount exceeds the remaining balance of 750 USD'));
      const onRecorded = vi.fn();
      const user = userEvent.setup();
      const { onClose } = renderDrawer(vi.fn(), onRecorded);

      await user.click(recordButton());

      expect(await screen.findByRole('alert')).toHaveTextContent('exceeds the remaining balance');
      expect(onRecorded).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('the live line', () => {
    it('updates on every keystroke', async () => {
      const user = userEvent.setup();
      renderDrawer();

      await user.clear(amountInput());
      expect(amountStatus()).toBe('');

      await user.type(amountInput(), '1');
      expect(amountStatus()).toBe('$749 still owed');
      await user.type(amountInput(), '0');
      expect(amountStatus()).toBe('$740 still owed');
      await user.type(amountInput(), '0');
      expect(amountStatus()).toBe('$650 still owed');
    });

    it('reads Arabic-Indic digits', async () => {
      const user = userEvent.setup();
      renderDrawer();

      await user.clear(amountInput());
      await user.type(amountInput(), '١٠٠');

      expect(amountStatus()).toBe('$650 still owed');
    });

    it('stays quiet while a grouped amount is half typed', async () => {
      const user = userEvent.setup();
      renderDrawer();

      await user.clear(amountInput());
      await user.type(amountInput(), '1,2');

      expect(amountStatus()).toBe('');
    });

    it('warns about an overpayment as it is typed', async () => {
      const user = userEvent.setup();
      renderDrawer();

      await user.clear(amountInput());
      await user.type(amountInput(), '800');

      expect(amountStatus()).toBe('Payment amount exceeds the remaining balance of $750');
    });
  });

  describe('a partial payment', () => {
    it('records the smaller amount and closes', async () => {
      const user = userEvent.setup();
      const { onClose } = renderDrawer();

      await user.clear(amountInput());
      await user.type(amountInput(), '100');
      await user.click(recordButton());

      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 10000, paidAt: todayISO() }));
    });
  });

  describe('notes', () => {
    it('sit behind "+ Add note", which opens a focused field in its place', async () => {
      const user = userEvent.setup();
      renderDrawer();

      expect(screen.queryByLabelText('Notes')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Add note' }));

      expect(screen.getByLabelText('Notes')).toHaveFocus();
      expect(screen.queryByRole('button', { name: 'Add note' })).not.toBeInTheDocument();
    });

    it('are kept when the full amount is recorded', async () => {
      const user = userEvent.setup();
      renderDrawer();

      await user.click(screen.getByRole('button', { name: 'Add note' }));
      await user.type(screen.getByLabelText('Notes'), 'Bank transfer');
      await user.click(recordButton());

      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalledWith({
          transactionId: 'tx-1',
          amountMinor: 75000,
          paidAt: todayISO(),
          notes: 'Bank transfer',
        });
      });
    });
  });

  describe('refused inline, without calling the mutation', () => {
    it('an overpayment, shown once, with the drawer left open', async () => {
      const user = userEvent.setup();
      const { onClose } = renderDrawer();

      await user.clear(amountInput());
      await user.type(amountInput(), '800'); // $800 > $750 remaining
      await user.click(recordButton());

      expect(screen.getAllByText(/exceeds the remaining balance/i)).toHaveLength(1);
      expect(mockCreate).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it.each([
      ['1,2', 'Enter an amount like 1200 or 1,200.50'],
      ['0', 'Payment amount must be greater than 0'],
      ['€100', 'The amount is in EUR, but this entry is in USD'],
    ])('"%s"', async (typed, message) => {
      const user = userEvent.setup();
      renderDrawer();

      await user.clear(amountInput());
      await user.type(amountInput(), typed);
      await user.click(recordButton());

      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('clears an amount error once the amount changes', async () => {
      const user = userEvent.setup();
      renderDrawer();

      await user.clear(amountInput());
      await user.type(amountInput(), '0');
      await user.click(recordButton());
      expect(await screen.findByText('Payment amount must be greater than 0')).toBeInTheDocument();

      await user.type(amountInput(), '5');
      expect(screen.queryByText('Payment amount must be greater than 0')).not.toBeInTheDocument();
      expect(amountStatus()).toBe('$745 still owed');
    });
  });

  describe('the date', () => {
    it('reads "Today" and opens into a focused date field holding today', async () => {
      const user = userEvent.setup();
      renderDrawer();

      const row = screen.getByRole('button', { name: /Payment date/ });
      expect(within(row).getByText('Today')).toBeInTheDocument();

      const dateField = await openDateField(user);
      expect(dateField).toHaveFocus();
      expect(dateField.value).toBe(todayISO());
    });

    it('stores the backdated date the user chose, not today', async () => {
      const user = userEvent.setup();
      renderDrawer();

      const dateField = await openDateField(user);
      await user.clear(dateField);
      await user.type(dateField, '2026-01-15');
      await user.click(recordButton());

      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 75000, paidAt: '2026-01-15' }));
      });
    });

    it('refuses a future date (ADR-038)', async () => {
      const user = userEvent.setup();
      renderDrawer();

      const dateField = await openDateField(user);
      await user.clear(dateField);
      await user.type(dateField, '2099-01-01');
      await user.click(recordButton());

      expect(await screen.findByText('Payment date cannot be in the future')).toBeInTheDocument();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('refuses an emptied date', async () => {
      const user = userEvent.setup();
      renderDrawer();

      const dateField = await openDateField(user);
      await user.clear(dateField);
      await user.click(recordButton());

      expect(await screen.findByText('Date is required')).toBeInTheDocument();
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  /**
   * ADR-022: "today" is the user's local calendar date, never the UTC date,
   * and the helpers in lib/dates are the only way to compute it. The two
   * instants below straddle midnight in opposite directions, so whichever
   * timezone the suite runs in (Asia/Jerusalem by default, America/New_York
   * under `npm run test:tz`), at least one of them has a UTC date that differs
   * from the local one -- which is exactly when a user in the evening would
   * have been handed tomorrow's date, or the early morning yesterday's.
   */
  describe('the date defaults to the local calendar today (ADR-022)', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it.each([
      ['late evening west of UTC', '2026-03-16T02:30:00.000Z'],
      ['early morning east of UTC', '2026-03-15T23:30:00.000Z'],
    ])('%s', (_label, instant) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(instant));

      renderDrawer();
      fireEvent.click(screen.getByRole('button', { name: /Payment date/ }));

      expect((screen.getByLabelText('Payment date') as HTMLInputElement).value).toBe(todayISO());
    });
  });

  describe('edit mode', () => {
    beforeEach(() => {
      mockEditingPaymentRecordId = 'pr-1';
      mockPaymentRecords = [
        {
          id: 'pr-1',
          transactionId: 'tx-1',
          amountMinor: 25000,
          paidAt: '2026-02-10',
          notes: 'Wire',
          createdAt: '2026-02-10T00:00:00Z',
          updatedAt: '2026-02-10T00:00:00Z',
        },
      ];
    });

    it('prefills the record, not the remaining balance', () => {
      renderDrawer();

      expect(title()).toBe('Edit Payment');
      expect(amountInput().value).toBe('250');
      expect(within(screen.getByRole('button', { name: /Payment date/ })).getByText('Feb 10, 2026')).toBeInTheDocument();
      expect((screen.getByLabelText('Notes') as HTMLInputElement).value).toBe('Wire');
    });

    it("counts the record's own amount as payable", async () => {
      const user = userEvent.setup();
      renderDrawer();

      expect(amountStatus()).toBe('$750 still owed');
      await user.clear(amountInput());
      await user.type(amountInput(), '1000');
      expect(amountStatus()).toBe('Paid in full');
    });

    it('updates the record and returns to the entry', async () => {
      const user = userEvent.setup();
      renderDrawer();

      await user.clear(amountInput());
      await user.type(amountInput(), '300');
      await user.click(screen.getByRole('button', { name: 'Update Payment' }));

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalledWith({
          id: 'pr-1',
          transactionId: 'tx-1',
          data: { amountMinor: 30000, paidAt: '2026-02-10', notes: 'Wire' },
        });
      });
      expect(mockOpenPartialPaymentDrawer).toHaveBeenCalledWith({ transactionId: 'tx-1' });
      expect(mockCreate).not.toHaveBeenCalled();
    });

    // MUT-82 (D4): an update is not a new payment, so nothing to undo; the
    // opener's callback rides along to the entry's create view.
    it('reports no update, and hands the opener\'s callback back to the entry view', async () => {
      const onRecorded = vi.fn();
      const user = userEvent.setup();
      renderDrawer(vi.fn(), onRecorded);

      await user.click(screen.getByRole('button', { name: 'Update Payment' }));

      await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
      expect(onRecorded).not.toHaveBeenCalled();
      expect(mockOpenPartialPaymentDrawer).toHaveBeenCalledWith({ transactionId: 'tx-1', onRecorded });
    });

    it('waits for the records instead of falling back to a new payment', () => {
      mockRecordsLoading = true;
      renderDrawer();

      expect(screen.queryByLabelText('Payment amount')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Update Payment' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Record Payment' })).not.toBeInTheDocument();
    });
  });

  describe('history', () => {
    beforeEach(() => {
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
    });

    it('lists the recorded payments below the form', () => {
      renderDrawer();

      const heading = screen.getByText('Payment History');
      expect(amountInput().compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.getByText('$250')).toBeInTheDocument();
    });

    it("opens a payment's edit from its row", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await user.click(screen.getByTitle('Edit Payment'));

      expect(mockEditPaymentRecord).toHaveBeenCalledWith({ transactionId: 'tx-1', paymentRecordId: 'pr-1' });
    });
  });

  describe('a settled entry', () => {
    beforeEach(() => {
      mockTransaction = {
        ...mockTransaction,
        status: 'paid',
        receivedAmountMinor: 100000,
        paymentStatus: 'paid',
        remainingAmountMinor: 0,
      } as TransactionDisplay;
      mockPaymentRecords = [
        {
          id: 'pr-1',
          transactionId: 'tx-1',
          amountMinor: 100000,
          paidAt: '2026-02-10',
          createdAt: '2026-02-10T00:00:00Z',
          updatedAt: '2026-02-10T00:00:00Z',
        },
      ];
    });

    it('offers nothing to record, says it is paid in full and lists the history', async () => {
      const user = userEvent.setup();
      const { onClose, container } = renderDrawer();

      expect(title()).toBe('Record Payment');
      expect(screen.queryByLabelText('Payment amount')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Record Payment' })).not.toBeInTheDocument();
      expect(screen.getByText('Paid in full')).toBeInTheDocument();
      expect(screen.getByText('Payment History')).toBeInTheDocument();

      const footer = container.querySelector('.drawer-footer') as HTMLElement;
      await user.click(within(footer).getByRole('button', { name: 'Close' }));
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('surfaces a repository rejection inline and stays open', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Payment amount exceeds the remaining balance of 750 USD'));
    const user = userEvent.setup();
    const { onClose } = renderDrawer();

    await user.click(recordButton());

    expect(await screen.findByText('Payment amount exceeds the remaining balance of 750 USD')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
