import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Profile Store
 *
 * Manages the active profile context for the application.
 * Supports "All Profiles" aggregate mode ('all') or a specific profile ID.
 *
 * @see .claude/designs/multi-profile.md for design decisions
 */

export type ActiveProfileId = string | 'all';

interface ProfileState {
  /** The currently active profile ID, or 'all' for aggregate view */
  activeProfileId: ActiveProfileId;

  /** Set the active profile */
  setActiveProfile: (id: ActiveProfileId) => void;

  /** Reset to default (first profile) */
  reset: () => void;
}

/**
 * Profile store with localStorage persistence.
 * Default is empty string - the useActiveProfile hook will resolve this
 * to the first profile or 'all' based on business logic.
 */
export const useProfileStore = create<ProfileState>()(
  persist(
    (set) => ({
      activeProfileId: '',

      setActiveProfile: (id) => set({ activeProfileId: id }),

      reset: () => set({ activeProfileId: '' }),
    }),
    {
      name: 'mutaba3a-active-profile',
    }
  )
);
