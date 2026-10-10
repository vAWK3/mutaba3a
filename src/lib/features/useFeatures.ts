/**
 * Read and write paths for the optional areas (MUT-12).
 *
 * `useFeatureEnabled` is the only way a component learns whether an area is
 * on; nothing outside this module reads `settings.features`. Route guards run
 * outside React and use `readFeatureFlags()` instead — same resolver, no
 * cache, so a toggle is visible to the very next navigation.
 */

import { useCallback, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getRepositories } from '../../db/provider';
import { queryKeys, useSettings } from '../../hooks/useQueries';
import type { FeatureKey } from '../../types';
import { resolveFeatures, withFeature, type FeatureFlags } from './features';

/** The whole map, resolved; stable between renders while the row is unchanged. */
export function useFeatureFlags(): FeatureFlags {
  const { data } = useSettings();
  const stored = data?.features;
  return useMemo(() => resolveFeatures(stored), [stored]);
}

/**
 * Whether one optional area is on. `false` while settings are still loading,
 * so a gated entry appears after load rather than flashing in and out.
 */
export function useFeatureEnabled(key: FeatureKey): boolean {
  return useFeatureFlags()[key];
}

export interface SetFeatureInput {
  key: FeatureKey;
  enabled: boolean;
}

/**
 * Switch one area on or off. Writes the full resolved map (the repository's
 * `update` replaces fields, it does not merge nested objects) and invalidates
 * the settings query so every reader re-renders at once.
 */
export function useSetFeatureEnabled() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ key, enabled }: SetFeatureInput) => {
      const settings = getRepositories().base.settings;
      const current = resolveFeatures((await settings.get()).features);
      await settings.update({ features: { ...withFeature(current, key, enabled) } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings() });
    },
  });
}

/**
 * The areas that were switched on automatically (v20 upgrade, restore or
 * import) and not yet shown to the user, plus the one-shot `dismiss`.
 */
export function useFeatureNotice(): { notice: FeatureKey[]; isLoaded: boolean; dismiss: () => Promise<void> } {
  const { data, isSuccess } = useSettings();
  const queryClient = useQueryClient();

  const dismiss = useCallback(async () => {
    await getRepositories().base.settings.update({ featureNotice: undefined });
    await queryClient.invalidateQueries({ queryKey: queryKeys.settings() });
  }, [queryClient]);

  return {
    notice: data?.featureNotice ?? [],
    isLoaded: isSuccess,
    dismiss,
  };
}

/**
 * Non-React read path for router `beforeLoad` guards (MUT-13, MUT-16): reads
 * the settings row through the repository seam and resolves it. Dexie queues
 * the read behind any pending open/upgrade, so calling this before
 * `initDatabase()` has finished still sees post-upgrade data.
 */
export async function readFeatureFlags(): Promise<FeatureFlags> {
  const settings = await getRepositories().base.settings.get();
  return resolveFeatures(settings.features);
}
