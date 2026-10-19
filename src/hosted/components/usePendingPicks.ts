import { useCallback, useRef, useState, type FormEvent } from 'react';

/**
 * Holds a hosted drawer's Save while a picker's Add «name» is still being created (MUT-318 review, Basel D1): a record
 * saved meanwhile would miss the client or matter being added and leave it unlinked. The local IncomeDrawer does the
 * same with `clientCreating`.
 *
 * Pickers report through `track` (their `onCreatingChange`). `pending` drives Save's look; `guard` wraps the form's
 * submit handler and drops a submit while any add is in flight, before validation runs (so Owed doesn't flag a client
 * that is about to land). It reads a ref, not state: a picker reports done just before EntityTypeahead submits for an
 * Enter held during the save, ahead of the re-render, and that submit must go through.
 */
export function usePendingPicks() {
  const inFlight = useRef(0);
  const [pending, setPending] = useState(false);

  const track = useCallback((creating: boolean) => {
    inFlight.current = Math.max(0, inFlight.current + (creating ? 1 : -1));
    setPending(inFlight.current > 0);
  }, []);

  const guard = useCallback(
    (submit: (event?: FormEvent) => void | Promise<void>) => (event: FormEvent) => {
      if (inFlight.current > 0) {
        event.preventDefault();
        return;
      }
      void submit(event);
    },
    [],
  );

  return { pending, track, guard };
}
