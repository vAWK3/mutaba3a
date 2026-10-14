import { useEffect, useRef, useState } from 'react';
import { isStaleAnchor } from './filters';

/**
 * A list that Show can start at a saved record (MUT-91; ExpensesList and
 * ConversionsList). One place for what both need:
 * - `show(id)`: replace the filters with `{ anchor: id }` and ask the note
 *   above the list to take focus;
 * - `showLatest()`: drop the anchor, keep the other filters;
 * - a stale anchor (the server's ANCHOR_NOT_FOUND 404: the record is gone, or a
 *   bookmark outlived it) drops itself instead of reading as a lost profile.
 */
export function useAnchoredList<F extends { anchor?: string }>(filters: F, setFilters: (next: F) => void, listError: unknown) {
  const [focusRequest, setFocusRequest] = useState(0);
  const staleAnchor = Boolean(filters.anchor) && isStaleAnchor(listError);

  // Once per stale anchor: setFilters is a new function every render, so read the latest through a ref.
  const latest = useRef({ filters, setFilters });
  useEffect(() => {
    latest.current = { filters, setFilters };
  });
  useEffect(() => {
    if (staleAnchor) latest.current.setFilters({ ...latest.current.filters, anchor: undefined });
  }, [staleAnchor]);

  const show = (anchor: string) => {
    setFocusRequest((n) => n + 1);
    setFilters({ anchor } as F);
  };
  const showLatest = () => setFilters({ ...filters, anchor: undefined });

  return { staleAnchor, focusRequest, show, showLatest };
}
