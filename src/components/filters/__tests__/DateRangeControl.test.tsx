import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DateRangeControl } from '../DateRangeControl';
import * as i18n from '../../../lib/i18n';
import * as utils from '../../../lib/utils';

// Mock i18n
vi.mock('../../../lib/i18n', () => ({
  useT: vi.fn(),
}));

// Mock utils
vi.mock('../../../lib/utils', () => ({
  getDateRangePreset: vi.fn(),
}));

describe('DateRangeControl', () => {
  const mockOnChange = vi.fn();
  const mockT = vi.fn((key: string) => {
    const translations: Record<string, string> = {
      'filters.thisMonth': 'This Month',
      'filters.lastMonth': 'Last Month',
      'filters.thisYear': 'This Year',
      'filters.allTime': 'All Time',
      'filters.custom': 'Custom',
    };
    return translations[key] || key;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    (i18n.useT as ReturnType<typeof vi.fn>).mockReturnValue(mockT);

    // Default mock for getDateRangePreset
    (utils.getDateRangePreset as ReturnType<typeof vi.fn>).mockImplementation((preset: string) => {
      const presets: Record<string, { dateFrom: string; dateTo: string }> = {
        'this-month': { dateFrom: '2026-03-01', dateTo: '2026-03-31' },
        'last-month': { dateFrom: '2026-02-01', dateTo: '2026-02-28' },
        'this-year': { dateFrom: '2026-01-01', dateTo: '2026-12-31' },
        'all': { dateFrom: '2000-01-01', dateTo: '2100-12-31' },
      };
      return presets[preset] || { dateFrom: '', dateTo: '' };
    });
  });

  it('should render preset options', () => {
    render(
      <DateRangeControl
        dateFrom="2026-03-01"
        dateTo="2026-03-31"
        onChange={mockOnChange}
      />
    );

    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByText('This Month')).toBeInTheDocument();
    expect(screen.getByText('Last Month')).toBeInTheDocument();
    expect(screen.getByText('This Year')).toBeInTheDocument();
    expect(screen.getByText('All Time')).toBeInTheDocument();
    expect(screen.getByText('Custom')).toBeInTheDocument();
  });

  it('should detect and select current preset', () => {
    render(
      <DateRangeControl
        dateFrom="2026-03-01"
        dateTo="2026-03-31"
        onChange={mockOnChange}
      />
    );

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('this-month');
  });

  it('should call onChange when preset is selected', () => {
    render(
      <DateRangeControl
        dateFrom="2026-03-01"
        dateTo="2026-03-31"
        onChange={mockOnChange}
      />
    );

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'last-month' } });

    expect(mockOnChange).toHaveBeenCalledWith('2026-02-01', '2026-02-28');
  });

  it('should show custom date picker when custom is selected', () => {
    render(
      <DateRangeControl
        dateFrom="2026-03-01"
        dateTo="2026-03-31"
        onChange={mockOnChange}
      />
    );

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'custom' } });

    // Should show date inputs (type="date" inputs)
    const dateInputs = document.querySelectorAll('input[type="date"]');
    expect(dateInputs.length).toBe(2);
  });

  it('should display date range for presets', () => {
    render(
      <DateRangeControl
        dateFrom="2026-03-01"
        dateTo="2026-03-31"
        onChange={mockOnChange}
      />
    );

    // Should show formatted date range
    expect(screen.getByText(/01\/03\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/31\/03\/2026/)).toBeInTheDocument();
  });

  it('should detect custom date range', () => {
    render(
      <DateRangeControl
        dateFrom="2026-03-05"
        dateTo="2026-03-20"
        onChange={mockOnChange}
      />
    );

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('custom');
  });

  it('should call onChange when custom date from changes', async () => {
    // Start with custom range to show inputs
    render(
      <DateRangeControl
        dateFrom="2026-03-05"
        dateTo="2026-03-20"
        onChange={mockOnChange}
      />
    );

    // Find the from date input (first date input)
    const dateInputs = document.querySelectorAll('input[type="date"]');
    expect(dateInputs.length).toBe(2);

    const fromInput = dateInputs[0] as HTMLInputElement;
    fireEvent.change(fromInput, { target: { value: '2026-03-10' } });

    expect(mockOnChange).toHaveBeenCalledWith('2026-03-10', '2026-03-20');
  });

  it('should call onChange when custom date to changes', () => {
    render(
      <DateRangeControl
        dateFrom="2026-03-05"
        dateTo="2026-03-20"
        onChange={mockOnChange}
      />
    );

    const dateInputs = document.querySelectorAll('input[type="date"]');
    const toInput = dateInputs[1] as HTMLInputElement;
    fireEvent.change(toInput, { target: { value: '2026-03-25' } });

    expect(mockOnChange).toHaveBeenCalledWith('2026-03-05', '2026-03-25');
  });

  it('should use correct translations', () => {
    render(
      <DateRangeControl
        dateFrom="2026-03-01"
        dateTo="2026-03-31"
        onChange={mockOnChange}
      />
    );

    expect(mockT).toHaveBeenCalledWith('filters.thisMonth');
    expect(mockT).toHaveBeenCalledWith('filters.lastMonth');
    expect(mockT).toHaveBeenCalledWith('filters.thisYear');
    expect(mockT).toHaveBeenCalledWith('filters.allTime');
    expect(mockT).toHaveBeenCalledWith('filters.custom');
  });
});
