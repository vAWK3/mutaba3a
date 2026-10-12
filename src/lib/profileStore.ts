import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Profile Store
 *
 * The business the app works in, and the "All businesses" lens (MUT-89,
 * ADR-051):
 * - `activeProfileId`: the working business. Always a concrete id ('' until
 *   the profiles have loaded, or when none exists). Every screen but Home and
 *   Clients works in it.
 * - `allBusinesses`: the user chose All businesses for Home and Clients. It
 *   sticks while other screens use the working business (O1).
 * - `onOwedScreen`: the route is Home or Clients. Synced from the router by
 *   AppShell (`useOwedScreenSync`) and never persisted.
 *
 * Three setters touch the working business, and only one turns the lens off:
 * - `setActiveProfile(id)`: the user picks a business. The lens turns off.
 * - `setWorkingProfile(id)`: a repair or a drill-down changes the working
 *   business. The lens is kept (D5).
 * - `setAllBusinesses(on)`: the user turns the lens on or off (D6).
 */

interface ProfileState {
  /** The working business: always a concrete id, '' until resolved */
  activeProfileId: string;

  /** Whether the user chose "All businesses" for Home and Clients */
  allBusinesses: boolean;

  /** Whether the current route is Home or Clients (not persisted) */
  onOwedScreen: boolean;

  /** The user picks a business: it becomes the working one and All businesses turns off */
  setActiveProfile: (id: string) => void;

  /** Change the working business and keep All businesses as it is */
  setWorkingProfile: (id: string) => void;

  /** Turn All businesses on or off */
  setAllBusinesses: (on: boolean) => void;

  /** Set by the router sync in AppShell */
  setOnOwedScreen: (on: boolean) => void;

  /** Back to no working business and All businesses off */
  reset: () => void;
}

type PersistedProfileState = Pick<ProfileState, 'activeProfileId' | 'allBusinesses'>;

/** Before MUT-89 the lens was stored as this value of activeProfileId */
const LEGACY_ALL = 'all';

/**
 * Version 0 stored only `activeProfileId`, which could be the legacy 'all'.
 * That becomes All businesses on, with the working business left to resolve.
 */
export function migrateProfileState(persisted: unknown, version: number): PersistedProfileState {
  const stored = (persisted ?? {}) as Partial<PersistedProfileState>;
  if (version === 0) {
    const isLegacyAll = stored.activeProfileId === LEGACY_ALL;
    return {
      activeProfileId: isLegacyAll ? '' : (stored.activeProfileId ?? ''),
      allBusinesses: isLegacyAll,
    };
  }
  return { activeProfileId: stored.activeProfileId ?? '', allBusinesses: stored.allBusinesses ?? false };
}

/**
 * Profile store with localStorage persistence.
 * Default is empty string - the useActiveProfile hook will resolve this
 * to the first/default profile based on business logic.
 */
export const useProfileStore = create<ProfileState>()(
  persist(
    (set) => ({
      activeProfileId: '',
      allBusinesses: false,
      onOwedScreen: false,

      setActiveProfile: (id) => set({ activeProfileId: id, allBusinesses: false }),

      setWorkingProfile: (id) => set({ activeProfileId: id }),

      setAllBusinesses: (on) => set({ allBusinesses: on }),

      setOnOwedScreen: (on) => set({ onOwedScreen: on }),

      reset: () => set({ activeProfileId: '', allBusinesses: false }),
    }),
    {
      name: 'mutaba3a-active-profile',
      version: 1,
      migrate: migrateProfileState,
      partialize: (state): PersistedProfileState => ({
        activeProfileId: state.activeProfileId,
        allBusinesses: state.allBusinesses,
      }),
    }
  )
);
