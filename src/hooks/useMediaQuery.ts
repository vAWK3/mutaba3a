import { useState, useEffect } from 'react';
import { BREAKPOINTS, minWidthQuery } from '../lib/breakpoints';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mq = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);

    // Set initial value via micro-task to avoid synchronous setState in effect
    Promise.resolve().then(() => {
      setMatches(mq.matches);
    });

    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

export function useIsCompactTable(): boolean {
  return useMediaQuery('(max-width: 768px)');
}

/** Whether the window is wide enough to open a client beside the Clients list (MUT-84). */
export function useIsSplitView(): boolean {
  return useMediaQuery(minWidthQuery(BREAKPOINTS.clientsSplit));
}
