import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TypeSegment } from '../TypeSegment';

// Mock the i18n module
vi.mock('../../../lib/i18n', () => ({
  useT: () => (key: string) => key,
}));

describe('TypeSegment', () => {
  it('should render all segment options', () => {
    render(<TypeSegment value={undefined} onChange={() => {}} />);

    expect(screen.getByText('filters.type.all')).toBeInTheDocument();
    expect(screen.getByText('filters.type.income')).toBeInTheDocument();
    expect(screen.getByText('filters.type.receivable')).toBeInTheDocument();
    expect(screen.getByText('filters.type.expense')).toBeInTheDocument();
  });

  it('should highlight the active segment', () => {
    render(<TypeSegment value="income" onChange={() => {}} />);

    const incomeButton = screen.getByText('filters.type.income');
    const allButton = screen.getByText('filters.type.all');

    expect(incomeButton).toHaveClass('active');
    expect(allButton).not.toHaveClass('active');
  });

  it('should call onChange when a segment is clicked', () => {
    const onChange = vi.fn();
    render(<TypeSegment value={undefined} onChange={onChange} />);

    fireEvent.click(screen.getByText('filters.type.expense'));

    expect(onChange).toHaveBeenCalledWith('expense');
  });

  it('should call onChange with undefined for All', () => {
    const onChange = vi.fn();
    render(<TypeSegment value="income" onChange={onChange} />);

    fireEvent.click(screen.getByText('filters.type.all'));

    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('should call onChange with receivable', () => {
    const onChange = vi.fn();
    render(<TypeSegment value={undefined} onChange={onChange} />);

    fireEvent.click(screen.getByText('filters.type.receivable'));

    expect(onChange).toHaveBeenCalledWith('receivable');
  });

  it('should highlight receivable when selected', () => {
    render(<TypeSegment value="receivable" onChange={() => {}} />);

    const receivableButton = screen.getByText('filters.type.receivable');
    expect(receivableButton).toHaveClass('active');
  });

  it('should highlight expense when selected', () => {
    render(<TypeSegment value="expense" onChange={() => {}} />);

    const expenseButton = screen.getByText('filters.type.expense');
    expect(expenseButton).toHaveClass('active');
  });
});
