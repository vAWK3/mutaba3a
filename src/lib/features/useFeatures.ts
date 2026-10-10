/**
 * Read and write paths for the optional areas (MUT-12).
 *
 * `useFeatureEnabled` is the only way a component learns whether an area is
 * on; nothing outside this module reads `settings.features`. Route guards run
 * outside React and use `readFeatureFlags()` instead — same resolver, no
 * cache, so a toggle is visible to the very next navigation.
 */

import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getRepositories } from '../../db/provider';
import type { FeatureKey } from '../../types';
import { resolveFeatures, withFeature, type FeatureFlags } from './features';

/**
 * Same key as `queryKeys.settings()` in `hooks/useQueries.ts`, declared here
 * so this module does not import that barrel: page tests mock it wholesale
 * (`vi.mock('../../../hooks/useQueries')`), and anything the top bar or the
 * sidebar reads through it would vanish inside those tests.
 */
const SETTINGS_QUERY_KEY = ['settings'] as const;

function useSettingsRow() {
  return useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: () => getRepositories().base.settings.get(),
  });
}

/** The whole map, resolved; stable between renders while the row is unchanged. */
export function useFeatureFlags(): FeatureFlags {
  const { data } = useSettingsRow();
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

/**
 * Whether the settings row has been read at least once. `useFeatureEnabled`
 * answers `false` while loading, so a component that *acts* on an area being
 * off (rather than merely hiding an entry) must wait for this to be true, or
 * it will treat "not loaded yet" as "switched off" (MUT-16 review #1).
 */
export function useFeaturesLoaded(): boolean {
  return useSettingsRow().isSuccess;
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
      queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY });
    },
  });
}

/**
 * The areas that were switched on automatically (v20 upgrade, restore or
 * import) and not yet shown to the user, plus the one-shot `dismiss`.
 */
export function useFeatureNotice(): { notice: FeatureKey[]; isLoaded: boolean; dismiss: () => Promise<void> } {
  const { data, isSuccess } = useSettingsRow();
  const queryClient = useQueryClient();

  const dismiss = useCallback(async () => {
    await getRepositories().base.settings.update({ featureNotice: undefined });
    await queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY });
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
