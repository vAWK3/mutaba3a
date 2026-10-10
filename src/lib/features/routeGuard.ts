import { redirect } from '@tanstack/react-router';
import type { FeatureKey } from '../../types';
import { readFeatureFlags } from './useFeatures';

/**
 * A router `beforeLoad` that bounces to `to` (home by default) while the
 * optional area `key` is switched off (MUT-13, MUT-16; ADR-030 §4).
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
