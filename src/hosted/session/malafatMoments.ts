import { create } from 'zustand';

/**
 * Session-only state for the portal's Malafat suggestions (MUT-191): the
 * business profile just created (C1 shows on it, once) and whether a Clients
 * suggestion was retired on this visit. Reset on sign-out (endSession), so the
 * next person in this tab starts clean.
 */
interface PortalMomentsState {
  businessCreatedId: string | null;
  clientsRetiredThisVisit: boolean;
  markBusinessCreated: (profileId: string) => void;
  clearBusinessCreated: () => void;
  markClientsRetired: () => void;
  reset: () => void;
}

export const useMalafatPortalMoments = create<PortalMomentsState>((set) => ({
  businessCreatedId: null,
  clientsRetiredThisVisit: false,
  markBusinessCreated: (profileId) => set({ businessCreatedId: profileId }),
  clearBusinessCreated: () => set({ businessCreatedId: null }),
  markClientsRetired: () => set({ clientsRetiredThisVisit: true }),
  reset: () => set({ businessCreatedId: null, clientsRetiredThisVisit: false }),
}));
