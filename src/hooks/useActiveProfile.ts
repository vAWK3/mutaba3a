import { useMemo, useCallback, useEffect } from 'react';
import { useProfileStore, type ActiveProfileId } from '../lib/profileStore';
import { useBusinessProfiles, useDefaultBusinessProfile } from './useQueries';
import type { BusinessProfile } from '../types';

/**
 * useActiveProfile Hook
 *
 * Provides access to the active profile context with business logic:
 * - Returns the active profile (or undefined for 'all' mode)
 * - Handles profile resolution when store has empty/invalid ID
 * - Provides helpers for checking "All Profiles" mode
 *
 * Design decisions:
 * - Default to first profile for new installs (not 'all')
 * - Show "All Profiles" option only when 2+ profiles exist
 * - Auto-switch to remaining profile if viewing deleted profile
 */

interface UseActiveProfileReturn {
  /** Whether we're in "All Profiles" aggregate mode */
  isAllProfiles: boolean;

  /** The active profile ID, or 'all' for aggregate mode */
  activeProfileId: ActiveProfileId;

  /** The active profile object (undefined in 'all' mode) */
  activeProfile: BusinessProfile | undefined;

  /** All available profiles */
  profiles: BusinessProfile[];

  /** Whether "All Profiles" option should be shown (2+ profiles) */
  showAllProfilesOption: boolean;

  /** Set the active profile */
  setActiveProfile: (id: ActiveProfileId) => void;

  /** Whether data is still loading */
  isLoading: boolean;
}

export function useActiveProfile(): UseActiveProfileReturn {
  const { activeProfileId: storedId, setActiveProfile } = useProfileStore();
  const { data: profiles = [], isLoading: profilesLoading } = useBusinessProfiles();
  const { data: defaultProfile, isLoading: defaultLoading } = useDefaultBusinessProfile();

  const isLoading = profilesLoading || defaultLoading;

  // Determine effective active profile ID with fallback logic
  const effectiveProfileId = useMemo<ActiveProfileId>(() => {
    // If 'all' is explicitly set, use it (but only if multiple profiles exist)
    if (storedId === 'all') {
      return profiles.length >= 2 ? 'all' : (profiles[0]?.id ?? '');
    }

    // If a specific profile ID is set, verify it exists
    if (storedId && profiles.some((p) => p.id === storedId)) {
      return storedId;
    }

    // Fallback: use default profile or first profile
    return defaultProfile?.id ?? profiles[0]?.id ?? '';
  }, [storedId, profiles, defaultProfile]);

  // Auto-correct stored ID if it's invalid
  useEffect(() => {
    if (!isLoading && storedId !== effectiveProfileId && effectiveProfileId) {
      setActiveProfile(effectiveProfileId);
    }
  }, [isLoading, storedId, effectiveProfileId, setActiveProfile]);

  const isAllProfiles = effectiveProfileId === 'all';

  const activeProfile = useMemo(() => {
    if (isAllProfiles) return undefined;
    return profiles.find((p) => p.id === effectiveProfileId);
  }, [isAllProfiles, profiles, effectiveProfileId]);

  const showAllProfilesOption = profiles.length >= 2;

  const handleSetActiveProfile = useCallback(
    (id: ActiveProfileId) => {
      // Validate the ID before setting
      if (id === 'all' && profiles.length >= 2) {
        setActiveProfile('all');
      } else if (profiles.some((p) => p.id === id)) {
        setActiveProfile(id);
      }
    },
    [profiles, setActiveProfile]
  );

  return {
    isAllProfiles,
    activeProfileId: effectiveProfileId,
    activeProfile,
    profiles,
    showAllProfilesOption,
    setActiveProfile: handleSetActiveProfile,
    isLoading,
  };
}

/**
 * Helper hook to get a profile filter value for queries.
 * Returns undefined when in 'all' mode (no filtering),
 * or the specific profile ID when in single-profile mode.
 */
export function useProfileFilter(): string | undefined {
  const { isAllProfiles, activeProfileId } = useActiveProfile();
  return isAllProfiles ? undefined : activeProfileId;
}
