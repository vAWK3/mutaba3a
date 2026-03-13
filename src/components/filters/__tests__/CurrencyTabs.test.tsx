/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CurrencyTabs } from '../CurrencyTabs';

// Mock i18n
vi.mock('../../../lib/i18n', () => ({
  useT: () => (key: string) => {
    const translations: Record<string, string> = {
      'currency.USD': 'USD',
      'currency.ILS': 'ILS',
      'currency.all': 'All',
    };
    return translations[key] || key;
  },
}));

describe('CurrencyTabs', () => {
  it('renders USD and ILS tabs by default', () => {
    render(
      <CurrencyTabs
        value="ILS"
        onChange={() => {}}
      />
    );

    expect(screen.getByRole('tab', { name: 'USD' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'ILS' })).toBeInTheDocument();
  });

  it('marks selected currency as active', () => {
    render(
      <CurrencyTabs
        value="USD"
        onChange={() => {}}
      />
    );

    const usdTab = screen.getByRole('tab', { name: 'USD' });
    expect(usdTab).toHaveAttribute('aria-selected', 'true');
    expect(usdTab).toHaveClass('currency-tab-active');
  });

  it('calls onChange with new currency when tab clicked', () => {
    const handleChange = vi.fn();
    render(
      <CurrencyTabs
        value="ILS"
        onChange={handleChange}
      />
    );

    fireEvent.click(screen.getByRole('tab', { name: 'USD' }));

    expect(handleChange).toHaveBeenCalledWith('USD');
  });

  it('renders "All" tab when showAll is true', () => {
    render(
      <CurrencyTabs
        value="ILS"
        onChange={() => {}}
        showAll
      />
    );

    expect(screen.getByRole('tab', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'USD' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'ILS' })).toBeInTheDocument();
  });

  it('selects "All" when value is undefined', () => {
    render(
      <CurrencyTabs
        value={undefined}
        onChange={() => {}}
        showAll
      />
    );

    const allTab = screen.getByRole('tab', { name: 'All' });
    expect(allTab).toHaveAttribute('aria-selected', 'true');
  });

  it('applies custom className', () => {
    render(
      <CurrencyTabs
        value="ILS"
        onChange={() => {}}
        className="custom-class"
      />
    );

    expect(screen.getByRole('tablist')).toHaveClass('custom-class');
  });

  it('renders with tablist role', () => {
    render(
      <CurrencyTabs
        value="ILS"
        onChange={() => {}}
      />
    );

    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });
});
