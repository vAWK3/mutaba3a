/**
 * Read and write paths for the Malafat suggestions' settings (MUT-190).
 * Like `lib/features/useFeatures.ts`, the settings query key is declared here
 * rather than imported from `hooks/useQueries`, which page tests mock wholesale.
 */

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getRepositories } from '../db/provider';
import type { MalafatMoment } from '../types';
import { dismissMoment, resolveMalafatSuggestions, toStored, type MalafatSuggestions } from './malafatSuggestions';

const SETTINGS_QUERY_KEY = ['settings'] as const;

/** The resolved suggestions, or null until the settings row has loaded (so a dismissed card never flashes in). */
export function useMalafatSuggestions(): MalafatSuggestions | null {
  const { data, isSuccess } = useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: () => getRepositories().base.settings.get(),
  });
  const stored = data?.malafatSuggestions;
  return useMemo(() => (isSuccess ? resolveMalafatSuggestions(stored) : null), [isSuccess, stored]);
}

/** Read the fresh row, change it, write the whole field back: another writer may have changed it since the last render. */
function useWriteSuggestions<T>(change: (current: MalafatSuggestions, input: T) => MalafatSuggestions) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: T) => {
      const settings = getRepositories().base.settings;
      const current = resolveMalafatSuggestions((await settings.get()).malafatSuggestions);
      await settings.update({ malafatSuggestions: toStored(change(current, input)) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY });
    },
  });
}

/** Retires a moment for good (a dismissal, or a click on its link). */
export function useDismissMalafatMoment() {
  return useWriteSuggestions<MalafatMoment>(dismissMoment);
}

/** The Settings switch "Show Malafat suggestions". */
export function useSetMalafatSuggestionsOn() {
  return useWriteSuggestions<boolean>((current, on) => ({ ...current, on }));
}
