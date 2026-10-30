import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentMode, isLocalMode, MODE_KEY, readModeHint, setMode, setUnhintedMode, useIsLocalMode } from '../mode';

/** The mode hint (MUT-286, brief §2.6): one localStorage key, `local` or `remote`; anything else is no hint. */

describe('portal mode', () => {
  beforeEach(() => {
    localStorage.clear();
    setUnhintedMode('probe');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has no hint on a first visit, so the server is asked', () => {
    expect(readModeHint()).toBeNull();
    expect(currentMode()).toBe('probe');
    expect(isLocalMode()).toBe(false);
  });

  it('stores the mode it is told and reads it back', () => {
    setMode('local');
    expect(localStorage.getItem(MODE_KEY)).toBe('local');
    expect(currentMode()).toBe('local');
    expect(isLocalMode()).toBe(true);

    setMode('remote');
    expect(currentMode()).toBe('remote');
  });

  it('treats an unknown stored value as no hint', () => {
    localStorage.setItem(MODE_KEY, 'cloud');
    expect(readModeHint()).toBeNull();
  });

  it('with storage blocked, still knows the mode for this page', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    setMode('local');

    expect(readModeHint()).toBeNull();
    expect(currentMode()).toBe('local');
  });

  // MUT-513: the server said nobody is signed in and this browser hasn't chosen. Never stored, never "local".
  it('undecided is held for this page only, is not local, and any saved choice wins over it', () => {
    setUnhintedMode('undecided');
    expect(currentMode()).toBe('undecided');
    expect(isLocalMode()).toBe(false);
    expect(localStorage.getItem(MODE_KEY)).toBeNull();

    setMode('local');

    expect(currentMode()).toBe('local');
  });

  it('re-renders a reader when the mode changes in this tab', () => {
    setMode('remote');
    const { result } = renderHook(() => useIsLocalMode());
    expect(result.current).toBe(false);

    act(() => setMode('local'));

    expect(result.current).toBe(true);
  });
});
