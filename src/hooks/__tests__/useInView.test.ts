import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useInView } from '../useInView';

/** A stand-in IntersectionObserver the test drives by hand. */
class FakeObserver {
  static instances: FakeObserver[] = [];
  readonly observed: Element[] = [];
  disconnected = false;

  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    FakeObserver.instances.push(this);
  }

  observe(element: Element) {
    this.observed.push(element);
  }

  disconnect() {
    this.disconnected = true;
  }

  unobserve() {}

  takeRecords() {
    return [];
  }

  /** Reports `element` entering (true) or leaving (false) the viewport. */
  report(isIntersecting: boolean) {
    act(() => {
      this.callback(
        [{ isIntersecting, target: this.observed[0] } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
    });
  }
}

const element = document.createElement('div');
const ref = { current: element };

beforeEach(() => {
  FakeObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', FakeObserver);
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
