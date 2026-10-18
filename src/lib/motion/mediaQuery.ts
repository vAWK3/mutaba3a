import { useSyncExternalStore } from 'react';

/**
 * A CSS media query as React state, kept in step with the browser (moved here
 * from `src/hooks` for MUT-268: the portal may not import a `hooks/` path,
 * hosted-portal.md §8). False where `matchMedia` is missing (tests, SSR).
 */

function hasMatchMedia(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}

const subscribers = new Map<string, (onChange: () => void) => () => void>();

function subscribeTo(query: string) {
  let subscribe = subscribers.get(query);
  if (!subscribe) {
    subscribe = (onChange: () => void) => {
      if (!hasMatchMedia()) return () => {};
      const media = window.matchMedia(query);
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    };
    subscribers.set(query, subscribe);
  }
  return subscribe;
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    subscribeTo(query),
    () => hasMatchMedia() && window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * Whether the person has asked for reduced motion, kept in step with the OS
 * setting. Motion code uses it to swap slides and springs for cross-fades or
 * to skip an animation outright; CSS uses the media query directly.
 */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}
