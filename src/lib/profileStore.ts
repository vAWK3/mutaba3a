import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Profile Store
 *
 * Manages the active profile context for the application.
 * Uses a single concrete profile ID at a time.
 *
 * @see .claude/designs/multi-profile.md for design decisions
 */

export type ActiveProfileId = string | 'all';

interface ProfileState {
  /** The currently active profile ID */
  activeProfileId: ActiveProfileId;

  /** Set the active profile */
  setActiveProfile: (id: ActiveProfileId) => void;

  /** Reset to default (first profile) */
  reset: () => void;
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

      setActiveProfile: (id) => set({ activeProfileId: id }),

      reset: () => set({ activeProfileId: '' }),
    }),
    {
      name: 'mutaba3a-active-profile',
    }
  )
);
