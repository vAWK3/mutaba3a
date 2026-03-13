import { useState, useCallback, useMemo } from 'react';

export type SortDir = 'asc' | 'desc';

export interface UseSortStateOptions<T extends string> {
  defaultField: T;
  defaultDir: SortDir;
  paramPrefix?: string;
  validFields?: T[];
}

export interface UseSortStateResult<T extends string> {
  sortField: T;
  sortDir: SortDir;
  setSortField: (field: T) => void;
  setSortDir: (dir: SortDir) => void;
  toggleSort: () => void;
  /** Combined setter for use with select dropdowns */
  setSort: (field: T, dir: SortDir) => void;
}

/**
 * Hook for managing sort state with URL persistence.
 * Reads and writes sort parameters to URL search params.
 */
export function useSortState<T extends string>(
  options: UseSortStateOptions<T>
): UseSortStateResult<T> {
  const { defaultField, defaultDir, paramPrefix, validFields } = options;

  // Build param names
  const sortParam = paramPrefix ? `${paramPrefix}_sort` : 'sort';
  const dirParam = paramPrefix ? `${paramPrefix}_dir` : 'dir';

  // Read initial values from URL
  const getInitialValues = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const urlSort = params.get(sortParam);
    const urlDir = params.get(dirParam);

    let field = defaultField;
    let dir = defaultDir;

    // Validate and parse sort field
    if (urlSort) {
      if (validFields) {
        if (validFields.includes(urlSort as T)) {
          field = urlSort as T;
        }
      } else {
        field = urlSort as T;
      }
    }

    // Validate and parse direction
    if (urlDir === 'asc' || urlDir === 'desc') {
      dir = urlDir;
    }

    return { field, dir };
  }, [defaultField, defaultDir, sortParam, dirParam, validFields]);

  const initialValues = useMemo(() => getInitialValues(), [getInitialValues]);

  const [sortField, setSortFieldState] = useState<T>(initialValues.field);
  const [sortDir, setSortDirState] = useState<SortDir>(initialValues.dir);

  // Update URL with new sort params
  const updateURL = useCallback(
    (field: T, dir: SortDir) => {
      const params = new URLSearchParams(window.location.search);

      // Only add to URL if different from defaults
      if (field !== defaultField) {
        params.set(sortParam, field);
      } else {
        params.delete(sortParam);
      }

      if (dir !== defaultDir) {
        params.set(dirParam, dir);
      } else {
        params.delete(dirParam);
      }

      // Build new URL
      const newSearch = params.toString();
      const newURL = newSearch
        ? `${window.location.pathname}?${newSearch}`
        : window.location.pathname;

      // Update URL without navigation
      window.history.replaceState({}, '', newURL);
    },
    [defaultField, defaultDir, sortParam, dirParam]
  );

  const setSortField = useCallback(
    (field: T) => {
      setSortFieldState(field);
      updateURL(field, sortDir);
    },
    [sortDir, updateURL]
  );

  const setSortDir = useCallback(
    (dir: SortDir) => {
      setSortDirState(dir);
      updateURL(sortField, dir);
    },
    [sortField, updateURL]
  );

  const toggleSort = useCallback(() => {
    const newDir = sortDir === 'asc' ? 'desc' : 'asc';
    setSortDirState(newDir);
    updateURL(sortField, newDir);
  }, [sortDir, sortField, updateURL]);

  const setSort = useCallback(
    (field: T, dir: SortDir) => {
      setSortFieldState(field);
      setSortDirState(dir);
      updateURL(field, dir);
    },
    [updateURL]
  );

  return {
    sortField,
    sortDir,
    setSortField,
    setSortDir,
    toggleSort,
    setSort,
  };
}
