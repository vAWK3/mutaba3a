import { create } from 'zustand';
import { readSampleSession } from './sampleSession';

/**
 * Where the visitor sample stands for the UI (MUT-78):
 * - `none`: no sample; the app is the person's own.
 * - `preparing`: the sample is being seeded; hold first-run dialogs back.
 * - `active`: a sample session is open; show the sample bar.
 */
export type SampleStatus = 'none' | 'preparing' | 'active';

interface SampleSessionState {
  status: SampleStatus;
  setStatus: (status: SampleStatus) => void;
}

export const useSampleSessionStore = create<SampleSessionState>((set) => ({
  status: readSampleSession() ? 'active' : 'none',
  setStatus: (status) => set({ status }),
}));
