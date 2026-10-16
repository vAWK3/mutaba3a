import { create } from 'zustand';
import type { ReleaseEntry } from './releaseNotes';

interface WhatsNewStore {
  /** The versions the open "What's new" shows, newest first; null while it is closed. */
  entries: ReleaseEntry[] | null;
  openWhatsNew: (entries: ReleaseEntry[]) => void;
  closeWhatsNew: () => void;
}

/** "What's new" opens on its own after an update, or from Settings › About (MUT-24). */
export const useWhatsNewStore = create<WhatsNewStore>((set) => ({
  entries: null,
  openWhatsNew: (entries) => set({ entries: entries.length ? entries : null }),
  closeWhatsNew: () => set({ entries: null }),
}));
