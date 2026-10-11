import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePrefersReducedMotion } from '../usePrefersReducedMotion';

type Listener = (event: { matches: boolean }) => void;

function mockMatchMedia(initial: boolean) {
  const listeners = new Set<Listener>();
  const query = {
    matches: initial,
    media: '(prefers-reduced-motion: reduce)',
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l),
  };
  window.matchMedia = vi.fn().mockReturnValue(query) as unknown as typeof window.matchMedia;
  return {
    set(matches: boolean) {
      query.matches = matches;
      listeners.forEach((l) => l({ matches }));
    },
    listenerCount: () => listeners.size,
  };
}

const original = window.matchMedia;
afterEach(() => {
  window.matchMedia = original;
});

describe('usePrefersReducedMotion', () => {
  it('reads the current preference', () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(true);
  });

  it('follows changes to the preference and stops listening on unmount', () => {
    const media = mockMatchMedia(false);
    const { result, unmount } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);

    act(() => media.set(true));
    expect(result.current).toBe(true);

    unmount();
    expect(media.listenerCount()).toBe(0);
  });

  it('allows motion when matchMedia is unavailable', () => {
    // @ts-expect-error simulate an environment without matchMedia
    window.matchMedia = undefined;
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
  });
});
