/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SegmentedTabs } from '../SegmentedTabs';

describe('SegmentedTabs', () => {
  const defaultOptions = [
    { value: 'all', label: 'All' },
    { value: 'active', label: 'Active' },
    { value: 'completed', label: 'Completed' },
  ];

  it('renders all options as buttons', () => {
    render(
      <SegmentedTabs
        options={defaultOptions}
        value="all"
        onChange={() => {}}
      />
    );

    expect(screen.getByRole('tab', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Active' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Completed' })).toBeInTheDocument();
  });

  it('marks selected option as active', () => {
    render(
      <SegmentedTabs
        options={defaultOptions}
        value="active"
        onChange={() => {}}
      />
    );

    const activeTab = screen.getByRole('tab', { name: 'Active' });
    expect(activeTab).toHaveAttribute('aria-selected', 'true');
    expect(activeTab).toHaveClass('segment-tab-active');
  });

  it('calls onChange with new value when option clicked', () => {
    const handleChange = vi.fn();
    render(
      <SegmentedTabs
        options={defaultOptions}
        value="all"
        onChange={handleChange}
      />
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Completed' }));

    expect(handleChange).toHaveBeenCalledWith('completed');
  });

  it('renders with tablist role', () => {
    render(
      <SegmentedTabs
        options={defaultOptions}
        value="all"
        onChange={() => {}}
      />
    );

    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });

  it('renders with counts when provided', () => {
    const optionsWithCounts = [
      { value: 'all', label: 'All', count: 42 },
      { value: 'active', label: 'Active', count: 10 },
      { value: 'completed', label: 'Completed', count: 32 },
    ];

    render(
      <SegmentedTabs
        options={optionsWithCounts}
        value="all"
        onChange={() => {}}
      />
    );

    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('32')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    render(
      <SegmentedTabs
        options={defaultOptions}
        value="all"
        onChange={() => {}}
        className="custom-class"
      />
    );

    expect(screen.getByRole('tablist')).toHaveClass('custom-class');
  });

  it('supports undefined value for "all" state', () => {
    const optionsWithUndefined = [
      { value: undefined, label: 'All' },
      { value: 'active', label: 'Active' },
    ];

    render(
      <SegmentedTabs
        options={optionsWithUndefined}
        value={undefined}
        onChange={() => {}}
      />
    );

    const allTab = screen.getByRole('tab', { name: 'All' });
    expect(allTab).toHaveAttribute('aria-selected', 'true');
  });
});
