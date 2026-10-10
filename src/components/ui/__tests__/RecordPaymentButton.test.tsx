import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecordPaymentButton } from '../RecordPaymentButton';
import type { TransactionDisplay } from '../../../types';

vi.mock('../../../lib/i18n', () => ({
  useT: () => (key: string) =>
    ({
      'transactions.partialPayment.recordPayment': 'Record Payment',
      'transactions.partialPayment.remaining': 'Remaining',
    })[key] ?? key,
  useLanguage: () => ({ language: 'en' }),
  getLocale: () => 'en-US',
}));

/**
 * The gate this component owns replaces three divergent inline conditions that
 * previously lived at four call sites, so the gate cases are the point of this
 * suite.
 */
function makeTransaction(overrides: Partial<TransactionDisplay> = {}): TransactionDisplay {
  return {
    id: 'tx-1',
    kind: 'income',
    status: 'unpaid',
    amountMinor: 10000,
    currency: 'USD',
    occurredAt: '2024-01-15',
    createdAt: '2024-01-15T00:00:00.000Z',
    updatedAt: '2024-01-15T00:00:00.000Z',
    paymentStatus: 'unpaid',
    remainingAmountMinor: 10000,
    ...overrides,
  } as TransactionDisplay;
}

describe('RecordPaymentButton', () => {
  describe('gate', () => {
    it('renders for an unpaid income transaction', () => {
      render(<RecordPaymentButton transaction={makeTransaction()} onRecordPayment={vi.fn()} />);

      expect(screen.getByRole('button', { name: /record payment/i })).toBeInTheDocument();
    });

    it('renders for a partially paid income transaction', () => {
      render(
        <RecordPaymentButton
          transaction={makeTransaction({
            paymentStatus: 'partial',
            receivedAmountMinor: 4000,
            remainingAmountMinor: 6000,
          })}
          onRecordPayment={vi.fn()}
        />
      );

      expect(screen.getByRole('button', { name: /record payment/i })).toBeInTheDocument();
    });

    it('renders nothing for a paid transaction', () => {
      const { container } = render(
        <RecordPaymentButton
          transaction={makeTransaction({
            status: 'paid',
            paymentStatus: 'paid',
            receivedAmountMinor: 10000,
            remainingAmountMinor: 0,
          })}
          onRecordPayment={vi.fn()}
        />
      );

      expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing for an expense', () => {
      const { container } = render(
        <RecordPaymentButton
          transaction={makeTransaction({ kind: 'expense' })}
          onRecordPayment={vi.fn()}
        />
      );

      expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing when nothing is left to pay', () => {
      const { container } = render(
        <RecordPaymentButton
          transaction={makeTransaction({ remainingAmountMinor: 0 })}
          onRecordPayment={vi.fn()}
        />
      );

      expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing when the remaining amount is unknown', () => {
      const { container } = render(
        <RecordPaymentButton
          transaction={makeTransaction({ remainingAmountMinor: undefined })}
          onRecordPayment={vi.fn()}
        />
      );

      expect(container).toBeEmptyDOMElement();
    });

    it('renders on a locked transaction -- lockedAt does not block payments', () => {
      render(
        <RecordPaymentButton
          transaction={makeTransaction({
            lockedAt: '2024-01-16T00:00:00.000Z',
            lockedByDocumentId: 'doc-1',
          })}
          onRecordPayment={vi.fn()}
        />
      );

      expect(screen.getByRole('button', { name: /record payment/i })).toBeInTheDocument();
    });
  });

  it('shows the remaining amount in the row currency', () => {
    render(
      <RecordPaymentButton
        transaction={makeTransaction({
          currency: 'ILS',
          paymentStatus: 'partial',
          remainingAmountMinor: 7050,
        })}
        onRecordPayment={vi.fn()}
      />
    );

    // Shared formatAmount(): currency symbol, no padded trailing zero.
    expect(screen.getByRole('button')).toHaveTextContent('₪70.5');
  });

  it('calls onRecordPayment once per click', async () => {
    const onRecordPayment = vi.fn();
    const user = userEvent.setup();

    render(<RecordPaymentButton transaction={makeTransaction()} onRecordPayment={onRecordPayment} />);
    await user.click(screen.getByRole('button', { name: /record payment/i }));

    expect(onRecordPayment).toHaveBeenCalledTimes(1);
  });

  it('does not let the click reach a row-level handler', async () => {
    const onRowClick = vi.fn();
    const user = userEvent.setup();

    render(
      <div onClick={onRowClick}>
        <RecordPaymentButton transaction={makeTransaction()} onRecordPayment={vi.fn()} />
      </div>
    );
    await user.click(screen.getByRole('button', { name: /record payment/i }));

    expect(onRowClick).not.toHaveBeenCalled();
  });
});
