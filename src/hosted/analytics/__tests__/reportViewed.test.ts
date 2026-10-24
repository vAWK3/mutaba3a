import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { REPORT_VIEWED_DEBOUNCE_MS, useReportViewed } from '../reportViewed';

/** MUT-175 (D6): report_viewed — debounced, property-light, never signed out. */

const trackPortal = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../portalAnalytics', () => ({ trackPortal }));

beforeEach(() => {
  vi.useFakeTimers();
  trackPortal.mockClear();
});
afterEach(() => vi.useRealTimers());

describe('useReportViewed', () => {
  it('sends the period, scope and stage once the view settles, and nothing else', () => {
    const { rerender } = renderHook(({ period }) => useReportViewed(period, 'profile', 2, false), { initialProps: { period: 'month' as 'month' | 'week' } });
    vi.advanceTimersByTime(REPORT_VIEWED_DEBOUNCE_MS - 1);
    rerender({ period: 'week' });
    vi.advanceTimersByTime(REPORT_VIEWED_DEBOUNCE_MS);
    expect(trackPortal).toHaveBeenCalledTimes(1);
    expect(trackPortal).toHaveBeenCalledWith('report_viewed', { period: 'week', scope: 'profile', stage: 'stage_2' });
  });

  it('sends nothing signed out, or before the stage is known', () => {
    renderHook(() => useReportViewed('month', 'all', 3, true));
    renderHook(() => useReportViewed('month', 'profile', null, false));
    vi.advanceTimersByTime(REPORT_VIEWED_DEBOUNCE_MS * 2);
    expect(trackPortal).not.toHaveBeenCalled();
  });
});
