import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSavedFlashRows, useSavedFlashResolution } from '../useSavedFlash';
import { useSavedFlashStore, type SavedFlash } from '../../lib/savedFlashStore';

function income(overrides: Partial<SavedFlash> = {}): SavedFlash {
  return {
    kind: 'income',
    ids: ['tx-1'],
    clientId: 'client-1',
    clientName: 'Furniture Co.',
    profileId: 'profile-1',
    ...overrides,
  };
}

const SETTLED = { isLoading: false, isFetching: false };
const LOADING = { isLoading: true, isFetching: false };

describe('useSavedFlashRows', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    act(() => useSavedFlashStore.getState().clear());
  });
  afterEach(() => vi.useRealTimers());

  it('claims a visible row once settled and the predicate flags it', () => {
    act(() => useSavedFlashStore.getState().markSaved(income()));
    const { result, rerender } = renderHook(
      ({ ids, query }) => useSavedFlashRows('list-a', ids, query),
      { initialProps: { ids: ['tx-1', 'tx-2'], query: SETTLED } }
    );
    rerender({ ids: ['tx-1', 'tx-2'], query: SETTLED });
    expect(result.current('tx-1')).toBe(true);
    expect(result.current('tx-2')).toBe(false);
  });

  it('does not report settled while the query is still loading', () => {
    act(() => useSavedFlashStore.getState().markSaved(income()));
    const { rerender } = renderHook(({ query }) => useSavedFlashRows('list-a', ['tx-1'], query), {
      initialProps: { query: LOADING },
    });
    expect(useSavedFlashStore.getState().claimed).toBeNull();
    rerender({ query: SETTLED });
    expect(useSavedFlashStore.getState().claimed).toBe(true);
  });

  it('deregisters the list on unmount, letting resolution proceed without it', () => {
    act(() => useSavedFlashStore.getState().markSaved(income()));
    const { unmount } = renderHook(() => useSavedFlashRows('list-a', ['other'], SETTLED));
    unmount();
    const { rerender } = renderHook(
      ({ query }) => useSavedFlashRows('list-b', ['other-2'], query),
      { initialProps: { query: SETTLED } }
    );
    rerender({ query: SETTLED });
    expect(useSavedFlashStore.getState().claimed).toBe(false);
  });
});

describe('useSavedFlashResolution', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    act(() => useSavedFlashStore.getState().clear());
  });
  afterEach(() => vi.useRealTimers());

  it('reports claimed, pending and flashIds for the announcer', () => {
    act(() => useSavedFlashStore.getState().markSaved(income()));
    const { result } = renderHook(() => useSavedFlashResolution());
    expect(result.current.pending?.clientName).toBe('Furniture Co.');
    expect(result.current.claimed).toBeNull();
  });
});
