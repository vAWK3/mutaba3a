import { create } from 'zustand';

/**
 * MUT-373 (design review DR3): a co-owner removed while working on a shared profile is told what happened, on their
 * personal profile, instead of meeting a bare "This profile isn't available". The shell remembers the profile open
 * in this tab; when `/v1/me` stops listing it, ProfileLayout moves to the personal profile and shows this banner. A
 * deep link to a profile the person never had open still gets the plain unavailable screen. Reset on sign-out.
 */
interface LostAccessState {
  /** The profile last open in this tab, with its name as it was then. */
  open: { id: string; name: string } | null;
  /** The banner to show, until dismissed. */
  lost: { name: string } | null;
  remember: (id: string, name: string) => void;
  /** Leaving on purpose (DR4): no banner for a profile the person chose to leave. */
  forget: (id: string) => void;
  lose: (name: string) => void;
  dismiss: () => void;
  reset: () => void;
}

export const useLostAccess = create<LostAccessState>((set) => ({
  open: null,
  lost: null,
  remember: (id, name) => set((s) => (s.open?.id === id && s.open.name === name ? s : { open: { id, name } })),
  forget: (id) => set((s) => (s.open?.id === id ? { open: null } : s)),
  lose: (name) => set({ lost: { name }, open: null }),
  dismiss: () => set({ lost: null }),
  reset: () => set({ open: null, lost: null }),
}));
