import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCountUp } from '../useCountUp';

const reduced = vi.hoisted(() => ({ value: false }));
vi.mock('../../../hooks/usePrefersReducedMotion', () => ({
  usePrefersReducedMotion: () => reduced.value,
}));

// A manual frame clock so the animation can be stepped deterministically.
let now = 0;
let queue: Array<(t: number) => void> = [];
function advance(ms: number) {
  now += ms;
  const frames = queue;
  queue = [];
  frames.forEach((cb) => cb(now));
}

beforeEach(() => {
  reduced.value = false;
  now = 0;
  queue = [];
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
    queue.push(cb);
    return queue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    queue = [];
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useCountUp', () => {
  it('shows the target straight away when reduced motion is preferred', () => {
    reduced.value = true;
    const { result } = renderHook(() => useCountUp(4683441, 600));
    expect(result.current).toBe(4683441);
  });

  it('counts from zero to the target over the duration', () => {
    const { result } = renderHook(() => useCountUp(90000, 600));
    expect(result.current).toBe(0);

    act(() => advance(300));
    expect(result.current).toBeGreaterThan(0);
    expect(result.current).toBeLessThan(90000);

    act(() => advance(400));
    expect(result.current).toBe(90000);
  });

  it('runs once: a re-render with the same target does not restart it', () => {
    const { result, rerender } = renderHook(() => useCountUp(90000, 600));
    act(() => advance(700));
    expect(result.current).toBe(90000);

    rerender();
    expect(result.current).toBe(90000);
  });
});
