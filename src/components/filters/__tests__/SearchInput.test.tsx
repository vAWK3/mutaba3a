import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { SearchInput, type SearchInputRef } from '../SearchInput';
import * as i18n from '../../../lib/i18n';
import React from 'react';

// Mock i18n
vi.mock('../../../lib/i18n', () => ({
  useT: vi.fn(),
}));

describe('SearchInput', () => {
  const mockOnChange = vi.fn();
  const mockT = vi.fn((key: string) => {
    const translations: Record<string, string> = {
      'common.search': 'Search...',
    };
    return translations[key] || key;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    (i18n.useT as ReturnType<typeof vi.fn>).mockReturnValue(mockT);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should render with default placeholder', () => {
    render(
      <SearchInput
        value=""
        onChange={mockOnChange}
      />
    );

    expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
  });

  it('should render with custom placeholder', () => {
    render(
      <SearchInput
        value=""
        onChange={mockOnChange}
        placeholder="Find clients..."
      />
    );

    expect(screen.getByPlaceholderText('Find clients...')).toBeInTheDocument();
  });

  it('should render with initial value', () => {
    render(
      <SearchInput
        value="test query"
        onChange={mockOnChange}
      />
    );

    expect(screen.getByDisplayValue('test query')).toBeInTheDocument();
  });

  it('should debounce onChange calls', async () => {
    render(
      <SearchInput
        value=""
        onChange={mockOnChange}
        debounceMs={200}
      />
    );

    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: 't' } });
    fireEvent.change(input, { target: { value: 'te' } });
    fireEvent.change(input, { target: { value: 'tes' } });
    fireEvent.change(input, { target: { value: 'test' } });

    // Should not have called onChange yet
    expect(mockOnChange).not.toHaveBeenCalled();

    // Advance timers past debounce
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    // Should only call once with final value
    expect(mockOnChange).toHaveBeenCalledTimes(1);
    expect(mockOnChange).toHaveBeenCalledWith('test');
  });

  it('should update immediately on local input', () => {
    render(
      <SearchInput
        value=""
        onChange={mockOnChange}
      />
    );

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'hello' } });

    // Local value should update immediately
    expect(screen.getByDisplayValue('hello')).toBeInTheDocument();
  });

  it('should sync with external value changes', async () => {
    const { rerender } = render(
      <SearchInput
        value="initial"
        onChange={mockOnChange}
      />
    );

    expect(screen.getByDisplayValue('initial')).toBeInTheDocument();

    rerender(
      <SearchInput
        value="updated"
        onChange={mockOnChange}
      />
    );

    expect(screen.getByDisplayValue('updated')).toBeInTheDocument();
  });

  it('should show clear button when has value', () => {
    render(
      <SearchInput
        value="test"
        onChange={mockOnChange}
      />
    );

    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('should not show clear button when empty', () => {
    render(
      <SearchInput
        value=""
        onChange={mockOnChange}
      />
    );

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('should clear input when clear button clicked', async () => {
    render(
      <SearchInput
        value="test"
        onChange={mockOnChange}
      />
    );

    const clearButton = screen.getByRole('button');
    fireEvent.click(clearButton);

    // Should immediately call onChange with empty string
    expect(mockOnChange).toHaveBeenCalledWith('');
    expect(screen.getByDisplayValue('')).toBeInTheDocument();
  });

  it('should expose focus method via ref', () => {
    const ref = React.createRef<SearchInputRef>();

    render(
      <SearchInput
        ref={ref}
        value=""
        onChange={mockOnChange}
      />
    );

    const input = screen.getByRole('textbox');

    act(() => {
      ref.current?.focus();
    });

    expect(document.activeElement).toBe(input);
  });

  it('should clean up timeout on unmount', () => {
    const { unmount } = render(
      <SearchInput
        value=""
        onChange={mockOnChange}
      />
    );

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'test' } });

    // Unmount before debounce completes
    unmount();

    // Advance timers - should not throw
    act(() => {
      vi.advanceTimersByTime(200);
    });

    // onChange should not be called (timeout was cleared)
    expect(mockOnChange).not.toHaveBeenCalled();
  });

  it('should render search icon', () => {
    render(
      <SearchInput
        value=""
        onChange={mockOnChange}
      />
    );

    // Check for SVG (search icon)
    const svg = document.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('should cancel pending debounce when new value typed', async () => {
    render(
      <SearchInput
        value=""
        onChange={mockOnChange}
        debounceMs={300}
      />
    );

    const input = screen.getByRole('textbox');

    // Type first value
    fireEvent.change(input, { target: { value: 'first' } });

    // Wait partial debounce time
    await act(async () => {
      vi.advanceTimersByTime(150);
    });

    // Type second value (should cancel first)
    fireEvent.change(input, { target: { value: 'second' } });

    // Complete second debounce
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    // Should only call once with final value
    expect(mockOnChange).toHaveBeenCalledTimes(1);
    expect(mockOnChange).toHaveBeenCalledWith('second');
  });

  it('should use default debounce of 200ms', async () => {
    render(
      <SearchInput
        value=""
        onChange={mockOnChange}
      />
    );

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'test' } });

    // 199ms - should not have called
    await act(async () => {
      vi.advanceTimersByTime(199);
    });
    expect(mockOnChange).not.toHaveBeenCalled();

    // 1 more ms - should have called
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(mockOnChange).toHaveBeenCalledWith('test');
  });
});
