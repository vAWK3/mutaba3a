/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { UseFxRateResult } from '../../../hooks/useFxRate';
import { FxRateReadout } from '../FxRateReadout';

vi.mock('../../../lib/i18n', () => ({
  useT: () => (key: string, vars?: Record<string, string | number>) =>
    vars ? `${key} ${Object.values(vars).join(' ')}` : key,
  useLanguage: () => ({ language: 'en' }),
  getLocale: () => 'en-US',
}));

const rates: Record<string, UseFxRateResult> = {};
vi.mock('../../../hooks/useFxRate', () => ({
  useFxRate: (base: string) => rates[base],
}));

function fxRate(overrides: Partial<UseFxRateResult> = {}): UseFxRateResult {
  return {
    rate: 3.0612,
    source: 'live',
    isLoading: false,
    isError: false,
    rateDate: '2026-10-12',
    lastUpdated: new Date().toISOString(),
    refetch: vi.fn(),
    ...overrides,
  };
}

const readout = () => screen.getByRole('button', { name: /^fx\.readoutLabel/ });

beforeEach(() => {
  rates.USD = fxRate();
  rates.EUR = fxRate({ rate: 3.5843, source: 'cached' });
});

describe('FxRateReadout (MUT-79)', () => {
  it('shows the dollar rate to two decimals, named as the exchange rate', () => {
    render(<FxRateReadout />);
    expect(readout()).toHaveTextContent('$1 = ₪3.06');
    expect(readout()).toHaveAccessibleName('fx.readoutLabel $1 = ₪3.06');
  });

  it('shows a dash when there is no rate', () => {
    rates.USD = fxRate({ rate: null, source: 'none', rateDate: null });
    render(<FxRateReadout />);
    expect(readout()).toHaveTextContent('$1 = ₪—');
  });

  it('opens a labelled dialog with both rates, their sources, the rate date and the update time', () => {
    render(<FxRateReadout />);
    fireEvent.click(readout());

    const dialog = screen.getByRole('dialog', { name: 'fx.title' });
    expect(readout()).toHaveAttribute('aria-haspopup', 'dialog');
    expect(within(dialog).getByText('$1 = ₪3.0612')).toBeInTheDocument();
    expect(within(dialog).getByText('€1 = ₪3.5843')).toBeInTheDocument();
    expect(within(dialog).getByText('fx.live')).toBeInTheDocument();
    expect(within(dialog).getByText('fx.cached')).toBeInTheDocument();
    expect(within(dialog).getByText('fx.rateDate Oct 12, 2026')).toBeInTheDocument();
    expect(within(dialog).getByText('fx.updated time.today')).toBeInTheDocument();
  });

  it('leaves out the date lines when no rate is available', () => {
    rates.USD = fxRate({ rate: null, source: 'none', rateDate: null, lastUpdated: null });
    rates.EUR = fxRate({ rate: null, source: 'none', rateDate: null, lastUpdated: null });
    render(<FxRateReadout />);
    fireEvent.click(readout());

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByText('fx.none')).toHaveLength(2);
    expect(within(dialog).queryByText(/fx\.rateDate|fx\.updated/)).toBeNull();
  });

  it('refreshes both rates, focusing Refresh when it opens', () => {
    render(<FxRateReadout />);
    fireEvent.click(readout());

    const refresh = screen.getByRole('button', { name: 'fx.refresh' });
    expect(refresh).toHaveFocus();
    fireEvent.click(refresh);
    expect(rates.USD.refetch).toHaveBeenCalledTimes(1);
    expect(rates.EUR.refetch).toHaveBeenCalledTimes(1);
  });

  it('disables Refresh while a rate is loading', () => {
    rates.EUR = fxRate({ isLoading: true });
    render(<FxRateReadout />);
    fireEvent.click(readout());
    expect(screen.getByRole('button', { name: 'fx.refresh' })).toBeDisabled();
  });

  it('closes on Escape and gives focus back to the readout', () => {
    render(<FxRateReadout />);
    fireEvent.click(readout());
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(readout()).toHaveFocus();
  });
});
