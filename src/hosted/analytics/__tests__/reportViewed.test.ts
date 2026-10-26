import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { REPORT_VIEWED_DEBOUNCE_MS, useGlanceViewed, useReportViewed } from '../reportViewed';

/** MUT-175 (D6): report_viewed — debounced, property-light, never signed out. MUT-448: `layer` (taxonomy 2.3.0). */

const trackPortal = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../portalAnalytics', () => ({ trackPortal }));

beforeEach(() => {
  vi.useFakeTimers();
  trackPortal.mockClear();
});
afterEach(() => vi.useRealTimers());

describe('useReportViewed', () => {
  it('sends the layer, period, scope and stage once the view settles, and nothing else', () => {
    const { rerender } = renderHook(({ period }) => useReportViewed(period, 'profile', 2, false), { initialProps: { period: 'month' as 'month' | 'week' } });
    vi.advanceTimersByTime(REPORT_VIEWED_DEBOUNCE_MS - 1);
    rerender({ period: 'week' });
    vi.advanceTimersByTime(REPORT_VIEWED_DEBOUNCE_MS);
    expect(trackPortal).toHaveBeenCalledTimes(1);
    expect(trackPortal).toHaveBeenCalledWith('report_viewed', { layer: 'profile', period: 'week', scope: 'profile', stage: 'stage_2' });
  });

  it('sends nothing signed out, or before the stage is known', () => {
    renderHook(() => useReportViewed('month', 'all', 3, true));
    renderHook(() => useReportViewed('month', 'profile', null, false));
    vi.advanceTimersByTime(REPORT_VIEWED_DEBOUNCE_MS * 2);
    expect(trackPortal).not.toHaveBeenCalled();
  });

  it('sends the Glance as layer glance with its period only, once its verdict answered (MUT-448)', () => {
    const { rerender } = renderHook(({ ready }) => useGlanceViewed('month', ready, false), { initialProps: { ready: false } });
    vi.advanceTimersByTime(REPORT_VIEWED_DEBOUNCE_MS * 2);
    expect(trackPortal).not.toHaveBeenCalled();
    rerender({ ready: true });
    vi.advanceTimersByTime(REPORT_VIEWED_DEBOUNCE_MS);
    expect(trackPortal).toHaveBeenCalledWith('report_viewed', { layer: 'glance', period: 'month' });
    renderHook(() => useGlanceViewed('month', true, true));
    vi.advanceTimersByTime(REPORT_VIEWED_DEBOUNCE_MS);
    expect(trackPortal).toHaveBeenCalledTimes(1);
  });
});
