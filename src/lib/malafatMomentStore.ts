import { create } from 'zustand';

/**
 * Session-only state for the Malafat suggestions (MUT-190). Nothing here is
 * stored: the business-added note belongs to the moment right after adding a
 * business, and the slot count lets the Go hosted sidebar card step aside
 * while a Malafat suggestion is on screen (one upsell at a time, ADR-078).
 */
interface MalafatMomentState {
  businessAdded: boolean;
  suggestionsShown: number;
  /** A Clients suggestion was retired on this visit: show no other until the app reloads. */
  clientsRetiredThisVisit: boolean;
  markClientsRetired: () => void;
  markBusinessAdded: () => void;
  clearBusinessAdded: () => void;
  /** Call while a suggestion is mounted; the returned release is safe to call more than once. */
  claimSlot: () => () => void;
  reset: () => void;
}

export const useMalafatMomentStore = create<MalafatMomentState>((set) => ({
  businessAdded: false,
  suggestionsShown: 0,
  clientsRetiredThisVisit: false,
  markClientsRetired: () => set({ clientsRetiredThisVisit: true }),
  markBusinessAdded: () => set({ businessAdded: true }),
  clearBusinessAdded: () => set({ businessAdded: false }),
  claimSlot: () => {
    set((s) => ({ suggestionsShown: s.suggestionsShown + 1 }));
    let released = false;
    return () => {
      if (released) return;
      released = true;
      set((s) => ({ suggestionsShown: Math.max(0, s.suggestionsShown - 1) }));
    };
  },
  reset: () => set({ businessAdded: false, suggestionsShown: 0, clientsRetiredThisVisit: false }),
}));
