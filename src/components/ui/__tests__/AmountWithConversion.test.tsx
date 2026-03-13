import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { AmountWithConversion } from '../AmountWithConversion';
import * as useFxRateModule from '../../../hooks/useFxRate';
import * as i18nModule from '../../../lib/i18n';

// Mock hooks
vi.mock('../../../hooks/useFxRate', () => ({
  useFxRate: vi.fn(),
}));

vi.mock('../../../lib/i18n', () => ({
  useLanguage: vi.fn(),
  getLocale: vi.fn(),
  useT: vi.fn(),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

describe('AmountWithConversion', () => {
  const mockT = vi.fn((key: string) => key);

  beforeEach(() => {
    vi.clearAllMocks();

    (useFxRateModule.useFxRate as ReturnType<typeof vi.fn>).mockImplementation((base, quote) => {
      if (base === 'USD' && quote === 'ILS') {
        return { rate: 3.75, source: 'api', isLoading: false, isError: false };
      }
      if (base === 'EUR' && quote === 'ILS') {
        return { rate: 4.10, source: 'api', isLoading: false, isError: false };
      }
      return { rate: null, source: 'none', isLoading: false, isError: false };
    });

    (i18nModule.useLanguage as ReturnType<typeof vi.fn>).mockReturnValue({ language: 'en' });
    (i18nModule.getLocale as ReturnType<typeof vi.fn>).mockReturnValue('en-US');
    (i18nModule.useT as ReturnType<typeof vi.fn>).mockReturnValue(mockT);
  });

  it('should render USD amount', () => {
    render(
      <AmountWithConversion amountMinor={10000} currency="USD" />,
      { wrapper: createWrapper() }
    );

    expect(screen.getByText('$100')).toBeInTheDocument();
  });

  it('should render ILS amount', () => {
    render(
      <AmountWithConversion amountMinor={10000} currency="ILS" />,
      { wrapper: createWrapper() }
    );

    expect(screen.getByText('₪100')).toBeInTheDocument();
  });

  it('should render EUR amount', () => {
    render(
      <AmountWithConversion amountMinor={10000} currency="EUR" />,
      { wrapper: createWrapper() }
    );

    expect(screen.getByText('€100')).toBeInTheDocument();
  });

  it('should show conversion tooltip for USD', () => {
    render(
      <AmountWithConversion amountMinor={10000} currency="USD" />,
      { wrapper: createWrapper() }
    );

    const element = screen.getByText('$100');
    expect(element).toHaveAttribute('title');
    expect(element.getAttribute('title')).toContain('₪375');
    expect(element.getAttribute('title')).toContain('$1 = 3.75 ₪');
  });

  it('should show conversion tooltip for EUR', () => {
    render(
      <AmountWithConversion amountMinor={10000} currency="EUR" />,
      { wrapper: createWrapper() }
    );

    const element = screen.getByText('€100');
    expect(element).toHaveAttribute('title');
    expect(element.getAttribute('title')).toContain('₪410');
    expect(element.getAttribute('title')).toContain('€1 = 4.10 ₪');
  });

  it('should not show tooltip for ILS (no conversion needed)', () => {
    render(
      <AmountWithConversion amountMinor={10000} currency="ILS" />,
      { wrapper: createWrapper() }
    );

    const element = screen.getByText('₪100');
    expect(element).not.toHaveAttribute('title');
  });

  it('should show no rate message when rate is unavailable', () => {
    (useFxRateModule.useFxRate as ReturnType<typeof vi.fn>).mockReturnValue({
      rate: null,
      source: 'none',
      isLoading: false,
      isError: false,
    });

    render(
      <AmountWithConversion amountMinor={10000} currency="USD" />,
      { wrapper: createWrapper() }
    );

    const element = screen.getByText('$100');
    expect(element.getAttribute('title')).toBe('fx.none');
  });

  it('should apply income type styling', () => {
    render(
      <AmountWithConversion amountMinor={10000} currency="USD" type="income" />,
      { wrapper: createWrapper() }
    );

    const element = screen.getByText('$100');
    expect(element).toHaveClass('amount-positive');
  });

  it('should apply expense type styling', () => {
    render(
      <AmountWithConversion amountMinor={10000} currency="USD" type="expense" />,
      { wrapper: createWrapper() }
    );

    const element = screen.getByText('$100');
    expect(element).toHaveClass('amount-negative');
  });

  it('should show expense sign when showExpenseSign is true', () => {
    render(
      <AmountWithConversion
        amountMinor={10000}
        currency="USD"
        type="expense"
        showExpenseSign
      />,
      { wrapper: createWrapper() }
    );

    expect(screen.getByText(/-\$100/)).toBeInTheDocument();
  });

  it('should not show expense sign for non-expense types', () => {
    render(
      <AmountWithConversion
        amountMinor={10000}
        currency="USD"
        type="income"
        showExpenseSign
      />,
      { wrapper: createWrapper() }
    );

    expect(screen.getByText('$100')).toBeInTheDocument();
  });

  it('should apply custom className', () => {
    render(
      <AmountWithConversion
        amountMinor={10000}
        currency="USD"
        className="custom-class"
      />,
      { wrapper: createWrapper() }
    );

    const element = screen.getByText('$100');
    expect(element).toHaveClass('custom-class');
  });

  it('should have help cursor when tooltip is available', () => {
    render(
      <AmountWithConversion amountMinor={10000} currency="USD" />,
      { wrapper: createWrapper() }
    );

    const element = screen.getByText('$100');
    expect(element).toHaveStyle({ cursor: 'help' });
  });

  it('should not have help cursor for ILS amounts', () => {
    render(
      <AmountWithConversion amountMinor={10000} currency="ILS" />,
      { wrapper: createWrapper() }
    );

    const element = screen.getByText('₪100');
    expect(element).not.toHaveStyle({ cursor: 'help' });
  });

  it('should format large amounts correctly', () => {
    render(
      <AmountWithConversion amountMinor={10000000} currency="USD" />,
      { wrapper: createWrapper() }
    );

    expect(screen.getByText('$100,000')).toBeInTheDocument();
  });

  it('should format amounts with cents', () => {
    render(
      <AmountWithConversion amountMinor={10050} currency="USD" />,
      { wrapper: createWrapper() }
    );

    expect(screen.getByText('$100.5')).toBeInTheDocument();
  });

  it('should handle zero amount', () => {
    render(
      <AmountWithConversion amountMinor={0} currency="USD" />,
      { wrapper: createWrapper() }
    );

    expect(screen.getByText('$0')).toBeInTheDocument();
  });

  it('should default to neutral type', () => {
    render(
      <AmountWithConversion amountMinor={10000} currency="USD" />,
      { wrapper: createWrapper() }
    );

    const element = screen.getByText('$100');
    expect(element).not.toHaveClass('amount-positive');
    expect(element).not.toHaveClass('amount-negative');
  });
});
