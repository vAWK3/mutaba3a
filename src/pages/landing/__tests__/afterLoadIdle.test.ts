import { afterEach, describe, expect, it, vi } from 'vitest';
import { afterLoadIdle, FALLBACK_IDLE_MS } from '../afterLoadIdle';

/**
 * When the landing's lazy SDKs (PostHog, Sentry) may load: after the page
 * has loaded, then once the browser is idle, so first paint carries neither
 * (MUT-154 D1, MUT-150 eng D5).
 */
describe('afterLoadIdle', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('waits for load, then idle, before running', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestIdleCallback', undefined);
    const readyState = vi.spyOn(document, 'readyState', 'get').mockReturnValue('interactive');
    const run = vi.fn();
    afterLoadIdle(run);
    vi.advanceTimersByTime(FALLBACK_IDLE_MS * 2);
    expect(run).not.toHaveBeenCalled();
    readyState.mockReturnValue('complete');
    window.dispatchEvent(new Event('load'));
    vi.advanceTimersByTime(FALLBACK_IDLE_MS - 1);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('uses requestIdleCallback when the browser has it, with the fallback as its timeout', () => {
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete');
    const idle = vi.fn<(callback: () => void, options?: { timeout: number }) => number>(() => 7);
    vi.stubGlobal('requestIdleCallback', idle);
    vi.stubGlobal('cancelIdleCallback', vi.fn());
    const run = vi.fn();
    afterLoadIdle(run);
    expect(idle).toHaveBeenCalledWith(run, { timeout: FALLBACK_IDLE_MS });
  });

  it('cancels before load and while waiting for idle', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestIdleCallback', undefined);
    const readyState = vi.spyOn(document, 'readyState', 'get').mockReturnValue('interactive');
    const beforeLoad = vi.fn();
    afterLoadIdle(beforeLoad)();
    window.dispatchEvent(new Event('load'));
    vi.advanceTimersByTime(FALLBACK_IDLE_MS);
    expect(beforeLoad).not.toHaveBeenCalled();

    readyState.mockReturnValue('complete');
    const whileIdle = vi.fn();
    const cancel = afterLoadIdle(whileIdle);
    cancel();
    vi.advanceTimersByTime(FALLBACK_IDLE_MS);
    expect(whileIdle).not.toHaveBeenCalled();
  });
});
