import { useMemo, useCallback, useEffect, useLayoutEffect } from 'react';
import { useMatches } from '@tanstack/react-router';
import { useProfileStore, useOwedScreenStore } from '../lib/profileStore';
import { useBusinessProfiles, useDefaultBusinessProfile } from './useQueries';
import type { BusinessProfile, ProfileScope } from '../types';

/**
 * useActiveProfile Hook
 *
 * The working business, and whether "All businesses" is in effect (MUT-89,
 * ADR-051):
 * - `activeProfileId` / `activeProfile` are always the working business, a
 *   concrete id. They are never "all", so every screen but Home and Clients
 *   keeps working in one business.
 * - `isAllProfiles` is true only when the user chose All businesses, the
 *   screen is Home or Clients, and two or more businesses exist. The
 *   switcher, the top bar and the drawers read it.
 * - `showAllProfilesOption` lists All businesses on Home and Clients only,
 *   with two or more businesses (AC1, O2).
 *
 * Design decisions:
 * - Default to the default (else first) business for new installs.
 * - When the working business is gone (deleted, archived, never set), it is
 *   repaired to the default without picking: All businesses stays as it was
 *   (D5).
 */

interface UseActiveProfileReturn {
  /** Whether "All businesses" is in effect on this screen */
  isAllProfiles: boolean;

  /** The working business ID: always concrete, '' until resolved or when none exists */
  activeProfileId: string;

  /** The working business */
  activeProfile: BusinessProfile | undefined;

  /** All available (live) businesses */
  profiles: BusinessProfile[];

  /** Whether the switcher lists "All businesses" on this screen */
  showAllProfilesOption: boolean;

  /** The user picks a business: it becomes the working one and All businesses turns off */
  setActiveProfile: (id: string) => void;

  /** Turn "All businesses" on or off (needs two or more businesses) */
  setAllBusinesses: (on: boolean) => void;

  /** Whether data is still loading */
  isLoading: boolean;
}

/** All businesses needs at least this many live businesses (AC1) */
const MIN_BUSINESSES_FOR_ALL = 2;

export function useActiveProfile(): UseActiveProfileReturn {
  const {
    activeProfileId: storedId,
    allBusinesses,
    setActiveProfile,
    setWorkingProfile,
    setAllBusinesses,
  } = useProfileStore();
  const onOwedScreen = useOwedScreenStore((s) => s.onOwedScreen);
  const { data: profiles = [], isLoading: profilesLoading } = useBusinessProfiles();
  const { data: defaultProfile, isLoading: defaultLoading } = useDefaultBusinessProfile();

  const isLoading = profilesLoading || defaultLoading;

  // The working business: the stored one while it exists, else the default, else the first
  const effectiveProfileId = useMemo(() => {
    if (storedId && profiles.some((p) => p.id === storedId)) {
      return storedId;
    }
    return defaultProfile?.id ?? profiles[0]?.id ?? '';
  }, [storedId, profiles, defaultProfile]);

  // Repair a missing or stale working business without picking one, so a
  // chosen All businesses survives (D5)
  useEffect(() => {
    if (!isLoading && storedId !== effectiveProfileId && effectiveProfileId) {
      setWorkingProfile(effectiveProfileId);
    }
  }, [isLoading, storedId, effectiveProfileId, setWorkingProfile]);

  const canShowAll = profiles.length >= MIN_BUSINESSES_FOR_ALL;
  const showAllProfilesOption = onOwedScreen && canShowAll;
  const isAllProfiles = showAllProfilesOption && allBusinesses;

  const activeProfile = useMemo(() => {
    return profiles.find((p) => p.id === effectiveProfileId);
  }, [profiles, effectiveProfileId]);

  const handleSetActiveProfile = useCallback(
    (id: string) => {
      if (profiles.some((p) => p.id === id)) {
        setActiveProfile(id);
      }
    },
    [profiles, setActiveProfile]
  );

  const handleSetAllBusinesses = useCallback(
    (on: boolean) => {
      if (!on || canShowAll) {
        setAllBusinesses(on);
      }
    },
    [canShowAll, setAllBusinesses]
  );

  return {
    isAllProfiles,
    activeProfileId: effectiveProfileId,
    activeProfile,
    profiles,
    showAllProfilesOption,
    setActiveProfile: handleSetActiveProfile,
    setAllBusinesses: handleSetAllBusinesses,
    isLoading,
  };
}

/**
 * The business every single-business screen reads: always the working
 * business, never "all" (AC3). AppShell's BusinessesGate mounts pages only
 * once businesses have loaded, so this is never a loading-time blank.
 */
export function useProfileFilter(): string {
  const { activeProfileId } = useActiveProfile();
  return activeProfileId;
}

interface UseOwedLensReturn {
  /**
   * What Home and Clients read:
   * - every live business, when All businesses is on;
   * - else the working business ('' when there is no business at all, D4);
   * - undefined while the businesses are loading: read nothing yet (D2).
   */
  scope: ProfileScope | undefined;

  /** Whether the owed screens show every business, with business tags */
  isAll: boolean;

  /** The live businesses by id, for the tags */
  profilesById: Map<string, BusinessProfile>;
}

/**
 * The owed screens' lens (MUT-89): Home and Clients call it, and nothing else.
 * It ignores the route flag (D3): those screens are the owed screens, so
 * their first frame reads the right businesses, with one read.
 */
export function useOwedLens(): UseOwedLensReturn {
  const { activeProfileId, profiles, isLoading } = useActiveProfile();
  const { allBusinesses } = useProfileStore();

  const isAll = !isLoading && allBusinesses && profiles.length >= MIN_BUSINESSES_FOR_ALL;
  const allIds = useMemo(() => profiles.map((p) => p.id), [profiles]);
  const profilesById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);

  const scope = isLoading ? undefined : isAll ? allIds : activeProfileId;
  return { scope, isAll, profilesById };
}

/**
 * Keeps the store's `onOwedScreen` in step with the route (MUT-89, D1):
 * a route tagged `staticData.owedLens` (Home, the Clients layout and the
 * client beside it) is an owed screen. Written before paint, so the switcher
 * and the top bar never show a stale lens. Called once, in AppShell.
 */
export function useOwedScreenSync(): void {
  const onOwedScreen = useMatches({ select: (matches) => matches.some((m) => m.staticData?.owedLens === true) });
  const setOnOwedScreen = useOwedScreenStore((s) => s.setOnOwedScreen);

  useLayoutEffect(() => {
    setOnOwedScreen(onOwedScreen);
  }, [onOwedScreen, setOnOwedScreen]);
}
