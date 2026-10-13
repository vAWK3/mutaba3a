import { useEffect, useState, type RefObject } from 'react';

export interface InViewOptions {
  /** Stop observing after the first time the element is seen, and stay true. */
  once?: boolean;
  rootMargin?: string;
  threshold?: number;
}

/**
 * Whether `ref`'s element is in the viewport, from an IntersectionObserver
 * rather than scroll listeners (MUT-77, brief L10: nothing scroll-linked).
 * `null` means not known yet: before the first report, or for good when the
 * browser has no IntersectionObserver. Callers pick the safe reading of
 * unknown for themselves.
 */
export function useInView(
  ref: RefObject<Element | null>,
  { once = false, rootMargin, threshold }: InViewOptions = {},
): boolean | null {
  const [inView, setInView] = useState<boolean | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setInView(entry.isIntersecting);
        if (once && entry.isIntersecting) observer.disconnect();
      },
      { rootMargin, threshold },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, once, rootMargin, threshold]);

  return inView;
}
