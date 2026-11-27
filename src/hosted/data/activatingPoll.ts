import { useEffect, useRef, useState } from 'react';

/**
 * MUT-770 (design DR-5, B15): after Stripe sends the accountant back, the desk shows "Activating" and asks the list
 * again until the customer's subscription arrives by the webhook (`paid`), for at most 2 minutes, then says "Check back
 * shortly". "Activating" is the portal's own poll, not a server state.
 */

/** DR-5: the poll's whole life. */
export const ACTIVATING_MAX_MS = 120_000;
/** How often the list is asked again while activating. */
export const ACTIVATING_EVERY_MS = 4_000;

export type ActivatingPhase = 'activating' | 'active' | 'late';

/** Where a poll stands: paid wins at any time; past 2 minutes unpaid is late. */
export function activatingPhase(paid: boolean, startedAt: number, now: number): ActivatingPhase {
  if (paid) return 'active';
  return now - startedAt >= ACTIVATING_MAX_MS ? 'late' : 'activating';
}

/**
 * Calls `poll` every {@link ACTIVATING_EVERY_MS} while the phase is `activating`, and turns `late` on its own when the
 * 2 minutes run out. `startedAt` is when Stripe sent the person back (kept across a reload by the caller).
 */
export function useActivatingPoll({ startedAt, paid, poll }: { startedAt: number; paid: boolean; poll: () => void }): ActivatingPhase {
  const [now, setNow] = useState(() => Date.now());
  const pollRef = useRef(poll);
  useEffect(() => {
    pollRef.current = poll;
  }, [poll]);
  const phase = activatingPhase(paid, startedAt, now);

  useEffect(() => {
    if (phase !== 'activating') return undefined;
    const every = setInterval(() => {
      setNow(Date.now());
      pollRef.current();
    }, ACTIVATING_EVERY_MS);
    const lateAt = setTimeout(() => setNow(Date.now()), Math.max(0, startedAt + ACTIVATING_MAX_MS - Date.now()));
    return () => {
      clearInterval(every);
      clearTimeout(lateAt);
    };
  }, [phase, startedAt]);

  return phase;
}
