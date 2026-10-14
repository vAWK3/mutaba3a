import { create } from 'zustand';

/**
 * Session-only state for the portal's Malafat suggestions (MUT-191): the
 * business profile just created (C1 shows on it, once) and whether a Clients
 * suggestion was retired on this visit. Reset on sign-out (endSession), so the
 * next person in this tab starts clean.
 */
interface PortalMomentsState {
  /** C1 is due on this profile's page; consumed on arrival. */
  businessCreatedId: string | null;
  /** A business profile was created on this visit: C3 (second business) stays quiet until reload, since C1 spoke for that event. */
  businessCreatedThisVisit: boolean;
  clientsRetiredThisVisit: boolean;
  markBusinessCreated: (profileId: string) => void;
  clearBusinessCreated: () => void;
  markClientsRetired: () => void;
  reset: () => void;
}

export const useMalafatPortalMoments = create<PortalMomentsState>((set) => ({
  businessCreatedId: null,
  businessCreatedThisVisit: false,
  clientsRetiredThisVisit: false,
  markBusinessCreated: (profileId) => set({ businessCreatedId: profileId, businessCreatedThisVisit: true }),
  clearBusinessCreated: () => set({ businessCreatedId: null }),
  markClientsRetired: () => set({ clientsRetiredThisVisit: true }),
  reset: () => set({ businessCreatedId: null, businessCreatedThisVisit: false, clientsRetiredThisVisit: false }),
}));
