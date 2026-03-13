import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KpiCard, KpiStrip } from '../home/KpiCard';

// Mock i18n
vi.mock('../../lib/i18n', () => ({
  useT: () => (key: string) => key,
  useLanguage: () => ({ language: 'en' }),
  getLocale: () => 'en-US',
}));

// Mock FX rate hook
vi.mock('../../hooks/useFxRate', () => ({
  useFxRate: () => ({ rate: 3.6, source: 'live' }),
}));

describe('KpiCard', () => {
  const defaultProps = {
    label: 'Test Label',
    usdAmountMinor: 100000, // $1,000.00
    ilsAmountMinor: 360000, // ₪3,600.00
  };

  it('renders label correctly', () => {
    render(<KpiCard {...defaultProps} />);
    expect(screen.getByText('Test Label')).toBeInTheDocument();
  });

  it('shows ILS amount by default (unified)', () => {
    render(<KpiCard {...defaultProps} />);
    // Should show unified ILS by default
    expect(screen.getByRole('tab', { name: /ILS/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('switches to USD view when USD tab clicked', () => {
    render(<KpiCard {...defaultProps} />);

    const usdTab = screen.getByRole('tab', { name: /USD/i });
    fireEvent.click(usdTab);

    expect(usdTab).toHaveAttribute('aria-selected', 'true');
  });

  it('applies positive styling for income type', () => {
    render(<KpiCard {...defaultProps} type="income" />);
    const valueElement = screen.getByTestId('kpi-value');
    expect(valueElement).toHaveClass('amount-positive');
  });

  it('applies negative styling for expense type', () => {
    render(<KpiCard {...defaultProps} type="expense" />);
    const valueElement = screen.getByTestId('kpi-value');
    expect(valueElement).toHaveClass('amount-negative');
  });

  it('applies dynamic styling for net type based on value', () => {
    // Positive net
    render(<KpiCard {...defaultProps} type="net" />);
    let valueElement = screen.getByTestId('kpi-value');
    expect(valueElement).toHaveClass('amount-positive');

    // Negative net
    render(<KpiCard label="Net" usdAmountMinor={-100000} ilsAmountMinor={-360000} type="net" />);
    valueElement = screen.getAllByTestId('kpi-value')[1];
    expect(valueElement).toHaveClass('amount-negative');
  });

  it('shows Both view with side-by-side amounts', () => {
    render(<KpiCard {...defaultProps} />);

    const bothTab = screen.getByRole('tab', { name: /Both/i });
    fireEvent.click(bothTab);

    // Should show both currencies
    expect(screen.getByText(/\$/)).toBeInTheDocument();
    expect(screen.getByText(/₪/)).toBeInTheDocument();
  });
});

describe('KpiStrip', () => {
  const defaultTotals = {
    USD: {
      paidIncomeMinor: 100000,
      unpaidIncomeMinor: 50000,
      expensesMinor: 30000,
    },
    ILS: {
      paidIncomeMinor: 360000,
      unpaidIncomeMinor: 180000,
      expensesMinor: 108000,
    },
    EUR: {
      paidIncomeMinor: 0,
      unpaidIncomeMinor: 0,
      expensesMinor: 0,
    },
  };

  it('renders all four KPI cards', () => {
    render(<KpiStrip totals={defaultTotals} />);

    // Check for all 4 KPI labels
    expect(screen.getByText('overview.kpi.paidIncome')).toBeInTheDocument();
    expect(screen.getByText('overview.kpi.unpaidReceivables')).toBeInTheDocument();
    expect(screen.getByText('overview.kpi.expenses')).toBeInTheDocument();
    expect(screen.getByText('overview.kpi.net')).toBeInTheDocument();
  });

  it('calculates net correctly', () => {
    render(<KpiStrip totals={defaultTotals} />);
    // Net = paidIncome - expenses
    // The net card should be present
    expect(screen.getByText('overview.kpi.net')).toBeInTheDocument();
  });

  it('shows loading state when loading prop is true', () => {
    render(<KpiStrip totals={null} loading />);
    expect(screen.getAllByText('common.loading')).toHaveLength(4);
  });
});
