import { useCallback, useEffect, useId } from 'react';
import { useSavedFlashStore } from './savedFlashStore';

interface FlashableQuery {
  isLoading: boolean;
  isFetching: boolean;
}

/**
 * Registers a list with the saved-flash store and reports its settled
 * renders (MUT-81). `settled` is derived here, not left to the caller, so no
 * list can race the resolve by passing `!isLoading` alone and missing a
 * refetch still in flight.
 *
 * Returns the per-row predicate: drop `flashed(row.id) && 'row-flash'` into
 * an existing `cn(...)` call. One hook call per list; no row-component
 * extraction needed.
 */
export function useSavedFlashRows(
  listId: string,
  ids: readonly string[],
  query: FlashableQuery
): (id: string) => boolean {
  const registerList = useSavedFlashStore((s) => s.registerList);
  const deregisterList = useSavedFlashStore((s) => s.deregisterList);
  const reportSettled = useSavedFlashStore((s) => s.reportSettled);
  const flashIds = useSavedFlashStore((s) => s.flashIds);
  const settled = !query.isLoading && !query.isFetching;

  useEffect(() => {
    registerList(listId);
    return () => deregisterList(listId);
  }, [listId, registerList, deregisterList]);

  // Runs after every render, including ones where `ids` is a fresh array
  // with the same content (the usual `rows.map(r => r.id)` shape). The
  // store does no allocation to process it -- see savedFlashStore.ts.
  useEffect(() => {
    reportSettled(listId, ids as string[], settled);
  });

  return useCallback((id: string) => flashIds.includes(id), [flashIds]);
}

/** The announcer's view of the store: just the three fields it reads. */
export function useSavedFlashResolution() {
  const pending = useSavedFlashStore((s) => s.pending);
  const claimed = useSavedFlashStore((s) => s.claimed);
  const flashIds = useSavedFlashStore((s) => s.flashIds);
  const rearm = useSavedFlashStore((s) => s.rearm);
  return { pending, claimed, flashIds, rearm };
}

/** A stable per-mount list id for a component that renders exactly one list. */
export function useFlashListId(prefix: string): string {
  const id = useId();
  return `${prefix}${id}`;
}
