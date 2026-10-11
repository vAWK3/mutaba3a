import { useEffect, useRef } from 'react';
import { redirect, useRouter } from '@tanstack/react-router';
import type { FeatureKey } from '../../types';
import { featuresTurnedOff, type FeatureFlags } from './features';
import { readFeatureFlags, useFeatureFlags, useFeaturesLoaded } from './useFeatures';

/**
 * A router `beforeLoad` that bounces to `to` (home by default) while the
 * optional area `key` is switched off (MUT-13, MUT-16; ADR-032 §4).
 *
 * Runs before the route's lazy component chunk is requested, so a disabled
 * area neither renders nor loads. Reads the settings row through the
 * repository seam on every navigation, so a toggle is honoured by the very
 * next navigation with no cache to invalidate.
 */
export function requireFeature(key: FeatureKey, to = '/') {
  return async (): Promise<void> => {
    const flags = await readFeatureFlags();
    if (!flags[key]) {
      throw redirect({ to });
    }
  };
}

/**
 * Moves the user off a page whose area has just been switched off (MUT-15).
 *
 * Mounted once in `AppShell`. When any area goes from on to off, it calls
 * `router.invalidate()`, which re-runs the open route's `beforeLoad`: if
 * that is a `requireFeature` gate for the area, the gate redirects home with
 * `replace`, exactly as a deep link would. No second table of which route
 * belongs to which area. The first load (flags read `false` while settings
 * load) and switching an area on leave the router alone.
 */
export function useLeaveDisabledArea(): void {
  const router = useRouter();
  const flags = useFeatureFlags();
  const loaded = useFeaturesLoaded();
  const previous = useRef<FeatureFlags | null>(null);

  useEffect(() => {
    if (!loaded) return;
    const before = previous.current;
    previous.current = flags;
    if (before && featuresTurnedOff(before, flags).length > 0) {
      void router.invalidate();
    }
  }, [flags, loaded, router]);
}
