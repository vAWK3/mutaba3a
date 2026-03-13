import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSortState } from '../useSortState';

// Mock window.history.replaceState
const mockReplaceState = vi.fn();
const originalReplaceState = window.history.replaceState;

// Mock URLSearchParams
const originalURL = window.location;

describe('useSortState', () => {
  beforeEach(() => {
    window.history.replaceState = mockReplaceState;
    mockReplaceState.mockClear();

    // Reset URL to clean state
    Object.defineProperty(window, 'location', {
      value: { ...originalURL, search: '', pathname: '/clients' },
      writable: true,
    });
  });

  afterEach(() => {
    window.history.replaceState = originalReplaceState;
    Object.defineProperty(window, 'location', { value: originalURL, writable: true });
  });

  it('should use default values when URL has no sort params', () => {
    const { result } = renderHook(() =>
      useSortState({
        defaultField: 'name',
        defaultDir: 'asc',
      })
    );

    expect(result.current.sortField).toBe('name');
    expect(result.current.sortDir).toBe('asc');
  });

  it('should read sort params from URL', () => {
    Object.defineProperty(window, 'location', {
      value: { ...originalURL, search: '?sort=value&dir=desc', pathname: '/clients' },
      writable: true,
    });

    const { result } = renderHook(() =>
      useSortState<'name' | 'value' | 'activity'>({
        defaultField: 'name',
        defaultDir: 'asc',
      })
    );

    expect(result.current.sortField).toBe('value');
    expect(result.current.sortDir).toBe('desc');
  });

  it('should update URL when sort changes', () => {
    const { result } = renderHook(() =>
      useSortState<'name' | 'value'>({
        defaultField: 'name',
        defaultDir: 'asc',
      })
    );

    act(() => {
      result.current.setSortField('value');
    });

    expect(result.current.sortField).toBe('value');
    expect(mockReplaceState).toHaveBeenCalled();
  });

  it('should toggle sort direction', () => {
    const { result } = renderHook(() =>
      useSortState({
        defaultField: 'name',
        defaultDir: 'asc',
      })
    );

    act(() => {
      result.current.toggleSort();
    });

    expect(result.current.sortDir).toBe('desc');

    act(() => {
      result.current.toggleSort();
    });

    expect(result.current.sortDir).toBe('asc');
  });

  it('should support custom param prefix', () => {
    Object.defineProperty(window, 'location', {
      value: { ...originalURL, search: '?projects_sort=net&projects_dir=desc', pathname: '/projects' },
      writable: true,
    });

    const { result } = renderHook(() =>
      useSortState<'name' | 'net'>({
        defaultField: 'name',
        defaultDir: 'asc',
        paramPrefix: 'projects',
      })
    );

    expect(result.current.sortField).toBe('net');
    expect(result.current.sortDir).toBe('desc');
  });

  it('should fallback to defaults for invalid URL params', () => {
    Object.defineProperty(window, 'location', {
      value: { ...originalURL, search: '?sort=invalid&dir=wrong', pathname: '/clients' },
      writable: true,
    });

    const { result } = renderHook(() =>
      useSortState<'name' | 'value'>({
        defaultField: 'name',
        defaultDir: 'asc',
        validFields: ['name', 'value'],
      })
    );

    expect(result.current.sortField).toBe('name');
    expect(result.current.sortDir).toBe('asc');
  });

  it('should remove sort params from URL when setting defaults', () => {
    Object.defineProperty(window, 'location', {
      value: { ...originalURL, search: '?sort=value&dir=desc', pathname: '/clients' },
      writable: true,
    });

    const { result } = renderHook(() =>
      useSortState<'name' | 'value'>({
        defaultField: 'name',
        defaultDir: 'asc',
      })
    );

    act(() => {
      result.current.setSortField('name');
    });

    act(() => {
      result.current.setSortDir('asc');
    });

    // URL should be cleaned when returning to defaults
    const lastCall = mockReplaceState.mock.calls[mockReplaceState.mock.calls.length - 1];
    expect(lastCall[2]).not.toContain('sort=name');
  });
});
