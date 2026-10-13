import { act } from '@testing-library/react';
import { vi } from 'vitest';

/**
 * A stand-in IntersectionObserver that tests drive by hand (jsdom has none).
 * `installFakeIntersectionObserver()` stubs the global; `reportFor` tells the
 * observers watching an element that it entered or left the viewport.
 */
export class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly observed: Element[] = [];
  disconnected = false;

  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    FakeIntersectionObserver.instances.push(this);
  }

  observe(element: Element) {
    this.observed.push(element);
  }

  unobserve(element: Element) {
    this.observed.splice(this.observed.indexOf(element), 1);
  }

  disconnect() {
    this.disconnected = true;
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  /** Reports this observer's first element entering (true) or leaving (false) the viewport. */
  report(isIntersecting: boolean) {
    this.reportElement(this.observed[0], isIntersecting);
  }

  private reportElement(target: Element, isIntersecting: boolean) {
    if (this.disconnected) return;
    act(() => {
      this.callback([{ isIntersecting, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    });
  }

  /** Reports `element` to every live observer watching it. */
  static reportFor(element: Element, isIntersecting: boolean) {
    for (const observer of FakeIntersectionObserver.instances) {
      if (observer.observed.includes(element)) observer.reportElement(element, isIntersecting);
    }
  }
}

export function installFakeIntersectionObserver() {
  FakeIntersectionObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
}
