import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useInView } from '../useInView';
import { FakeIntersectionObserver as FakeObserver, installFakeIntersectionObserver } from '../../test/intersectionObserver';

const element = document.createElement('div');
const ref = { current: element };

beforeEach(() => {
  installFakeIntersectionObserver();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useInView', () => {
  it('is unknown (null) until the observer first reports', () => {
    const { result } = renderHook(() => useInView(ref));
    expect(result.current).toBeNull();
    expect(FakeObserver.instances[0].observed).toEqual([element]);
  });

  it('follows the element in and out of view', () => {
    const { result } = renderHook(() => useInView(ref));
    const observer = FakeObserver.instances[0];

    observer.report(true);
    expect(result.current).toBe(true);
    observer.report(false);
    expect(result.current).toBe(false);
  });

  it('passes rootMargin and threshold through', () => {
    renderHook(() => useInView(ref, { rootMargin: '0px 0px -10% 0px', threshold: 0.2 }));
    expect(FakeObserver.instances[0].options).toEqual({ rootMargin: '0px 0px -10% 0px', threshold: 0.2 });
  });

  it('with once, stops observing after the first sighting and stays true', () => {
    const { result } = renderHook(() => useInView(ref, { once: true }));
    const observer = FakeObserver.instances[0];

    observer.report(false);
    expect(observer.disconnected).toBe(false);
    observer.report(true);
    expect(result.current).toBe(true);
    expect(observer.disconnected).toBe(true);
  });

  it('disconnects on unmount', () => {
    const { unmount } = renderHook(() => useInView(ref));
    unmount();
    expect(FakeObserver.instances[0].disconnected).toBe(true);
  });

  it('stays unknown when the browser has no IntersectionObserver', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const { result } = renderHook(() => useInView(ref));
    expect(result.current).toBeNull();
  });

  it('stays unknown when the ref is empty', () => {
    const { result } = renderHook(() => useInView({ current: null }));
    expect(result.current).toBeNull();
    expect(FakeObserver.instances).toHaveLength(0);
  });
});
