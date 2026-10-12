import { useCallback, useMemo } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { parseIncomeSearch, mergeIncomeSearch, type IncomeSearch } from '../lib/incomeSearch';

/**
 * /income's filters, read from and written to the URL as one object (MUT-83).
 * Writes use `replace`, so changing a filter never adds a history entry; a
 * link (the clients index's muted rows) opens the page already filtered.
 */
export function useIncomeFilters() {
  const raw = useSearch({ strict: false });
  const navigate = useNavigate();
  const search = useMemo(() => parseIncomeSearch(raw as Record<string, unknown>), [raw]);

  const setSearch = useCallback(
    (patch: Partial<IncomeSearch>) => {
      void navigate({
        to: '/income',
        search: (prev) => mergeIncomeSearch(parseIncomeSearch(prev as Record<string, unknown>), patch),
        replace: true,
      });
    },
    [navigate]
  );

  return { search, setSearch };
}
