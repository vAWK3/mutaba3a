import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PaymentStatusBadge } from '../PaymentStatusBadge';

// Mock the i18n hook
vi.mock('../../../lib/i18n', () => ({
  useT: () => (key: string, params?: Record<string, unknown>) => {
    const translations: Record<string, string> = {
      'transactions.status.paid': 'Paid',
      'transactions.status.unpaid': 'Unpaid',
    };
    if (key === 'transactions.status.partial') {
      return `Partial (${params?.percent}%)`;
    }
    return translations[key] || key;
  },
}));

describe('PaymentStatusBadge', () => {
  it('should display Paid status', () => {
    render(
      <PaymentStatusBadge
        paymentStatus="paid"
        amountMinor={10000}
        receivedAmountMinor={10000}
      />
    );

    expect(screen.getByText('Paid')).toBeInTheDocument();
    expect(screen.getByText('Paid')).toHaveClass('paid');
  });

  it('should display Unpaid status', () => {
    render(
      <PaymentStatusBadge
        paymentStatus="unpaid"
        amountMinor={10000}
        receivedAmountMinor={0}
      />
    );

    expect(screen.getByText('Unpaid')).toBeInTheDocument();
    expect(screen.getByText('Unpaid')).toHaveClass('unpaid');
  });

  it('should display Partial status with percentage', () => {
    render(
      <PaymentStatusBadge
        paymentStatus="partial"
        amountMinor={10000}
        receivedAmountMinor={3000}
      />
    );

    expect(screen.getByText('Partial (30%)')).toBeInTheDocument();
    expect(screen.getByText('Partial (30%)')).toHaveClass('partial');
  });

  it('should calculate correct percentage for partial payments', () => {
    render(
      <PaymentStatusBadge
        paymentStatus="partial"
        amountMinor={10000}
        receivedAmountMinor={7500}
      />
    );

    expect(screen.getByText('Partial (75%)')).toBeInTheDocument();
  });

  it('should apply custom className', () => {
    render(
      <PaymentStatusBadge
        paymentStatus="paid"
        amountMinor={10000}
        className="custom-class"
      />
    );

    expect(screen.getByText('Paid')).toHaveClass('custom-class');
  });

  it('should default receivedAmountMinor to 0 for unpaid', () => {
    render(
      <PaymentStatusBadge
        paymentStatus="unpaid"
        amountMinor={10000}
      />
    );

    expect(screen.getByText('Unpaid')).toBeInTheDocument();
  });
});
