import { useMemo, useCallback, useEffect } from 'react';
import { useProfileStore, type ActiveProfileId } from '../lib/profileStore';
import { useBusinessProfiles, useDefaultBusinessProfile } from './useQueries';
import type { BusinessProfile } from '../types';

/**
 * useActiveProfile Hook
 *
 * Provides access to the active profile context with business logic:
 * - Returns the active profile
 * - Handles profile resolution when store has empty/invalid ID
 * - Maintains strict single-profile behavior
 *
 * Design decisions:
 * - Default to first profile for new installs
 * - Never allow aggregate "all profiles" mode from the sidebar switcher
 * - Auto-switch to remaining profile if viewing deleted profile
 */

interface UseActiveProfileReturn {
  /** Whether we're in "All Profiles" aggregate mode (always false in strict mode) */
  isAllProfiles: boolean;

  /** The active profile ID */
  activeProfileId: ActiveProfileId;

  /** The active profile object */
  activeProfile: BusinessProfile | undefined;

  /** All available profiles */
  profiles: BusinessProfile[];

  /** Whether "All Profiles" option should be shown (always false in strict mode) */
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
    // Strict mode: if legacy "all" value is present, fall back to a concrete profile
    if (storedId === 'all') {
      return defaultProfile?.id ?? profiles[0]?.id ?? '';
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

  const isAllProfiles = false;

  const activeProfile = useMemo(() => {
    return profiles.find((p) => p.id === effectiveProfileId);
  }, [profiles, effectiveProfileId]);

  const showAllProfilesOption = false;

  const handleSetActiveProfile = useCallback(
    (id: ActiveProfileId) => {
      // Strict mode: only concrete profile IDs are valid
      if (id !== 'all' && profiles.some((p) => p.id === id)) {
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
 *
 * **STRICT MODE**: Always returns the active profile ID.
 * Never returns undefined. This enforces strict single-profile operation
 * on all pages - data is never mixed from multiple profiles.
 */
export function useProfileFilter(): string {
  const { activeProfileId } = useActiveProfile();
  // Always return a valid profileId - never undefined for strict isolation
  return activeProfileId;
}
