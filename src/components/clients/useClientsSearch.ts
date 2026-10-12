import { useCallback, useMemo } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { parseClientsSearch, mergeClientsSearch, type ClientsListState } from './clientsSearch';

/**
 * The Clients list's search and sort, read from and written to the URL as one
 * object (MUT-84). Writes use `replace` and keep the current path, so sorting
 * or typing never adds a history entry and never closes the open client.
 */
export function useClientsSearch() {
  const raw = useSearch({ strict: false });
  const navigate = useNavigate();
  const search = useMemo(() => parseClientsSearch(raw as Record<string, unknown>), [raw]);

  const setSearch = useCallback(
    (patch: Partial<ClientsListState>) => {
      void navigate({
        to: '.',
        search: (prev) => mergeClientsSearch(parseClientsSearch(prev as Record<string, unknown>), patch),
        replace: true,
      });
    },
    [navigate]
  );

  return { search, setSearch };
}
